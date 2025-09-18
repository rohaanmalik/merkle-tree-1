import { AbiCoder, keccak256, getAddress } from "ethers";
import fs from "fs";

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

function verifyAddress(address: string, expectedAmount: string | undefined, dist: any): boolean {
    const claim = dist.claims[address];

    if (!claim) {
        console.log(`❌ Address ${address} not found in distribution`);
        return false;
    }

    if (expectedAmount && expectedAmount !== claim.amount) {
        console.log(`❌ Amount mismatch for ${address}: expected ${expectedAmount}, got ${claim.amount}`);
        return false;
    }

    const leaf = hashLeaf(address, claim.amount);
    let computedRoot = leaf;
    for (const proof of claim.proof) {
        computedRoot = hashPair(computedRoot, proof);
    }

    const isValid = computedRoot.toLowerCase() === dist.merkleRoot.toLowerCase();
    const status = isValid ? "✅" : "❌";
    console.log(`${status} ${address}: ${claim.amount} wei`);

    return isValid;
}

// Check if distribution.json exists
if (!fs.existsSync("distribution.json")) {
    console.error("Error: distribution.json not found");
    process.exit(1);
}

const dist = JSON.parse(fs.readFileSync("distribution.json", "utf8"));
const targetAddress = process.argv[2];
const expectedAmount = process.argv[3];

if (targetAddress) {
    // Verify specific address
    try {
        const address = getAddress(targetAddress);
        const isValid = verifyAddress(address, expectedAmount, dist);
        process.exit(isValid ? 0 : 1);
    } catch (error) {
        console.error(`Error: Invalid address ${targetAddress}`);
        process.exit(1);
    }
} else {
    // Verify all addresses
    console.log(`Verifying ${Object.keys(dist.claims).length} addresses...\n`);

    let validCount = 0;
    let totalCount = 0;

    for (const address of Object.keys(dist.claims)) {
        const isValid = verifyAddress(address, undefined, dist);
        if (isValid) validCount++;
        totalCount++;
    }

    console.log(`\n${validCount}/${totalCount} addresses verified successfully`);
    process.exit(validCount === totalCount ? 0 : 1);
}