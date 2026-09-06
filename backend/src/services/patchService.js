import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, mkdir } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

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

export async function generatePatch(oldFilePath, newFilePath, patchOutputPath) {
  const isAvailable = await checkBsdiffAvailable();
  if (!isAvailable) {
    throw new Error("系统未安装 bsdiff，请执行 apt-get install -y bsdiff (Linux) 或 brew install bsdiff (macOS)");
  }
  await mkdir(path.dirname(patchOutputPath), { recursive: true });
  await execFileAsync("bsdiff", [oldFilePath, newFilePath, patchOutputPath], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const fileStat = await stat(patchOutputPath);
  const sha256 = await computeFileSha256(patchOutputPath);
  return { size: fileStat.size, sha256 };
}
