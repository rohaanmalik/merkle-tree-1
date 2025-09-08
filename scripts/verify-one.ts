import { AbiCoder, keccak256, getAddress } from "ethers";
import fs from "fs";

// Verify a single address (and optional amount) against distribution.json
// Usage:
//   node dist/verify-one.js <address> [amountWei]
// If amount is omitted, uses the amount stored in distribution.json

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
  for (const p of proof) computed = hashPair(computed, p);
  return computed;
}

function main() {
  const addrArg = process.argv[2];
  const amountArg = process.argv[3];
  if (!addrArg) {
    console.error("Usage: node dist/verify-one.js <address> [amountWei]");
    process.exit(1);
  }

  const address = getAddress(addrArg);
  const dist = JSON.parse(fs.readFileSync("distribution.json", "utf8"));
  const claim = dist.claims[address];

  if (!claim) {
    console.error("❌ Address not found in distribution.json");
    process.exit(1);
  }

  const amount = amountArg ?? claim.amount;
  if (amount !== claim.amount) {
    console.error("❌ Amount mismatch vs distribution.json. expected:", claim.amount, "got:", amount);
    process.exit(1);
  }

  const leaf = hashLeaf(address, amount);
  const computedRoot = processProof(leaf, claim.proof);

  const ok = computedRoot.toLowerCase() === String(dist.merkleRoot).toLowerCase();
  console.log("Address:", address);
  console.log("Amount:", amount);
  console.log("Proof:", claim.proof);
  console.log("Computed Root:", computedRoot);
  console.log("Expected Root:", dist.merkleRoot);
  console.log("Valid:", ok);
  process.exit(ok ? 0 : 2);
}

main();


