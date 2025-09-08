import { AbiCoder, getAddress, parseUnits, keccak256 } from "ethers";
import fs from "fs";

// Generator using double-hashed leaves per Cyfrin guidance:
// leaf = keccak256( keccak256( abi.encode(address,uint256) ) )
// Internal node hashing matches OpenZeppelin MerkleProof: keccak256(concatOrdered(a, b))

type Entry = { address: string; amount: string };
type Claims = {
    merkleRoot: string;
    tokenTotal: string;
    claims: Record<string, { index: number; amount: string; proof: string[] }>;
};

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

function buildTree(leaves: string[]): { layers: string[][]; root: string } {
    if (leaves.length === 0) return { layers: [[]], root: "0x" + "00".repeat(32) };
    const layers: string[][] = [];
    layers.push(leaves);
    while (layers[layers.length - 1].length > 1) {
        const prev = layers[layers.length - 1];
        const next: string[] = [];
        for (let i = 0; i < prev.length; i += 2) {
            const a = prev[i];
            const b = i + 1 < prev.length ? prev[i + 1] : prev[i];
            next.push(hashPair(a, b));
        }
        layers.push(next);
    }
    return { layers, root: layers[layers.length - 1][0] };
}

function getProof(index: number, layers: string[][]): string[] {
    const proof: string[] = [];
    let idx = index;
    for (let layer = 0; layer < layers.length - 1; layer++) {
        const nodes = layers[layer];
        const isRight = idx % 2 === 1;
        const pairIndex = isRight ? idx - 1 : idx + 1;
        const sibling = pairIndex < nodes.length ? nodes[pairIndex] : nodes[idx];
        proof.push(sibling);
        idx = Math.floor(idx / 2);
    }
    return proof;
}

// 1) Load allowlist.csv (address, amountDecimal). Convert to token units (18 decimals)
const DECIMALS = 18;
const csv = fs.readFileSync("data/allowlist.csv", "utf8").trim().split(/\r?\n/);
const rows = csv.slice(1); // skip header

const entries: Entry[] = rows.map((line) => {
    const [addrRaw, amtDec] = line.split(",");
    const address = getAddress(addrRaw.trim());
    const amount = parseUnits(amtDec.trim(), DECIMALS).toString();
    return { address, amount };
});

// 2) Build leaves and full Merkle tree
const leaves = entries.map((e) => hashLeaf(e.address, e.amount));
const { layers, root } = buildTree(leaves);

// 3) Build distribution.json (index, amount, proof)
const claims: Claims = { merkleRoot: root, tokenTotal: "0", claims: {} };
let total = 0n;
for (let i = 0; i < entries.length; i++) {
    const { address, amount } = entries[i];
    const proof = getProof(i, layers);
    claims.claims[address] = { index: i, amount, proof };
    total += BigInt(amount);
}
claims.tokenTotal = total.toString();

// 4) Persist outputs
fs.writeFileSync("distribution.json", JSON.stringify(claims, null, 2));
fs.writeFileSync(
    "tree.json",
    JSON.stringify(
        {
            root,
            entries,
            leaves,
            depth: layers.length - 1
        },
        null,
        2
    )
);

console.log("Merkle Root:", root);
console.log("Generated", entries.length, "entries from CSV");
console.log("Saved to distribution.json and tree.json");