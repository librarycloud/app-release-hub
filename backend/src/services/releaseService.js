import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { config } from "../config.js";
import {
  getApp,
  getVersionHistory,
  getLatestVersion,
  getVersion,
  deleteVersionRecord,
  upsertVersion,
  getPatchesForTarget,
  getAllPatches,
  upsertPatch,
} from "./storageAdapter.js";
import { checkBsdiffAvailable, computeFileSha256, generatePatch } from "./patchService.js";
import { getFileExt, findMetadataAsset, findBinaryAsset } from "./assetResolver.js";

const metadataTimeoutMs = 30_000;
const fileTimeoutMs = 180_000;

/** In-flight patch generation dedup lock */
const inFlightPatches = new Map();

function getAppFilesDir(appId) {
  return path.resolve(config.filesDir, appId);
}

function getReleaseDir(appId) {
  return path.join(getAppFilesDir(appId), "releases");
}

function getPatchDir(appId) {
  return path.join(getAppFilesDir(appId), "patches");
}

/** Helper to locate release binary on disk even if file extension differs from default */
async function findReleaseFileOnDisk(releaseDir, versionCode, defaultExt) {
  const direct = path.join(releaseDir, `release-v${versionCode}.${defaultExt}`);
  try {
    const s = await stat(direct);
    if (s.isFile()) return direct;
  } catch {}
  try {
    const files = await readdir(releaseDir);
    const prefix = `release-v${versionCode}.`;
    const found = files.find((f) => f.startsWith(prefix) && !f.endsWith(".tmp"));
    if (found) return path.join(releaseDir, found);
  } catch {}
  return direct;
}


async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`请求超时 (${Math.ceil(timeoutMs / 1000)}s): ${url}`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadWithTimeout(url, options, dest, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`下载失败: HTTP ${res.status}`);
    await pipeline(res.body, createWriteStream(dest));
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`下载超时 (${Math.ceil(timeoutMs / 1000)}s)`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function buildHeaders(token) {
  const h = { Accept: "application/vnd.github+json", "User-Agent": "app-release-hub" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * Attempt to download a historical version's binary from GitHub releases list.
 */
async function tryFetchHistoricalFile(appId, versionCode, destPath, { base, repo, headers, platform = "android", assetPattern = "" }) {
  const listRes = await fetchWithTimeout(`${base}/repos/${repo}/releases?per_page=30`, { headers }, metadataTimeoutMs);
  if (!listRes.ok) return false;
  const releases = await listRes.json();
  for (const rel of releases) {
    const assets = rel.assets || [];
    const metaAsset = findMetadataAsset(assets, platform);
    if (!metaAsset) continue;
    const mRes = await fetchWithTimeout(metaAsset.browser_download_url, { headers }, metadataTimeoutMs);
    if (!mRes.ok) continue;
    const mJson = await mRes.json();
    if (Number(mJson.versionCode) === Number(versionCode)) {
      const fileAsset = findBinaryAsset(assets, {
        platform,
        assetPattern,
        preferredFileName: mJson.fileName || mJson.assetName || "",
      });
      if (!fileAsset) continue;
      await mkdir(path.dirname(destPath), { recursive: true });
      await downloadWithTimeout(fileAsset.browser_download_url, { headers }, destPath, fileTimeoutMs);
      return true;
    }
  }
  return false;
}

/**
 * Generate a patch between two locally cached version files.
 * Uses in-flight dedup to avoid running bsdiff twice for the same pair.
 */
export async function generatePatchBetweenVersions(appId, fromVersionCode, targetVersionCode) {
  const fromCode = Number(fromVersionCode);
  const targetCode = Number(targetVersionCode);
  const taskKey = `${appId}:${fromCode}->${targetCode}`;

  if (inFlightPatches.has(taskKey)) return await inFlightPatches.get(taskKey);

  const taskPromise = (async () => {
    const appRow = getApp(appId);
    const ext = getFileExt(appRow?.platform);
    const releaseDir = getReleaseDir(appId);
    const patchDir = getPatchDir(appId);

    const oldFile = await findReleaseFileOnDisk(releaseDir, fromCode, ext);
    const newFile = await findReleaseFileOnDisk(releaseDir, targetCode, ext);

    for (const [label, fp] of [["旧版本", oldFile], ["新版本", newFile]]) {
      try { await stat(fp); } catch {
        throw new Error(`${label}文件未在服务器找到: ${path.basename(fp)}`);
      }
    }

    await mkdir(patchDir, { recursive: true });
    const patchFileName = `patch-v${fromCode}-to-v${targetCode}.patch`;
    const patchFilePath = path.join(patchDir, patchFileName);

    const { size, sha256 } = await generatePatch(oldFile, newFile, patchFilePath);

    const patchRecord = {
      fromVersionCode: fromCode,
      targetVersionCode: targetCode,
      patchFile: patchFileName,
      patchUrl: `/api/apps/${appId}/patches/${patchFileName}`,
      patchSha256: sha256,
      patchSize: size,
    };
    upsertPatch(appId, patchRecord);
    return patchRecord;
  })();

  inFlightPatches.set(taskKey, taskPromise);
  try {
    return await taskPromise;
  } finally {
    inFlightPatches.delete(taskKey);
  }
}

/**
 * Generate all missing patches from older versions up to a target version.
 */
export async function generateAllMissingPatchesForVersion(appId, targetVersionCode, githubContext) {
  const targetCode = Number(targetVersionCode);
  const appRow = getApp(appId);
  const ext = getFileExt(appRow?.platform);
  const history = getVersionHistory(appId);
  const targetEntry = history.find((h) => Number(h.version_code) === targetCode);
  if (!targetEntry) throw new Error(`目标版本 ${targetCode} 不存在`);

  const releaseDir = getReleaseDir(appId);
  const newFile = await findReleaseFileOnDisk(releaseDir, targetCode, ext);
  try { await stat(newFile); } catch {
    throw new Error(`目标版本文件在服务器不存在: release-v${targetCode}.${ext}`);
  }

  const eligibleOlder = history.filter((h) => Number(h.version_code) < targetCode);
  if (eligibleOlder.length === 0) {
    return { targetVersionCode: targetCode, generatedCount: 0, generated: [], errors: [] };
  }

  const existingPatches = getPatchesForTarget(appId, targetCode);
  const coveredCodes = new Set(existingPatches.map((p) => Number(p.from_version_code)));
  const missing = eligibleOlder.filter((h) => !coveredCodes.has(Number(h.version_code)));

  const generated = [];
  const errors = [];

  for (const prev of missing) {
    const oldCode = Number(prev.version_code);
    const oldFile = await findReleaseFileOnDisk(releaseDir, oldCode, ext);
    let hasFile = false;

    try { await stat(oldFile); hasFile = true; } catch {
      if (githubContext) {
        try {
          const histCtx = {
            ...githubContext,
            platform: appRow?.platform,
            assetPattern: appRow?.asset_pattern,
          };
          hasFile = await tryFetchHistoricalFile(appId, oldCode, oldFile, histCtx);
        } catch (dlErr) {
          console.warn(`[releaseService] 拉取历史版本 v${oldCode} 失败:`, dlErr.message);
        }
      }
    }

    if (hasFile) {
      try {
        const res = await generatePatchBetweenVersions(appId, oldCode, targetCode);
        generated.push(res);
      } catch (err) {
        errors.push({ fromVersionCode: oldCode, error: err.message });
      }
    } else {
      errors.push({ fromVersionCode: oldCode, error: `本地及 GitHub 均未找到旧版本文件 (v${oldCode})` });
    }
  }

  return { targetVersionCode: targetCode, generatedCount: generated.length, generated, errors };
}

/**
 * Sync latest release from a GitHub repository for a given app.
 */
export async function syncLatestRelease(appId, { githubRepo, githubApiUrl = "https://api.github.com", token = "", platform = "android", assetPattern = "" }) {
  if (!githubRepo) throw new Error("githubRepo 未配置");
  const defaultExt = getFileExt(platform);
  const base = String(githubApiUrl).replace(/\/$/, "");
  const headers = buildHeaders(token);
  const githubContext = { base, repo: githubRepo, headers, platform, assetPattern };

  const releaseRes = await fetchWithTimeout(`${base}/repos/${githubRepo}/releases/latest`, { headers }, metadataTimeoutMs);
  if (!releaseRes.ok) throw new Error(`GitHub API 请求失败: ${releaseRes.status}`);
  const release = await releaseRes.json();

  const assets = release.assets || [];
  const metaAsset = findMetadataAsset(assets, platform);
  if (!metaAsset) {
    throw new Error(`Release 中未找到元数据清单 (支持 app-version.${platform}.json 或 app-version.json)`);
  }

  const metaRes = await fetchWithTimeout(metaAsset.browser_download_url, { headers }, metadataTimeoutMs);
  if (!metaRes.ok) throw new Error(`元数据下载失败: ${metaRes.status}`);
  const metadata = await metaRes.json();

  const fileAsset = findBinaryAsset(assets, {
    platform,
    assetPattern,
    preferredFileName: metadata.fileName || metadata.assetName || "",
  });
  if (!fileAsset) {
    throw new Error(`Release 中未找到与平台 [${platform}] 匹配的安装包 (若自定义命名请配置 assetPattern)`);
  }

  const ext = path.extname(fileAsset.name).replace(/^\./, "").toLowerCase() || defaultExt;

  const versionCode = Number(metadata.versionCode);
  const versionName = String(metadata.versionName || "").trim();
  if (!Number.isInteger(versionCode) || versionCode < 1 || !versionName) {
    throw new Error("Release 元数据无效 (versionCode / versionName)");
  }

  const releaseDir = getReleaseDir(appId);
  const patchDir = getPatchDir(appId);
  await mkdir(releaseDir, { recursive: true });
  await mkdir(patchDir, { recursive: true });

  // Preserve previous latest version's binary before overwriting
  const existingLatest = getLatestVersion(appId);
  if (existingLatest && Number(existingLatest.version_code) < versionCode) {
    const prevCode = Number(existingLatest.version_code);
    const versionedOld = await findReleaseFileOnDisk(releaseDir, prevCode, ext);
    const legacyPath = path.join(releaseDir, `latest.${ext}`);
    try { await stat(versionedOld); } catch {
      try { await stat(legacyPath); await copyFile(legacyPath, versionedOld); } catch {}
    }
  }

  const tempFile = path.join(releaseDir, `.release-${versionCode}.tmp`);
  const versionedFile = path.join(releaseDir, `release-v${versionCode}.${ext}`);
  const legacyFile = path.join(releaseDir, `latest.${ext}`);

  try {
    await downloadWithTimeout(fileAsset.browser_download_url, { headers }, tempFile, fileTimeoutMs);
    await rename(tempFile, versionedFile);
    await copyFile(versionedFile, legacyFile);

    const sha256 = await computeFileSha256(versionedFile);
    const fileStat = await stat(versionedFile);

    // Extract changelog URL
    let changelogUrl = String(metadata.changelogUrl || "").trim();
    const bodyMatch = String(release.body || "").match(/(https:\/\/github\.com\/[^\s\)>]+compare[^\s\)>]+)/i);
    if (bodyMatch) changelogUrl = bodyMatch[1];
    else if (!changelogUrl && release.html_url) changelogUrl = release.html_url;

    // Extract release notes
    let releaseNotes = Array.isArray(metadata.releaseNotes) && metadata.releaseNotes.length > 0
      ? metadata.releaseNotes.map(String).filter(Boolean)
      : [];
    if (releaseNotes.length === 0 && release.body) {
      releaseNotes = String(release.body)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^[-*]\s+/.test(l))
        .map((l) => l.replace(/^[-*]\s+/, "").replace(/\s+by\s+@[\w-]+(?:\s+in\s+https?:\/\/\S+)?$/i, "").trim())
        .filter(Boolean);
    }

    upsertVersion(appId, {
      versionCode,
      versionName,
      minVersionCode: Number.isInteger(Number(metadata.minVersionCode)) ? Number(metadata.minVersionCode) : 1,
      forceUpdate: Boolean(metadata.forceUpdate),
      releaseNotes,
      changelogUrl,
      publishedAt: String(metadata.publishedAt || release.published_at || "").slice(0, 10),
      fileUrl: `/api/apps/${appId}/releases/release-v${versionCode}.${ext}`,
      sha256,
      size: fileStat.size,
      isLatest: true,
    });

    // Auto-generate patches for up to 3 previous versions
    const patchesGenerated = [];
    const bsdiffOk = await checkBsdiffAvailable();
    if (bsdiffOk) {
      const history = getVersionHistory(appId).filter((h) => Number(h.version_code) < versionCode).slice(0, 3);
      for (const prev of history) {
        const oldCode = Number(prev.version_code);
        const oldFile = await findReleaseFileOnDisk(releaseDir, oldCode, ext);
        let hasFile = false;
        try { await stat(oldFile); hasFile = true; } catch {
          try { hasFile = await tryFetchHistoricalFile(appId, oldCode, oldFile, githubContext); } catch {}
        }
        if (hasFile) {
          try {
            const res = await generatePatchBetweenVersions(appId, oldCode, versionCode);
            patchesGenerated.push(res);
          } catch (err) {
            console.warn(`[releaseService] 差分生成失败 v${oldCode}→v${versionCode}:`, err.message);
          }
        }
      }
    }

    return { versionCode, versionName, releaseUrl: release.html_url, patchesGenerated, bsdiffAvailable: bsdiffOk };
  } finally {
    await rm(tempFile, { force: true });
  }
}

/**
 * Delete a specific release version, cleaning up files, patches, and promoting new latest if needed.
 */
export async function deleteReleaseVersion(appId, versionCode) {
  const vCode = Number(versionCode);
  const appRow = getApp(appId);
  if (!appRow) throw new Error(`App "${appId}" 不存在`);

  const ver = getVersion(appId, vCode);
  if (!ver) throw new Error(`版本 ${vCode} 不存在`);

  const ext = getFileExt(appRow.platform);
  const releaseDir = getReleaseDir(appId);
  const patchDir = getPatchDir(appId);

  // 1. Gather all patch records related to this version before deleting DB rows
  const allPatches = getAllPatches(appId);
  const relatedPatches = allPatches.filter(
    (p) => Number(p.from_version_code) === vCode || Number(p.target_version_code) === vCode
  );

  // 2. Delete database records (cascading patches & promoting new latest if needed)
  const result = deleteVersionRecord(appId, vCode);

  // 3. Remove physical patch files
  for (const p of relatedPatches) {
    if (p.patch_file) {
      await rm(path.join(patchDir, p.patch_file), { force: true }).catch(() => {});
    }
  }

  // 4. Remove physical release binary file
  const releaseFileName = ver.file_url ? path.basename(ver.file_url) : `release-v${vCode}.${ext}`;
  await rm(path.join(releaseDir, releaseFileName), { force: true }).catch(() => {});

  // 5. Update latest.{ext} if this version was the latest
  const legacyFile = path.join(releaseDir, `latest.${ext}`);
  if (ver.is_latest === 1) {
    if (result?.newLatest) {
      const newLatestCode = Number(result.newLatest.version_code);
      const newLatestFile = path.join(releaseDir, `release-v${newLatestCode}.${ext}`);
      try {
        await copyFile(newLatestFile, legacyFile);
      } catch (err) {
        console.warn(`[releaseService] 更新 latest.${ext} 失败:`, err.message);
      }
    } else {
      await rm(legacyFile, { force: true }).catch(() => {});
    }
  }

  return {
    deletedVersionCode: vCode,
    newLatestVersionCode: result?.newLatest ? Number(result.newLatest.version_code) : null,
  };
}

