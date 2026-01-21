import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

const BINARY_NAME = "rustc";

const PLATFORMS = {
  "darwin-arm64":
    "https://static.rust-lang.org/dist/rust-1.92.0-aarch64-apple-darwin.tar.xz",
  "darwin-x64":
    "https://static.rust-lang.org/dist/rust-1.92.0-x86_64-apple-darwin.tar.xz",
  "linux-x64":
    "https://static.rust-lang.org/dist/rust-1.92.0-x86_64-unknown-linux-gnu.tar.xz",
};

const ANDROID_STDS = [
  "https://static.rust-lang.org/dist/rust-std-1.92.0-i686-linux-android.tar.gz",
  "https://static.rust-lang.org/dist/rust-std-1.92.0-x86_64-linux-android.tar.gz",
  "https://static.rust-lang.org/dist/rust-std-1.92.0-armv7-linux-androideabi.tar.xz",
  "https://static.rust-lang.org/dist/rust-std-1.92.0-aarch64-linux-android.tar.xz",
];

async function setupIndependentRust(unpackedPath: string) {
  const distPath = path.join(unpackedPath, "dist");
  const binPath = path.join(distPath, "bin");
  const libPath = path.join(distPath, "lib");

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
  const platformKey = `${process.platform}-${process.arch}`;
  const targetTriple =
    platformKey === "linux-x64"
      ? "x86_64-unknown-linux-gnu"
      : platformKey === "darwin-arm64"
        ? "aarch64-apple-darwin"
        : platformKey === "darwin-x64"
          ? "x86_64-apple-darwin"
          : "";

  console.log(`📦 Assembling toolchain for ${targetTriple}...`);

  console.log("📦 Copying binaries and libraries...");

  // Copy rustc binaries and libs
  copyDir(path.join(unpackedPath, "rustc", "bin"), binPath);
  copyDir(path.join(unpackedPath, "rustc", "lib"), libPath);

  // Copy cargo binaries
  copyDir(path.join(unpackedPath, "cargo", "bin"), binPath);

  // Copy the standard library (the missing piece)
  // This moves .../lib/rustlib/target into dist/lib/rustlib/target
  const stdLibSrc = path.join(
    unpackedPath,
    `rust-std-${targetTriple}`,
    "lib",
    "rustlib",
  );
  const stdLibDest = path.join(libPath, "rustlib");
  copyDir(stdLibSrc, stdLibDest);

  // Copy additional Android standard libraries if on Linux
  if (process.platform === "linux") {
    console.log("🤖 Copying Android standard libraries...");
    const androidTargets = [
      "i686-linux-android",
      "x86_64-linux-android",
      "armv7-linux-androideabi",
      "aarch64-linux-android",
    ];

    for (const target of androidTargets) {
      const androidStdSrc = path.join(
        unpackedPath,
        `rust-std-${target}`,
        "lib",
        "rustlib",
        target,
      );
      const androidStdDest = path.join(libPath, "rustlib", target);
      copyDir(androidStdSrc, androidStdDest);
    }
  }

  if (existsSync(path.join(__dirname, "dist"))) {
    rmSync(path.join(__dirname, "dist"), { recursive: true, force: true });
  }

  mkdirSync(path.join(__dirname, "dist"));
  copyDir(distPath, path.join(__dirname, "dist"));

  console.log("✅ Toolchain assembled successfully.");
}

async function downloadAndExtract(url: string, extractPath: string) {
  const tempArchivePath = path.join(
    __dirname,
    "download",
    path.basename(new URL(url).pathname),
  );

  const downloadPath = path.join(__dirname, "download");
  if (!existsSync(downloadPath)) {
    mkdirSync(downloadPath, { recursive: true });
  }

  try {
    console.log(`📡 Fetching: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const totalSize = parseInt(
      response.headers.get("content-length") || "0",
      10,
    );
    const reader = response?.body?.getReader?.();
    let receivedLength = 0;

    const writer = createWriteStream(tempArchivePath);

    console.log(`📥 Downloading ${path.basename(tempArchivePath)}...`);

    while (true) {
      const { done, value } = (await reader?.read?.()) || {
        done: true,
        value: undefined,
      };
      if (done) break;

      writer.write(value);
      receivedLength += value.length;

      if (totalSize) {
        const percent = ((receivedLength / totalSize) * 100).toFixed(1);
        process.stdout.write(
          `\r   > ${percent}% [${(receivedLength / 1024 / 1024).toFixed(2)}MB / ${(totalSize / 1024 / 1024).toFixed(2)}MB]`,
        );
      } else {
        process.stdout.write(
          `\r   > Received: ${(receivedLength / 1024 / 1024).toFixed(2)} MB`,
        );
      }
    }

    writer.end();
    return new Promise<void>((resolve, reject) => {
      writer.on("finish", async () => {
        process.stdout.write("\n✅ Download complete!\n");
        console.log(`📦 Extracting ${path.basename(tempArchivePath)}...`);

        const tarProcess = spawnSync(
          "tar",
          ["-xf", tempArchivePath, "--strip-components=1", `-C`, extractPath],
          {
            stdio: "inherit",
            cwd: extractPath,
          },
        );

        if (tarProcess.status !== 0) {
          reject(new Error(`Tar extraction failed for ${url}`));
        } else {
          await rm(tempArchivePath);
          resolve();
        }
      });
      writer.on("error", reject);
    });
  } catch (error) {
    console.error(`\n❌ Failed to download ${url}:`, error);
    if (existsSync(tempArchivePath)) await rm(tempArchivePath);
    throw error;
  }
}

async function run() {
  const platformKey = `${process.platform}-${process.arch}`;
  const mainUrl = (PLATFORMS as any)[platformKey];

  if (!mainUrl) {
    console.error(`❌ Unsupported platform: ${platformKey}`);
    process.exit(1);
  }

  const extractPath = path.join(__dirname, "extract");
  if (existsSync(extractPath)) {
    rmSync(extractPath, { recursive: true, force: true });
  }
  mkdirSync(extractPath, { recursive: true });

  try {
    // 1. Download and extract main toolchain
    await downloadAndExtract(mainUrl, extractPath);

    // 2. Download and extract Android std libs if on Linux
    if (process.platform === "linux") {
      console.log("🤖 Downloading Android standard libraries...");
      for (const url of ANDROID_STDS) {
        await downloadAndExtract(url, extractPath);
      }
    }

    // 3. Assemble the toolchain
    await setupIndependentRust(extractPath);

    const binPath = path.join(__dirname, "dist", "bin", BINARY_NAME);
    if (existsSync(binPath)) {
      chmodSync(binPath, 0o755);
      console.log(
        `🚀 Success! Rust toolchain ready at: ${path.join(__dirname, "dist")}`,
      );
    }
  } catch (error) {
    console.error("\n❌ Installation failed:", error);
    process.exit(1);
  }
}

run();
