import { Wallet } from "ethers";
import fs from "fs";
import { Command } from "commander";

const program = new Command();
program
    .option("-c, --count <number>", "Number of entries", "10")
    .option("--min <number>", "Minimum amount", "0.01")
    .option("--max <number>", "Maximum amount", "100")
    .parse();

const options = program.opts();
const count = parseInt(options.count);
const min = parseFloat(options.min);
const max = parseFloat(options.max);

function randomAmount(): string {
    const value = min + Math.random() * (max - min);
    return value.toFixed(4).replace(/\.?0+$/, "");
}

const lines = ["address,amount"];
const seen = new Set<string>();

while (lines.length - 1 < count) {
    const addr = Wallet.createRandom().address;
    if (seen.has(addr)) continue;
    seen.add(addr);
    lines.push(`${addr},${randomAmount()}`);
}

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/allowlist.csv", lines.join("\n"));
console.log(`Generated ${count} entries in data/allowlist.csv`);
