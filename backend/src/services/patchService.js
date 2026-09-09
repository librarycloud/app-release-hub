import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, mkdir } from "node:fs/promises";
import path from "node:path";
import PQueue from "p-queue";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

// Concurrency queue for bsdiff processes
export const bsdiffQueue = new PQueue({ concurrency: config.maxConcurrentBsdiff });

export async function checkBsdiffAvailable() {
  try {
    await execFileAsync("which", ["bsdiff"]);
    return true;
  } catch {
    return false;
  }
}

export async function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex").toLowerCase()));
    stream.on("error", reject);
  });
}

import os from "node:os";

const MIN_FREE_MEMORY_BYTES = 128 * 1024 * 1024; // 128MB critical memory barrier

async function _generatePatch(oldFilePath, newFilePath, patchOutputPath) {
  const isAvailable = await checkBsdiffAvailable();
  if (!isAvailable) {
    throw new Error("系统未安装 bsdiff，请执行 apt-get install -y bsdiff (Linux) 或 brew install bsdiff (macOS)");
  }
  const freeMem = os.freemem();
  if (freeMem < MIN_FREE_MEMORY_BYTES) {
    throw new Error(`系统当前可用内存极低 (${Math.round(freeMem / 1024 / 1024)}MB < 128MB)，暂缓执行差分以防 OOM 崩溃`);
  }
  await mkdir(path.dirname(patchOutputPath), { recursive: true });
  await execFileAsync("bsdiff", [oldFilePath, newFilePath, patchOutputPath], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const fileStat = await stat(patchOutputPath);
  const sha256 = await computeFileSha256(patchOutputPath);
  return { size: fileStat.size, sha256 };
}

export function generatePatch(oldFilePath, newFilePath, patchOutputPath) {
  return bsdiffQueue.add(() => _generatePatch(oldFilePath, newFilePath, patchOutputPath));
}

