import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

const BINARY_NAME = "rustc";

const PLATFORMS: Record<string, string> = {
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

    // FIX: Convert to ArrayBuffer to ensure data is fully received
    const data = await response.arrayBuffer();
    
    // Check if we actually got data
    if (data.byteLength === 0) {
      throw new Error("Downloaded file is empty (0 bytes).");
    }

    console.log(`💾 Saving ${data.byteLength} bytes to disk...`);
    await Bun.write(tempArchivePath, data);

    console.log("📦 Extracting...");

    // -x: extract, -f: file, -C: destination
    // --strip-components=1 removes the top-level "rust-1.92.0-..." folder
    const tarProcess = Bun.spawn(["tar", "-xf", tempArchivePath, "-C", __dirname, "--strip-components=1"], {
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await tarProcess.exited;
    if (exitCode !== 0) throw new Error("Tar extraction failed.");

    // Cleanup
    await rm(tempArchivePath);

    // Verify
    const binPath = path.join(__dirname, "bin", BINARY_NAME);
    if (existsSync(binPath)) {
      chmodSync(binPath, 0o755);
      console.log(`✅ Success! Binary located at: ${binPath}`);
    }

  } catch (error) {
    console.error("❌ Installation failed:", error);
    if (existsSync(tempArchivePath)) await rm(tempArchivePath);
    process.exit(1);
  }
}

download();