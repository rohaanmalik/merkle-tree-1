import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import fs from "fs";

// Load tree
const treeData = JSON.parse(fs.readFileSync("tree.json", "utf8"));
const tree = StandardMerkleTree.load(treeData.tree);

// Get first entry
const entry = treeData.entries[0];
const { address, amount } = entry;
const proof = tree.getProof(0);

console.log("Testing verification for:");
console.log("Address:", address);
console.log("Amount:", amount);
console.log("Proof:", proof);

// Verify locally
const isValid = tree.verify(0, proof);
console.log("Valid:", isValid);