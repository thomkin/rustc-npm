import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createWriteStream } from 'node:fs';
import { rm } from "node:fs/promises";
import path from "node:path";

console.log("Fish")


const BINARY_NAME = "rustc";

const PLATFORMS = {
  "darwin-arm64": "https://static.rust-lang.org/dist/rust-1.92.0-aarch64-apple-darwin.tar.xz",
  "darwin-x64": "https://static.rust-lang.org/dist/rust-1.92.0-x86_64-apple-darwin.tar.xz",
  "linux-x64": "https://static.rust-lang.org/dist/rust-1.92.0-x86_64-unknown-linux-gnu.tar.xz",
};

async function setupIndependentRust(unpackedPath: string) {
  const distPath = path.join(unpackedPath, 'dist');
  const binPath = path.join(distPath, 'bin');
  const libPath = path.join(distPath, 'lib');

  console.log(`Creating independent toolchain at: ${distPath}`);

  // 1. Create directory structure
  if (existsSync(distPath)) {
    rmSync(distPath, { recursive: true, force: true });
  }
  mkdirSync(binPath, { recursive: true });
  mkdirSync(libPath, { recursive: true });

  // Helper for recursive copying
  const copyDir = (src: string, dest: string) => {
    if (!existsSync(src)) {
      console.warn(`⚠️ Warning: Source not found: ${src}`);
      return;
    }
    cpSync(src, dest, { recursive: true });
  };

  // 2. Map tarball folders to standard layout
  // Note: Adjust the 'rust-std' folder name if you change architectures
  const targetTriple = 'x86_64-unknown-linux-gnu'; 

  console.log("📦 Copying binaries and libraries...");
  
  // Copy rustc binaries and libs
  copyDir(path.join(unpackedPath, 'rustc', 'bin'), binPath);
  copyDir(path.join(unpackedPath, 'rustc', 'lib'), libPath);

  // Copy cargo binaries
  copyDir(path.join(unpackedPath, 'cargo', 'bin'), binPath);

  // Copy the standard library (the missing piece)
  // This moves .../lib/rustlib/target into dist/lib/rustlib/target
  const stdLibSrc = path.join(unpackedPath, `rust-std-${targetTriple}`, 'lib', 'rustlib');
  const stdLibDest = path.join(libPath, 'rustlib');
  copyDir(stdLibSrc, stdLibDest);

  mkdirSync(path.join(__dirname, 'dist'))
  copyDir(distPath, path.join(__dirname, 'dist'));

  console.log("✅ Toolchain assembled successfully.");
}

const platformKey = `${process.platform}-${process.arch}`;
const url = PLATFORMS[platformKey];

async function download() {
  if (!url) {
    console.error(`❌ Unsupported platform: ${platformKey}`);
    process.exit(1);
  }

  const tempArchivePath = path.join(__dirname, "download", "temp-archive.tar.xz");
  // rmSync(tempArchivePath, {recursive: true});
  const downloadPath = path.join(__dirname, "download");
  const extractPath =  path.join(__dirname, "extract");

  if (existsSync(downloadPath)) {
    rmSync(downloadPath, { recursive: true, force: true });
  }

   if (existsSync(extractPath)) {
    rmSync(extractPath, { recursive: true, force: true });
  }

  mkdirSync(downloadPath, {recursive: true});
  mkdirSync(extractPath, {recursive: true});
  
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
    // const file = Bun.file(tempArchivePath);
    // const writer = file.writer();
    
    // Note: 'node:fs/promises' doesn't have createWriteStream, 
    // you use the base 'node:fs' package for streams.

    // 1. Setup the File Path


    // 2. Setup the Node.js WriteStream (Direct to disk streaming)
    const writer = createWriteStream(tempArchivePath);

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
    writer.end();
    writer.close(async() => {
      process.stdout.write("\n✅ Download complete!\n");

      console.log("📦 Extracting...");
      const tarProcess = spawnSync(["tar", "-xf", tempArchivePath, "--strip-components=1", `-C ${extractPath}`].join(' '), {
      stdio: 'inherit',
      shell: true,
      cwd: extractPath,
      });

      const exitCode = tarProcess.status;
      if (exitCode !== 0) throw new Error("Tar extraction failed.");

      setupIndependentRust(downloadPath);

      await rm(tempArchivePath);

      const binPath = path.join(__dirname, "bin", BINARY_NAME);
      if (existsSync(binPath)) {
        chmodSync(binPath, 0o755);
        console.log(`🚀 Success! Rust toolchain ready at: ${__dirname}`);
      }
    })

  } catch (error) {
    console.error("\n❌ Installation failed:", error);
    if (existsSync(tempArchivePath)) await rm(tempArchivePath);
    process.exit(1);
  }
}

download();