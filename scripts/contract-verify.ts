import { ethers } from "ethers";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// Contract details
const CONTRACT_ADDRESS = "0xF1157A7538E5584BD3D65b033C82211c3B07cD9d";
const RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || "http://localhost:8545";

// Contract ABI (minimal)
const ABI = [
  "function verify(bytes32[] calldata proof, address account, uint256 amount) external view returns (bool)"
];

async function verifyOnChain(address: string, amount: string) {
  try {
    // Load distribution built with double-hashed leaves
    const dist = JSON.parse(fs.readFileSync("distribution.json", "utf8"));
    
    // Lookup claim record
    const claim = dist.claims[address];
    
    if (!claim || claim.amount !== amount) {
      console.log("❌ Entry not found in distribution or amount mismatch");
      return false;
    }
    
    const proof = claim.proof;
    
    console.log("🔍 Verifying on-chain:");
    console.log("Address:", address);
    console.log("Amount:", amount);
    console.log("Proof:", proof);
    
    // Connect to contract
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
    
    // Call verify function
    const isValid = await contract.verify(proof, address, BigInt(amount));
    
    console.log(isValid ? "✅ Valid proof!" : "❌ Invalid proof");
    return isValid;
    
  } catch (error) {
    console.error("Error:", error);
    return false;
  }
}

// Example usage
async function main() {
  // Test with first entry from tree
  const treeData = JSON.parse(fs.readFileSync("tree.json", "utf8"));
  const firstEntry = treeData.entries[0];
  
  await verifyOnChain(firstEntry.address, firstEntry.amount);
  
  // Test with invalid data
  console.log("\n--- Testing invalid data ---");
  await verifyOnChain("0x0000000000000000000000000000000000000000", "999");
}

main().catch(console.error);