import { Storage } from "@google-cloud/storage";
import { Command } from "commander";
import fs from "fs";
import path from "path";

const program = new Command();
program
  .option("--upload", "Upload files to GCP bucket")
  .option("--bucket <name>", "GCP bucket name", "elixir-deusd-prod")
  .option("--path <path>", "GCP path prefix", "claims/")
  .parse();

const options = program.opts();

if (!fs.existsSync("distribution.json")) {
  console.error("❌ Error: distribution.json not found");
  process.exit(1);
}

const distribution = JSON.parse(fs.readFileSync("distribution.json", "utf8"));
const claimsDir = "dist/claims";

// Create output directory
fs.mkdirSync(claimsDir, { recursive: true });

console.log(
  `📄 Generating ${Object.keys(distribution.claims).length} individual claim files...`,
);

const files: { filename: string; data: any }[] = [];

// Generate individual JSON files for each address
for (const [address, claimData] of Object.entries(distribution.claims)) {
  const filename = `${address}.json`;
  const filePath = path.join(claimsDir, filename);

  // Write file locally
  fs.writeFileSync(filePath, JSON.stringify(claimData, null, 2));

  files.push({ filename, data: claimData });
}

console.log(`✅ Generated ${files.length} files in ${claimsDir}/`);

// Upload to GCP if requested
if (options.upload) {
  uploadToGCP();
} else {
  console.log(
    `\n💡 Dry run complete. Use --upload flag to upload to GCP bucket.`,
  );
  printSummary();
}

async function uploadToGCP() {
  console.log(`\n🚀 Uploading to GCP bucket: ${options.bucket}`);

  const storage = new Storage();
  const bucket = storage.bucket(options.bucket);

  let uploadedCount = 0;

  for (const file of files) {
    const localPath = path.join(claimsDir, file.filename);
    const remotePath = `${options.path}${file.filename}`;

    try {
      await bucket.upload(localPath, {
        destination: remotePath,
        metadata: {
          contentType: "application/json",
          cacheControl: "public, max-age=3600",
        },
      });

      uploadedCount++;
      console.log(`✅ Uploaded: ${remotePath}`);
    } catch (error: any) {
      console.error(`❌ Failed to upload ${file.filename}:`, error.message);
    }
  }

  console.log(
    `\n🎉 Upload complete: ${uploadedCount}/${files.length} files uploaded successfully`,
  );
  printSummary();
}
function printSummary() {
  console.log(`\n📊 Summary:`);
  console.log(`  • Total addresses: ${files.length}`);
  console.log(`  • Local directory: ${claimsDir}/`);
  if (options.upload) {
    console.log(`  • GCP bucket: gs://${options.bucket}/${options.path}`);
  }
}

