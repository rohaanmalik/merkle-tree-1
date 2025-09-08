import { Wallet } from "ethers";
import fs from "fs";

// Random allowlist generator: outputs data/allowlist.csv with header: address,amount
// Configure via env:
//  - ALLOWLIST_COUNT (default: 10)
//  - ALLOWLIST_MIN (default: 0.01)
//  - ALLOWLIST_MAX (default: 100)
//  - ALLOWLIST_DECIMALS (decimal places in CSV, default: 4)

const COUNT = Number(process.env.ALLOWLIST_COUNT ?? 10);
const MIN = Number(process.env.ALLOWLIST_MIN ?? 0.01);
const MAX = Number(process.env.ALLOWLIST_MAX ?? 100);
const DEC_PLACES = Number(process.env.ALLOWLIST_DECIMALS ?? 4);

if (!Number.isFinite(COUNT) || COUNT <= 0) throw new Error("Invalid ALLOWLIST_COUNT");
if (!Number.isFinite(MIN) || !Number.isFinite(MAX) || MIN <= 0 || MAX <= 0 || MAX < MIN) {
    throw new Error("Invalid ALLOWLIST_MIN/MAX");
}

function randomAmount(): string {
    const value = MIN + Math.random() * (MAX - MIN);
    const s = value.toFixed(DEC_PLACES);
    return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

const lines: string[] = ["address,amount"]; 
const seen = new Set<string>();

while (lines.length - 1 < COUNT) {
    const addr = Wallet.createRandom().address;
    if (seen.has(addr)) continue;
    seen.add(addr);
    const amount = randomAmount();
    lines.push(`${addr},${amount}`);
}

fs.writeFileSync("data/allowlist.csv", lines.join("\n"));
console.log(`Wrote ${COUNT} entries to data/allowlist.csv`);

