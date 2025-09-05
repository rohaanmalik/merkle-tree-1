import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { ethers } from "ethers";
import fs from "fs";

// Generate random data
const data = [];
for (let i = 0; i < 10; i++) {
    const wallet = ethers.Wallet.createRandom();
    const amount = BigInt(Math.floor(Math.random() * 100) + 1);
    data.push([wallet.address, amount]);
}

// Create tree
const tree = StandardMerkleTree.of(data, ["address", "uint256"]);

// Save tree
const treeData = {
    root: tree.root,
    entries: data.map(([address, amount]) => ({
        address,
        amount: amount.toString()
    })),
    tree: tree.dump()
};

fs.writeFileSync("tree.json", JSON.stringify(treeData, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value, 2));

console.log("Merkle Root:", tree.root);
console.log("Generated", data.length, "random entries");
console.log("Saved to tree.json");

// Generate a sample proof for the first entry
const proof = tree.getProof(0);
console.log("\nSample proof for first entry:");
console.log("Address:", data[0][0]);
console.log("Amount:", data[0][1].toString());
console.log("Proof:", proof);