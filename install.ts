import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

const BINARY_NAME = "rustc";

const PLATFORMS = {
  "darwin-arm64": "https://static.rust-lang.org/dist/rust-1.92.0-aarch64-apple-darwin.tar.xz",
  "darwin-x64": "https://static.rust-lang.org/dist/rust-1.92.0-x86_64-apple-darwin.tar.xz",
  "linux-x64": "https://static.rust-lang.org/dist/rust-1.92.0-x86_64-unknown-linux-gnu.tar.xz",
};

const platformKey = `${process.platform}-${process.arch}`;
const url = PLATFORMS[platformKey];

async function download() {
  if (!url) {
    console.error(`❌ Unsupported platform: ${platformKey}`);
    process.exit(1);
  }

  const tempArchivePath = path.join(__dirname, "temp-archive.tar.xz");
  
  try {
    console.log(`📡 Fetching: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 1. Setup the reader and progress tracking
    const totalSize = parseInt(response.headers.get("content-length") || "0", 10);
    const reader = response.body.getReader();
    let receivedLength = 0;

    // 2. Setup the Bun File Writer (Direct to disk streaming)
    const file = Bun.file(tempArchivePath);
    const writer = file.writer();

    console.log("📥 Starting download...");

    // 3. Read chunks and update console
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      // Write chunk to file
      writer.write(value);
      receivedLength += value.length;

      // Calculate and display progress
      if (totalSize) {
        const percent = ((receivedLength / totalSize) * 100).toFixed(1);
        const downloadedMB = (receivedLength / 1024 / 1024).toFixed(2);
        const totalMB = (totalSize / 1024 / 1024).toFixed(2);
        // \r moves the cursor back to the start of the line for a clean overwrite
        process.stdout.write(`\r   > ${percent}% [${downloadedMB}MB / ${totalMB}MB]`);
      } else {
        process.stdout.write(`\r   > Received: ${(receivedLength / 1024 / 1024).toFixed(2)} MB`);
      }
    }

    // Ensure the writer finishes flushing to disk
    await writer.end();
    process.stdout.write("\n✅ Download complete!\n");

    console.log("📦 Extracting...");
    const tarProcess = Bun.spawn(["tar", "-xf", tempArchivePath, "-C", __dirname, "--strip-components=1"], {
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await tarProcess.exited;
    if (exitCode !== 0) throw new Error("Tar extraction failed.");

    await rm(tempArchivePath);

    const binPath = path.join(__dirname, "bin", BINARY_NAME);
    if (existsSync(binPath)) {
      chmodSync(binPath, 0o755);
      console.log(`🚀 Success! Rust toolchain ready at: ${__dirname}`);
    }

  } catch (error) {
    console.error("\n❌ Installation failed:", error);
    if (existsSync(tempArchivePath)) await rm(tempArchivePath);
    process.exit(1);
  }
}

download();