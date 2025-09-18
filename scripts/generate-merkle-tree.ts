#!/usr/bin/env node

import { AbiCoder, getAddress, parseUnits, keccak256, formatUnits } from "ethers";
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { Command } from "commander";

// Merkle tree generator using double-hashed leaves:
// leaf = keccak256(keccak256(abi.encode(address,uint256)))
// Internal node hashing matches OpenZeppelin MerkleProof

type Entry = { address: string; amount: string };

const program = new Command();
program
    .option("-i, --input <file>", "Input CSV file", "data/allowlist.csv")
    .option("-o, --output <dir>", "Output directory", ".")
    .option("-d, --decimals <number>", "Token decimals", "18")
    .option("-v, --verbose", "Verbose output")
    .parse();

const options = program.opts();
const decimals = parseInt(options.decimals);
const inputFile = options.input;
const outputDir = options.output;

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

function buildTree(leaves: string[]): { root: string; getProof: (index: number) => string[] } {
    if (leaves.length === 0) return { root: "0x" + "00".repeat(32), getProof: () => [] };

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

    return {
        root: currentLayer[0],
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

function loadEntries(filePath: string): Promise<Entry[]> {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    return new Promise((resolve, reject) => {
        const entries: Entry[] = [];
        const seen = new Set<string>();

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                if (!row.address || !row.amount) {
                    reject(new Error(`Missing address or amount in row: ${JSON.stringify(row)}`));
                    return;
                }

                const address = getAddress(row.address.trim());
                const amount = row.amount.trim();

                if (!/^\d+(\.\d+)?$/.test(amount) || parseFloat(amount) <= 0) {
                    reject(new Error(`Invalid amount: ${amount}`));
                    return;
                }

                if (seen.has(address)) {
                    console.warn(`Duplicate address: ${address}`);
                    return;
                }

                seen.add(address);
                entries.push({ address, amount });
            })
            .on('end', () => resolve(entries))
            .on('error', reject);
    });
}

function processEntries(entries: Entry[], decimals: number): Entry[] {
    return entries.map(entry => ({
        ...entry,
        amount: parseUnits(entry.amount, decimals).toString()
    }));
}

async function main() {
    try {
        console.log(`Loading entries from ${inputFile}...`);
        let entries = await loadEntries(inputFile);

        console.log(`Converting amounts to ${decimals} decimals...`);
        entries = processEntries(entries, decimals);

        // Sort for deterministic output
        entries.sort((a, b) => a.address.localeCompare(b.address));

        const totalAmount = entries.reduce((sum, entry) => sum + BigInt(entry.amount), 0n);

        if (options.verbose) {
            console.log(`Total entries: ${entries.length}`);
            console.log(`Total amount: ${formatUnits(totalAmount, decimals)} tokens`);
        }

        console.log("Building Merkle tree...");
        const leaves = entries.map(e => hashLeaf(e.address, e.amount));
        const { root, getProof } = buildTree(leaves);

        const claims = {
            merkleRoot: root,
            tokenTotal: totalAmount.toString(),
            totalEntries: entries.length,
            treeDepth: Math.ceil(Math.log2(leaves.length || 1)),
            generatedAt: new Date().toISOString(),
            claims: {} as Record<string, { index: number; amount: string; proof: string[] }>
        };

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            claims.claims[entry.address] = {
                index: i,
                amount: entry.amount,
                proof: getProof(i)
            };
        }

        const distributionPath = path.join(outputDir, "distribution.json");
        const treePath = path.join(outputDir, "tree.json");

        fs.writeFileSync(distributionPath, JSON.stringify(claims, null, 2));
        fs.writeFileSync(treePath, JSON.stringify({
            root,
            entries: entries.map(e => ({ address: e.address, amount: e.amount })),
            leaves,
            depth: claims.treeDepth,
            generatedAt: claims.generatedAt
        }, null, 2));

        console.log(`✅ Generated Merkle tree with ${entries.length} entries`);
        console.log(`Root: ${root}`);
        console.log(`Files: ${distributionPath}, ${treePath}`);

    } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}