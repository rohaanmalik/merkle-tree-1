import { AbiCoder, keccak256 } from "ethers";
import fs from "fs";

// Local verify using double-hash leaves and ordered pair hashing
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

function processProof(leaf: string, proof: string[]): string {
  let computed = leaf;
  for (const p of proof) {
    computed = hashPair(computed, p);
  }
  return computed;
}

// Load distribution
const dist = JSON.parse(fs.readFileSync("distribution.json", "utf8"));
const [firstAddr, first] = Object.entries(dist.claims)[0] as [string, any];

const leaf = hashLeaf(firstAddr, first.amount);
const computedRoot = processProof(leaf, first.proof);

console.log("Testing verification for:");
console.log("Address:", firstAddr);
console.log("Amount:", first.amount);
console.log("Proof:", first.proof);
console.log("Computed Root:", computedRoot);
console.log("Expected Root:", dist.merkleRoot);
console.log("Valid:", computedRoot.toLowerCase() === dist.merkleRoot.toLowerCase());