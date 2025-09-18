#!/usr/bin/env node

import { AbiCoder, getAddress, parseUnits, keccak256, formatUnits } from "ethers";
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { Command } from "commander";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";

// Merkle tree generator with robust validation and error handling
// Generator using double-hashed leaves per Cyfrin guidance:
// leaf = keccak256( keccak256( abi.encode(address,uint256) ) )
// Internal node hashing matches OpenZeppelin MerkleProof: keccak256(concatOrdered(a, b))

// Types
type RawEntry = { address: string; amount: string };
type Entry = { address: string; amount: string; originalIndex: number };
type Claims = {
    merkleRoot: string;
    tokenTotal: string;
    totalEntries: number;
    treeDepth: number;
    generatedAt: string;
    config: GeneratorConfig;
    claims: Record<string, { index: number; amount: string; proof: string[] }>;
};

type GeneratorConfig = {
    decimals: number;
    inputFile: string;
    outputDir: string;
    sortEntries: boolean;
    verifyProofs: boolean;
};

// Enhanced error types
class MerkleGeneratorError extends Error {
    constructor(message: string, public code: string, public details?: any) {
        super(message);
        this.name = "MerkleGeneratorError";
    }
}

// Configuration
const program = new Command();
program
    .name("generate-merkle-tree")
    .description("Generate Merkle tree for token distribution with robust validation")
    .option("-i, --input <file>", "Input CSV file path", "data/allowlist.csv")
    .option("-o, --output <dir>", "Output directory", ".")
    .option("-d, --decimals <number>", "Token decimals", "18")
    .option("--no-sort", "Disable deterministic sorting")
    .option("--no-verify", "Skip proof verification")
    .option("-v, --verbose", "Verbose output")
    .parse();

const options = program.opts();
const config: GeneratorConfig = {
    decimals: parseInt(options.decimals),
    inputFile: options.input,
    outputDir: options.output,
    sortEntries: options.sort,
    verifyProofs: options.verify
};

// Core cryptographic functions (unchanged, proven correct)
const coder = AbiCoder.defaultAbiCoder();

function toBytes(hex: string): Buffer {
    return Buffer.from(hex.slice(2), "hex");
}

function hashPair(a: string, b: string): string {
    const [left, right] = Buffer.compare(toBytes(a), toBytes(b)) <= 0 ? [a, b] : [b, a];
    return keccak256(Buffer.concat([toBytes(left), toBytes(right)]));
}

function hashLeaf(address: string, amount: string): string {
    const inner = keccak256(coder.encode(["address", "uint256"], [address, amount]));
    return keccak256(toBytes(inner));
}

// Memory-optimized tree builder that doesn't store unnecessary layers
function buildTreeOptimized(leaves: string[]): { root: string; getProof: (index: number) => string[] } {
    if (leaves.length === 0) {
        return {
            root: "0x" + "00".repeat(32),
            getProof: () => []
        };
    }

    // Store only what we need for proof generation
    const allLayers: string[][] = [leaves];
    let currentLayer = leaves;

    while (currentLayer.length > 1) {
        const nextLayer: string[] = [];
        for (let i = 0; i < currentLayer.length; i += 2) {
            const a = currentLayer[i];
            const b = i + 1 < currentLayer.length ? currentLayer[i + 1] : currentLayer[i];
            nextLayer.push(hashPair(a, b));
        }
        allLayers.push(nextLayer);
        currentLayer = nextLayer;
    }

    const root = currentLayer[0];

    return {
        root,
        getProof: (index: number) => {
            const proof: string[] = [];
            let idx = index;

            for (let layer = 0; layer < allLayers.length - 1; layer++) {
                const nodes = allLayers[layer];
                const isRight = idx % 2 === 1;
                const pairIndex = isRight ? idx - 1 : idx + 1;
                const sibling = pairIndex < nodes.length ? nodes[pairIndex] : nodes[idx];
                proof.push(sibling);
                idx = Math.floor(idx / 2);
            }

            return proof;
        }
    };
}

// Enhanced CSV parsing with validation
async function loadAndValidateEntries(filePath: string): Promise<Entry[]> {
    if (!fs.existsSync(filePath)) {
        throw new MerkleGeneratorError(
            `Input file not found: ${filePath}`,
            "FILE_NOT_FOUND"
        );
    }

    const rawEntries: RawEntry[] = [];
    const seenAddresses = new Set<string>();
    const duplicates: string[] = [];
    let lineNumber = 1; // Header is line 1

    try {
        await pipeline(
            createReadStream(filePath),
            csv(),
            async function* (source) {
                for await (const row of source) {
                    lineNumber++;

                    // Validate required fields
                    if (!row.address || !row.amount) {
                        throw new MerkleGeneratorError(
                            `Missing required field on line ${lineNumber}`,
                            "INVALID_CSV_ROW",
                            { line: lineNumber, row }
                        );
                    }

                    // Clean and validate address
                    const addressStr = row.address.trim();
                    if (!addressStr.startsWith('0x') || addressStr.length !== 42) {
                        throw new MerkleGeneratorError(
                            `Invalid address format on line ${lineNumber}: ${addressStr}`,
                            "INVALID_ADDRESS",
                            { line: lineNumber, address: addressStr }
                        );
                    }

                    let checksumAddress: string;
                    try {
                        checksumAddress = getAddress(addressStr);
                    } catch (error) {
                        throw new MerkleGeneratorError(
                            `Invalid address on line ${lineNumber}: ${addressStr}`,
                            "INVALID_ADDRESS",
                            { line: lineNumber, address: addressStr, error: (error as Error).message }
                        );
                    }

                    // Check for duplicates
                    if (seenAddresses.has(checksumAddress)) {
                        duplicates.push(checksumAddress);
                    } else {
                        seenAddresses.add(checksumAddress);
                    }

                    // Validate amount
                    const amountStr = row.amount.trim();
                    if (!/^\d+(\.\d+)?$/.test(amountStr)) {
                        throw new MerkleGeneratorError(
                            `Invalid amount format on line ${lineNumber}: ${amountStr}`,
                            "INVALID_AMOUNT",
                            { line: lineNumber, amount: amountStr }
                        );
                    }

                    const amountNum = parseFloat(amountStr);
                    if (amountNum <= 0) {
                        throw new MerkleGeneratorError(
                            `Amount must be positive on line ${lineNumber}: ${amountStr}`,
                            "INVALID_AMOUNT",
                            { line: lineNumber, amount: amountStr }
                        );
                    }

                    rawEntries.push({ address: checksumAddress, amount: amountStr });
                    yield { address: checksumAddress, amount: amountStr };
                }
            }
        );
    } catch (error) {
        if (error instanceof MerkleGeneratorError) {
            throw error;
        }
        throw new MerkleGeneratorError(
            `Failed to parse CSV file: ${(error as Error).message}`,
            "CSV_PARSE_ERROR",
            { filePath, error: (error as Error).message }
        );
    }

    // Handle duplicates
    if (duplicates.length > 0) {
        console.warn(`⚠️  Found ${duplicates.length} duplicate address(es):`);
        duplicates.forEach(addr => console.warn(`   ${addr}`));

        // Remove duplicates, keeping the last occurrence
        const uniqueEntries = new Map<string, RawEntry>();
        rawEntries.forEach(entry => {
            uniqueEntries.set(entry.address, entry);
        });

        console.log(`Proceeding with ${uniqueEntries.size} unique entries (removed ${rawEntries.length - uniqueEntries.size} duplicates)`);
        const finalRawEntries = Array.from(uniqueEntries.values());

        return finalRawEntries.map((entry, index) => ({
            ...entry,
            originalIndex: index
        }));
    }

    return rawEntries.map((entry, index) => ({
        ...entry,
        originalIndex: index
    }));
}

// Convert amounts to token units
function processEntries(entries: Entry[], decimals: number): Entry[] {
    return entries.map(entry => {
        try {
            const amount = parseUnits(entry.amount, decimals).toString();
            return { ...entry, amount };
        } catch (error) {
            throw new MerkleGeneratorError(
                `Failed to convert amount for address ${entry.address}: ${entry.amount}`,
                "AMOUNT_CONVERSION_ERROR",
                { address: entry.address, amount: entry.amount, decimals }
            );
        }
    });
}

// Deterministic sorting for reproducible builds
function sortEntries(entries: Entry[]): Entry[] {
    return [...entries].sort((a, b) => {
        // Sort by address first, then by amount
        const addrCompare = a.address.localeCompare(b.address);
        if (addrCompare !== 0) return addrCompare;
        return BigInt(a.amount) < BigInt(b.amount) ? -1 : BigInt(a.amount) > BigInt(b.amount) ? 1 : 0;
    });
}

// Verify proofs after generation
function verifyProofs(entries: Entry[], root: string, getProof: (index: number) => string[]): void {
    console.log("🔍 Verifying generated proofs...");

    let verified = 0;
    let failed = 0;
    const sampleSize = Math.min(entries.length, 100); // Verify up to 100 proofs for performance
    const sampleIndices = entries.length <= 100 ?
        entries.map((_, i) => i) :
        Array.from({length: sampleSize}, () => Math.floor(Math.random() * entries.length));

    for (const index of sampleIndices) {
        const entry = entries[index];
        const leaf = hashLeaf(entry.address, entry.amount);
        const proof = getProof(index);

        let computedRoot = leaf;
        for (const proofElement of proof) {
            computedRoot = hashPair(computedRoot, proofElement);
        }

        if (computedRoot.toLowerCase() === root.toLowerCase()) {
            verified++;
        } else {
            failed++;
            console.error(`❌ Proof verification failed for ${entry.address} (index ${index})`);
        }
    }

    if (failed > 0) {
        throw new MerkleGeneratorError(
            `Proof verification failed for ${failed} entries`,
            "PROOF_VERIFICATION_FAILED"
        );
    }

    console.log(`✅ Verified ${verified}/${sampleSize} proofs successfully`);
}

// Generate statistics
function generateStats(entries: Entry[], totalAmount: bigint, decimals: number) {
    const amounts = entries.map(e => BigInt(e.amount));
    const min = amounts.reduce((a, b) => a < b ? a : b);
    const max = amounts.reduce((a, b) => a > b ? a : b);
    const avg = totalAmount / BigInt(entries.length);

    console.log("\n📊 Distribution Statistics:");
    console.log(`   Total Recipients: ${entries.length.toLocaleString()}`);
    console.log(`   Total Amount: ${formatUnits(totalAmount, decimals)} tokens`);
    console.log(`   Min Amount: ${formatUnits(min, decimals)} tokens`);
    console.log(`   Max Amount: ${formatUnits(max, decimals)} tokens`);
    console.log(`   Average Amount: ${formatUnits(avg, decimals)} tokens`);
}

// Main execution
async function main() {
    console.log("🌳 Merkle Tree Generator\n");

    try {
        // Load and validate entries
        console.log(`📄 Loading entries from ${config.inputFile}...`);
        let entries = await loadAndValidateEntries(config.inputFile);

        // Process amounts
        console.log(`💰 Converting amounts to ${config.decimals} decimals...`);
        entries = processEntries(entries, config.decimals);

        // Sort for deterministic output
        if (config.sortEntries) {
            console.log("🔄 Sorting entries for reproducible build...");
            entries = sortEntries(entries);
        }

        // Calculate total
        const totalAmount = entries.reduce((sum, entry) => sum + BigInt(entry.amount), 0n);

        // Generate statistics
        if (options.verbose) {
            generateStats(entries, totalAmount, config.decimals);
        }

        // Build optimized tree
        console.log("🌳 Building Merkle tree...");
        const leaves = entries.map(e => hashLeaf(e.address, e.amount));
        const { root, getProof } = buildTreeOptimized(leaves);

        const treeDepth = Math.ceil(Math.log2(leaves.length || 1));

        // Verify proofs if requested
        if (config.verifyProofs) {
            verifyProofs(entries, root, getProof);
        }

        // Build claims object
        console.log("📝 Generating claims data...");
        const claims: Claims = {
            merkleRoot: root,
            tokenTotal: totalAmount.toString(),
            totalEntries: entries.length,
            treeDepth,
            generatedAt: new Date().toISOString(),
            config,
            claims: {}
        };

        // Progress reporting for large datasets
        const showProgress = entries.length > 1000;
        let processed = 0;

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const proof = getProof(i);
            claims.claims[entry.address] = {
                index: i,
                amount: entry.amount,
                proof
            };

            processed++;
            if (showProgress && processed % 1000 === 0) {
                console.log(`   Generated ${processed}/${entries.length} proofs...`);
            }
        }

        // Write outputs
        const distributionPath = path.join(config.outputDir, "distribution.json");
        const treePath = path.join(config.outputDir, "tree.json");

        console.log("💾 Writing output files...");
        fs.writeFileSync(distributionPath, JSON.stringify(claims, null, 2));

        // Write tree data (for debugging/analysis)
        const treeData = {
            root,
            entries: entries.map(e => ({ address: e.address, amount: e.amount })),
            leaves,
            depth: treeDepth,
            config,
            generatedAt: claims.generatedAt
        };

        fs.writeFileSync(treePath, JSON.stringify(treeData, null, 2));

        // Success summary
        console.log("\n✅ Merkle tree generation completed successfully!");
        console.log(`   Merkle Root: ${root}`);
        console.log(`   Total Entries: ${entries.length.toLocaleString()}`);
        console.log(`   Tree Depth: ${treeDepth}`);
        console.log(`   Total Amount: ${formatUnits(totalAmount, config.decimals)} tokens`);
        console.log(`   Distribution File: ${distributionPath}`);
        console.log(`   Tree File: ${treePath}`);

    } catch (error) {
        if (error instanceof MerkleGeneratorError) {
            console.error(`\n❌ ${error.message}`);
            if (error.details && options.verbose) {
                console.error(`   Details:`, error.details);
            }
            process.exit(1);
        }

        console.error(`\n💥 Unexpected error:`, error);
        process.exit(1);
    }
}

// Execute if run directly
if (require.main === module) {
    main().catch(console.error);
}