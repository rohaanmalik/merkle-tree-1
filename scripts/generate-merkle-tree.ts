#!/usr/bin/env node

import {
  encodeAbiParameters,
  getAddress,
  parseUnits,
  keccak256,
  formatUnits,
  hexToBytes,
  type Address,
  type Hex,
  parseAbiParameters,
  encodePacked,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { Command } from "commander";
import { configDotenv } from "dotenv";

// Merkle tree generator using double-hashed leaves:
// leaf = keccak256(keccak256(abi.encode(address,uint256)))
// Internal node hashing matches OpenZeppelin MerkleProof

configDotenv();
type Entry = { address: Address; amount: string };

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

const leafParams = parseAbiParameters("address account, uint256 amount");

function toBytes(hex: Hex): Buffer {
  return Buffer.from(hexToBytes(hex));
}

function hashPair(a: Hex, b: Hex): Hex {
  const [left, right] =
    Buffer.compare(toBytes(a), toBytes(b)) <= 0 ? [a, b] : [b, a];
  return keccak256(Buffer.concat([toBytes(left), toBytes(right)]));
}

function hashLeaf(address: Address, amount: string): Hex {
  const encodedData = encodeAbiParameters(leafParams, [
    address,
    BigInt(amount),
  ]);
  const innerHash = keccak256(encodedData);
  // The second hash is on the bytes of the first hash.
  // viem's keccak256 accepts a hex string (representing bytes) directly.
  return keccak256(innerHash);
}

function buildTree(leaves: Hex[]): {
  root: Hex;
  getProof: (index: number) => Hex[];
} {
  if (leaves.length === 0)
    return {
      root: "0x0000000000000000000000000000000000000000000000000000000000000000",
      getProof: () => [],
    };

  const allLayers: Hex[][] = [leaves];
  let currentLayer = leaves;

  while (currentLayer.length > 1) {
    const nextLayer: Hex[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const a = currentLayer[i];
      const b =
        i + 1 < currentLayer.length ? currentLayer[i + 1] : currentLayer[i];
      nextLayer.push(hashPair(a, b));
    }
    allLayers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return {
    root: currentLayer[0],
    getProof: (index: number) => {
      const proof: Hex[] = [];
      let idx = index;
      for (let layer = 0; layer < allLayers.length - 1; layer++) {
        const nodes = allLayers[layer];
        const isRight = idx % 2 === 1;
        const pairIndex = isRight ? idx - 1 : idx + 1;
        const sibling =
          pairIndex < nodes.length ? nodes[pairIndex] : nodes[idx];
        proof.push(sibling);
        idx = Math.floor(idx / 2);
      }
      return proof;
    },
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
      .on("data", (row) => {
        if (!row.address || !row.amount) {
          reject(
            new Error(
              `Missing address or amount in row: ${JSON.stringify(row)}`,
            ),
          );
          return;
        }

        try {
          const address = getAddress(row.address.trim());
          const amount = row.amount.trim();

          if (!/^\d+(\.\d+)?$/.test(amount) || parseFloat(amount) <= 0) {
            reject(new Error(`Invalid amount: ${amount}`));
            return;
          }

          if (seen.has(address.toLowerCase())) {
            console.warn(`Duplicate address: ${address}`);
            return;
          }

          seen.add(address.toLowerCase());
          entries.push({ address, amount });
        } catch (e) {
          reject(e);
        }
      })
      .on("end", () => resolve(entries))
      .on("error", reject);
  });
}

function processEntries(entries: Entry[], decimals: number): Entry[] {
  return entries.map((entry) => ({
    ...entry,
    amount: parseUnits(entry.amount, decimals).toString(),
  }));
}

async function main() {
  try {
    console.log(`Loading entries from ${inputFile}...`);
    let entries = await loadEntries(inputFile);

    console.log(`Converting amounts to ${decimals} decimals...`);
    entries = processEntries(entries, decimals);

    // Sort for deterministic output
    entries.sort((a, b) =>
      a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
    );

    const totalAmount = entries.reduce(
      (sum, entry) => sum + BigInt(entry.amount),
      0n,
    );

    if (options.verbose) {
      console.log(`Total entries: ${entries.length}`);
      console.log(`Total amount: ${formatUnits(totalAmount, decimals)} tokens`);
    }

    console.log("Building Merkle tree...");
    const leaves = entries.map((e) => hashLeaf(e.address, e.amount));
    const { root, getProof } = buildTree(leaves);

    const claims = {
      merkleRoot: root,
      tokenTotal: totalAmount.toString(),
      totalEntries: entries.length,
      treeDepth: Math.ceil(Math.log2(leaves.length || 1)),
      generatedAt: new Date().toISOString(),
      claims: {} as Record<
        Address,
        { index: number; amount: string; proof: Hex[]; signature: Hex }
      >,
    };

    console.log("Generating proofs and signatures...");
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      claims.claims[entry.address] = {
        index: i,
        amount: entry.amount,
        proof: getProof(i),
        // NOTE: Make sure the contract address and chainId are correct
        signature: await generateClaimSignature(
          entry.address,
          entry.amount,
          "0xC19d689FEBDec3e5598572d3C71f82AD36b8F008", // Example contract address
          11155111, // Example chain ID (Sepolia)
        ),
      };
    }

    const distributionPath = path.join(outputDir, "distribution.json");
    const treePath = path.join(outputDir, "tree.json");

    fs.writeFileSync(distributionPath, JSON.stringify(claims, null, 2));
    fs.writeFileSync(
      treePath,
      JSON.stringify(
        {
          root,
          entries: entries.map((e) => ({
            address: e.address,
            amount: e.amount,
          })),
          leaves,
          depth: claims.treeDepth,
          generatedAt: claims.generatedAt,
        },
        null,
        2,
      ),
    );

    console.log(`✅ Generated Merkle tree with ${entries.length} entries`);
    console.log(`Root: ${root}`);
    console.log(`Files: ${distributionPath}, ${treePath}`);
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

/**
 * Generates a signature for a claim, matching a contract's EIP-191 signature check.
 * The hash is constructed as keccak256(abi.encodePacked(onBehalfOf, amount, contractAddress, chainId))
 * and then signed.
 *
 * @param onBehalfOf The address of the user claiming the airdrop.
 * @param amount The amount of tokens to claim (in wei).
 * @param contractAddress The address of the deployed smart contract.
 * @param chainId The chain ID of the network where the contract is deployed.
 * @returns A promise that resolves to the signature hex string.
 */
export async function generateClaimSignature(
  onBehalfOf: Address,
  amount: string,
  contractAddress: Address,
  chainId: number,
): Promise<Hex> {
  const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
  console;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY is not set in the .env file");
  }

  const signerAccount = privateKeyToAccount(privateKey);

  const messageHash = keccak256(
    encodePacked(
      ["address", "uint256", "address", "uint256"],
      [onBehalfOf, BigInt(amount), contractAddress, BigInt(chainId)],
    ),
  );

  // Sign the raw message hash. `signMessage` with a raw hash will compute the
  // EIP-191 prefixed hash (`toEthSignedMessageHash` in Solidity) before signing.
  const signature = await signerAccount.signMessage({
    message: { raw: messageHash },
  });

  return signature;
}

if (require.main === module) {
  main();
}
