import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { config } from "../config.js";
import { db } from "../db/index.js";
import {
  getApp,
  getVersionHistory,
  getLatestVersion,
  getVersion,
  formatVersion,
  deleteVersionRecord,
  upsertVersion,
  getPatchesForTarget,
  getAllPatches,
  upsertPatch,
  rollbackVersionToLatest,
} from "./storageAdapter.js";
import { checkBsdiffAvailable, computeFileSha256, generatePatch } from "./patchService.js";
import { getFileExt, findMetadataAsset, findBinaryAsset } from "./assetResolver.js";
import { cleanGithubRepo } from "./appRegistryService.js";
import { saveFile, deleteFile, ensureLocalFilePath, getFileMeta } from "./storageProvider.js";
import { sendWebhookNotification } from "./notificationService.js";

const metadataTimeoutMs = 30_000;
const fileTimeoutMs = 180_000;

const inFlightPatches = new Map();
export function isPatchInFlight(appId, fromCode, targetCode) {
  return inFlightPatches.has(`${appId}:${Number(fromCode)}->${Number(targetCode)}`);
}

const inFlightSyncs = new Map();

function getAppFilesDir(appId) {
  return path.resolve(config.filesDir, appId);
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

export async function generatePatchBetweenVersions(appId, fromVersionCode, targetVersionCode) {
  const fromCode = Number(fromVersionCode);
  const targetCode = Number(targetVersionCode);
  const taskKey = `${appId}:${fromCode}->${targetCode}`;

  if (inFlightPatches.has(taskKey)) return await inFlightPatches.get(taskKey);

  const taskPromise = (async () => {
    const oldVer = getVersion(appId, fromCode);
    const newVer = getVersion(appId, targetCode);
    if (!oldVer || !newVer) throw new Error("版本不存在");

    const oldFn = path.basename(oldVer.file_url);
    const newFn = path.basename(newVer.file_url);

    const oldLocal = await ensureLocalFilePath(appId, "releases", oldFn);
    const newLocal = await ensureLocalFilePath(appId, "releases", newFn);

    const patchFileName = `patch-v${fromCode}-to-v${targetCode}.patch`;
    const tmpDir = path.join(getAppFilesDir(appId), "tmp");
    await mkdir(tmpDir, { recursive: true });
    const patchTempPath = path.join(tmpDir, patchFileName);

    let size, sha256;
    try {
      const res = await generatePatch(oldLocal.path, newLocal.path, patchTempPath);
      size = res.size;
      sha256 = res.sha256;

      // 差分体积保护：若差分补丁体积超过新版完整包的 95%，说明压缩流被打散无法获得增量效益，直接舍弃
      if (newVer.size > 0 && size >= newVer.size * 0.95) {
        console.warn(`[releaseService] 差分补丁体积 (${size}B) 接近或超过原包体积 (${newVer.size}B)，放弃使用增量补丁，客户端将走全量更新`);
        return null;
      }

      await saveFile(appId, "patches", patchFileName, patchTempPath);
    } finally {
      await rm(patchTempPath, { force: true }).catch(()=>{});
      if (oldLocal.isTemp) await rm(oldLocal.path, { force: true }).catch(()=>{});
      if (newLocal.isTemp) await rm(newLocal.path, { force: true }).catch(()=>{});
    }

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

export async function generateAllMissingPatchesForVersion(appId, targetVersionCode, githubContext) {
  const targetCode = Number(targetVersionCode);
  const history = getVersionHistory(appId);
  const targetEntry = history.find((h) => Number(h.version_code) === targetCode);
  if (!targetEntry) throw new Error(`目标版本 ${targetCode} 不存在`);

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
    try {
      const res = await generatePatchBetweenVersions(appId, oldCode, targetCode);
      generated.push(res);
    } catch (err) {
      errors.push({ fromVersionCode: oldCode, error: err.message });
    }
  }

  return { targetVersionCode: targetCode, generatedCount: generated.length, generated, errors };
}

export async function syncLatestRelease(appId, options) {
  if (inFlightSyncs.has(appId)) {
    return await inFlightSyncs.get(appId);
  }
  const syncPromise = _doSyncLatestRelease(appId, options);
  inFlightSyncs.set(appId, syncPromise);
  try {
    const res = await syncPromise;
    await sendWebhookNotification(appId, "release_synced", {
      versionName: res.versionName,
      versionCode: res.versionCode,
      patchesCount: res.patchesGenerated?.length || 0,
      errorCount: 0,
      size: res.size || 0,
      releaseNotes: res.releaseNotes,
      isManual: false
    });
    return res;
  } catch (err) {
    await sendWebhookNotification(appId, "sync_error", { error: err.message });
    throw err;
  } finally {
    inFlightSyncs.delete(appId);
    await pruneOldVersions(appId).catch(console.error);
  }
}

async function pruneOldVersions(appId) {
  const app = getApp(appId);
  if (!app || !app.max_retained_versions || app.max_retained_versions <= 0) return;
  const history = getVersionHistory(appId);
  if (history.length <= app.max_retained_versions) return;

  const toDelete = history.slice(app.max_retained_versions);
  for (const v of toDelete) {
    await deleteReleaseVersion(appId, v.version_code);
  }
}

async function _doSyncLatestRelease(appId, { githubRepo, githubApiUrl = "https://api.github.com", token = "", platform = "android", assetPattern = "" }) {
  if (!githubRepo) throw new Error("githubRepo 未配置");
  const cleanRepo = cleanGithubRepo(githubRepo);
  const defaultExt = getFileExt(platform);
  const base = String(githubApiUrl).replace(/\/$/, "");
  const headers = buildHeaders(token);
  const githubContext = { base, repo: cleanRepo, headers, platform, assetPattern };

  const releaseRes = await fetchWithTimeout(`${base}/repos/${cleanRepo}/releases/latest`, { headers }, metadataTimeoutMs);
  let release;
  if (releaseRes.status === 404) {
    const listRes = await fetchWithTimeout(`${base}/repos/${cleanRepo}/releases?per_page=1`, { headers }, metadataTimeoutMs);
    if (!listRes.ok) throw new Error(`GitHub API 请求失败: HTTP ${listRes.status}`);
    const list = await listRes.json();
    if (!Array.isArray(list) || list.length === 0) throw new Error(`GitHub 仓库 "${cleanRepo}" 中尚未发布任何 Release`);
    release = list[0];
  } else if (!releaseRes.ok) {
    throw new Error(`GitHub API 请求失败: HTTP ${releaseRes.status}`);
  } else {
    release = await releaseRes.json();
  }

  const assets = release.assets || [];
  const metaAsset = findMetadataAsset(assets, platform);
  if (!metaAsset) throw new Error(`Release 中未找到元数据清单 (app-version.json)`);

  const metaRes = await fetchWithTimeout(metaAsset.browser_download_url, { headers }, metadataTimeoutMs);
  if (!metaRes.ok) throw new Error(`元数据下载失败: ${metaRes.status}`);
  const metadata = await metaRes.json();

  const fileAsset = findBinaryAsset(assets, { platform, assetPattern, preferredFileName: metadata.fileName || metadata.assetName || "" });
  if (!fileAsset) throw new Error(`Release 中未找到与平台 [${platform}] 匹配的安装包`);

  const ext = path.extname(fileAsset.name).replace(/^\./, "").toLowerCase() || defaultExt;
  const versionCode = Number(metadata.versionCode);
  const versionName = String(metadata.versionName || "").trim();
  if (!Number.isInteger(versionCode) || versionCode < 1 || !versionName) throw new Error("Release 元数据无效 (versionCode / versionName)");

  const existingLatest = getLatestVersion(appId);
  if (existingLatest && Number(existingLatest.version_code) === versionCode) {
    const fn = path.basename(existingLatest.file_url || "");
    if (fn) {
      const m = await getFileMeta(appId, "releases", fn);
      if (m.exists && m.size > 0) {
        return { versionCode, versionName, releaseUrl: release.html_url, patchesGenerated: [], alreadyLatest: true, size: m.size, releaseNotes: metadata.releaseNotes };
      }
    }
  }

  const randSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = path.join(getAppFilesDir(appId), "tmp");
  await mkdir(tmpDir, { recursive: true });
  const tempFile = path.join(tmpDir, `.release-${versionCode}-${randSuffix}.tmp`);

  try {
    await downloadWithTimeout(fileAsset.browser_download_url, { headers }, tempFile, fileTimeoutMs);
    const tempStat = await stat(tempFile);
    if (!tempStat.isFile() || tempStat.size === 0) throw new Error("下载安装包失败: 临时文件为空或未完整写入");
    
    const releaseFileName = `release-v${versionCode}.${ext}`;
    await saveFile(appId, "releases", releaseFileName, tempFile);

    const sha256 = await computeFileSha256(tempFile);
    const fileStat = await stat(tempFile);

    let changelogUrl = String(metadata.changelogUrl || "").trim();
    const bodyMatch = String(release.body || "").match(/(https:\/\/github\.com\/[^\s\)>]+compare[^\s\)>]+)/i);
    if (bodyMatch) changelogUrl = bodyMatch[1];
    else if (!changelogUrl && release.html_url) changelogUrl = release.html_url;

    let releaseNotes = Array.isArray(metadata.releaseNotes) && metadata.releaseNotes.length > 0
      ? metadata.releaseNotes.map(String).filter(Boolean)
      : [];
    if (releaseNotes.length === 0 && release.body) {
      releaseNotes = String(release.body).split("\n").map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, "").trim()).filter(Boolean);
    }

    const channel = metadata.channel || "stable";
    const rolloutPercentage = metadata.rolloutPercentage !== undefined ? Number(metadata.rolloutPercentage) : 100;

    upsertVersion(appId, {
      versionCode, versionName, minVersionCode: Number.isInteger(Number(metadata.minVersionCode)) ? Number(metadata.minVersionCode) : 1,
      forceUpdate: Boolean(metadata.forceUpdate), releaseNotes, changelogUrl,
      publishedAt: String(metadata.publishedAt || release.published_at || "").slice(0, 10),
      fileUrl: `/api/apps/${appId}/releases/${releaseFileName}`,
      sha256, size: fileStat.size, isLatest: true, channel, rolloutPercentage
    });

    const patchesGenerated = [];
    const bsdiffOk = await checkBsdiffAvailable();
    if (bsdiffOk) {
      const history = getVersionHistory(appId).filter((h) => Number(h.version_code) < versionCode).slice(0, 3);
      for (const prev of history) {
        try {
          const res = await generatePatchBetweenVersions(appId, prev.version_code, versionCode);
          patchesGenerated.push(res);
        } catch (err) {
          console.warn(`[releaseService] 差分生成失败:`, err.message);
        }
      }
    }

    return { versionCode, versionName, releaseUrl: release.html_url, patchesGenerated, bsdiffAvailable: bsdiffOk, size: fileStat.size, releaseNotes };
  } finally {
    await rm(tempFile, { force: true }).catch(()=>{});
  }
}

export async function deleteReleaseVersion(appId, versionCode) {
  const vCode = Number(versionCode);
  const appRow = getApp(appId);
  if (!appRow) throw new Error(`App "${appId}" 不存在`);

  const ver = getVersion(appId, vCode);
  if (!ver) return;

  const allPatches = getAllPatches(appId);
  const relatedPatches = allPatches.filter((p) => Number(p.from_version_code) === vCode || Number(p.target_version_code) === vCode);

  const result = deleteVersionRecord(appId, vCode);

  for (const p of relatedPatches) {
    if (p.patch_file) await deleteFile(appId, "patches", p.patch_file);
  }
  
  if (ver.file_url) {
    await deleteFile(appId, "releases", path.basename(ver.file_url));
  }

  const remainingCount = db.prepare("SELECT COUNT(*) as cnt FROM versions WHERE app_id = ?").get(appId)?.cnt || 0;
  const ext = getFileExt(appRow.platform);
  const releaseDir = path.join(getAppFilesDir(appId), "releases");
  const legacyFile = path.join(releaseDir, `latest.${ext}`);
  if (remainingCount === 0) {
    await rm(legacyFile, { force: true }).catch(() => {});
  } else if (result?.newLatest) {
    const newLatestCode = Number(result.newLatest.version_code);
    const newVer = getVersion(appId, newLatestCode);
    if (newVer?.file_url) {
      const newLatestFile = path.join(releaseDir, path.basename(newVer.file_url));
      try {
        await copyFile(newLatestFile, legacyFile);
      } catch (err) {
        console.warn(`[releaseService] 更新 latest.${ext} 失败:`, err.message);
      }
    }
  }

  return { deletedVersionCode: vCode, newLatestVersionCode: result?.newLatest ? Number(result.newLatest.version_code) : null };
}

export async function refreshAppLatestVersion(appId) {
  const appRow = getApp(appId);
  const ext = getFileExt(appRow?.platform);
  const releaseDir = path.join(getAppFilesDir(appId), "releases");
  const legacyFile = path.join(releaseDir, `latest.${ext}`);
  const history = getVersionHistory(appId);

  if (history.length === 0) {
    db.prepare("UPDATE versions SET is_latest = 0 WHERE app_id = ?").run(appId);
    await rm(legacyFile, { force: true }).catch(() => {});
    return null;
  }
  const maxCode = Number(history[0].version_code);
  db.transaction(() => {
    db.prepare("UPDATE versions SET is_latest = 0 WHERE app_id = ?").run(appId);
    db.prepare("UPDATE versions SET is_latest = 1 WHERE app_id = ? AND version_code = ?").run(appId, maxCode);
  })();

  const maxVer = getVersion(appId, maxCode);
  if (maxVer?.file_url) {
    const maxFile = path.join(releaseDir, path.basename(maxVer.file_url));
    try {
      await copyFile(maxFile, legacyFile);
    } catch {}
  }

  return maxCode;
}

export async function syncHistoricalReleases(appId, { limit = 20, autoGeneratePatches = false } = {}) {
  const appRow = getApp(appId);
  if (!appRow) throw new Error(`App "${appId}" 不存在`);
  if (!appRow.github_repo) throw new Error("githubRepo 未配置");
  const cleanRepo = cleanGithubRepo(appRow.github_repo);

  const token = config.resolveGithubToken(appId);
  const platform = appRow.platform || "android";
  const defaultExt = getFileExt(platform);
  const base = String(appRow.github_api_url || "https://api.github.com").replace(/\/$/, "");
  const headers = buildHeaders(token);
  const githubContext = { base, repo: cleanRepo, headers, platform, assetPattern: appRow.asset_pattern || "" };

  const perPage = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const releasesRes = await fetchWithTimeout(
    `${base}/repos/${cleanRepo}/releases?per_page=${perPage}`,
    { headers },
    metadataTimeoutMs
  );
  if (!releasesRes.ok) {
    throw new Error(`GitHub API 请求失败: HTTP ${releasesRes.status}`);
  }
  const releases = await releasesRes.json();
  if (!Array.isArray(releases)) throw new Error("GitHub 返回的 Release 列表无效");

  const releaseDir = path.join(getAppFilesDir(appId), "releases");
  await mkdir(releaseDir, { recursive: true });

  const importedVersions = [];
  const skippedVersions = [];
  const errors = [];

  for (const release of releases) {
    try {
      const assets = release.assets || [];
      const metaAsset = findMetadataAsset(assets, platform);
      const fileAsset = findBinaryAsset(assets, {
        platform,
        assetPattern: appRow.asset_pattern || "",
      });

      if (!metaAsset || !fileAsset) {
        skippedVersions.push({
          tag: release.tag_name,
          name: release.name,
          reason: !metaAsset ? "未找到元数据文件 (app-version.json)" : "未找到安装包文件",
        });
        continue;
      }

      const metaRes = await fetchWithTimeout(metaAsset.browser_download_url, { headers }, metadataTimeoutMs);
      if (!metaRes.ok) {
        skippedVersions.push({ tag: release.tag_name, reason: `元数据下载失败: HTTP ${metaRes.status}` });
        continue;
      }
      const metadata = await metaRes.json();

      const versionCode = Number(metadata.versionCode);
      const versionName = String(metadata.versionName || "").trim();
      if (!Number.isInteger(versionCode) || versionCode < 1 || !versionName) {
        skippedVersions.push({ tag: release.tag_name, reason: "元数据缺少有效 versionCode 或 versionName" });
        continue;
      }

      const ext = path.extname(fileAsset.name).replace(/^\./, "").toLowerCase() || defaultExt;
      const releaseFileName = `release-v${versionCode}.${ext}`;
      const versionedFile = path.join(releaseDir, releaseFileName);
      const existing = getVersion(appId, versionCode);

      if (existing) {
        let fileExists = false;
        try {
          const s = await stat(versionedFile);
          fileExists = s.isFile();
        } catch {}
        if (fileExists) {
          skippedVersions.push({ versionCode, versionName, tag: release.tag_name, reason: "已存在且文件完整" });
          continue;
        }
      }

      const randSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tmpDir = path.join(getAppFilesDir(appId), "tmp");
      await mkdir(tmpDir, { recursive: true });
      const tempFile = path.join(tmpDir, `.release-${versionCode}-${randSuffix}.tmp`);
      try {
        await downloadWithTimeout(fileAsset.browser_download_url, { headers }, tempFile, fileTimeoutMs);
        await saveFile(appId, "releases", releaseFileName, tempFile);
      } finally {
        await rm(tempFile, { force: true }).catch(() => {});
      }

      const sha256 = await computeFileSha256(versionedFile).catch(() => "");
      let size = 0;
      try { size = (await stat(versionedFile)).size; } catch {}

      let changelogUrl = String(metadata.changelogUrl || "").trim();
      const bodyMatch = String(release.body || "").match(/(https:\/\/github\.com\/[^\s\)>]+compare[^\s\)>]+)/i);
      if (bodyMatch) changelogUrl = bodyMatch[1];
      else if (!changelogUrl && release.html_url) changelogUrl = release.html_url;

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
        fileUrl: `/api/apps/${appId}/releases/${releaseFileName}`,
        sha256,
        size,
        isLatest: false,
        channel: metadata.channel || "stable",
        rolloutPercentage: Number(metadata.rolloutPercentage ?? 100),
      });

      importedVersions.push({ versionCode, versionName, tag: release.tag_name, size });
    } catch (err) {
      errors.push({ tag: release.tag_name || release.name, error: err.message });
    }
  }

  const latestCode = await refreshAppLatestVersion(appId);

  let patchesResult = null;
  if (autoGeneratePatches && latestCode) {
    try {
      patchesResult = await generateAllMissingPatchesForVersion(appId, latestCode, githubContext);
    } catch (patchErr) {
      console.warn(`[releaseService] 自动补齐差分包失败:`, patchErr.message);
    }
  }

  return {
    totalScanned: releases.length,
    importedCount: importedVersions.length,
    skippedCount: skippedVersions.length,
    latestVersionCode: latestCode,
    importedVersions,
    skippedVersions,
    errors,
    patchesGenerated: patchesResult?.generatedCount || 0,
  };
}

export async function createManualVersion(appId, {
  versionCode, versionName, releaseNotes, publishedAt, minVersionCode, forceUpdate, changelogUrl, fileUrl, sha256, size, rolloutPercentage, channel
}, fileInfo = null) {
  const appRow = getApp(appId);
  if (!appRow) throw new Error(`App "${appId}" 不存在`);
  const vCode = Number(versionCode);
  if (!Number.isInteger(vCode) || vCode < 1) {
    throw new Error("versionCode 必须为大于等于 1 的整数");
  }

  const vName = String(versionName || "").trim();
  if (!vName) throw new Error("versionName 不能为空");

  const existing = getVersion(appId, vCode);
  if (existing) throw new Error(`版本 ${vCode} 已存在，不能重复补录`);

  let finalFileUrl = String(fileUrl || "").trim();
  let finalSha256 = String(sha256 || "").trim();
  let finalSize = Number(size) || 0;

  if (fileInfo && fileInfo.filePath) {
    const ext = path.extname(fileInfo.originalFilename || "").replace(/^\./, "").toLowerCase() || "apk";
    const releaseFileName = `release-v${vCode}.${ext}`;
    finalSha256 = await computeFileSha256(fileInfo.filePath);
    finalSize = (await stat(fileInfo.filePath)).size || 0;
    await saveFile(appId, "releases", releaseFileName, fileInfo.filePath);
    await rm(fileInfo.filePath, { force: true }).catch(()=>{});
    finalFileUrl = `/api/apps/${appId}/releases/${releaseFileName}`;
  }

  upsertVersion(appId, {
    versionCode: vCode, versionName, minVersionCode: Number(minVersionCode) || 1, forceUpdate: Boolean(forceUpdate),
    releaseNotes: Array.isArray(releaseNotes) ? releaseNotes : String(releaseNotes||"").split("\n"),
    changelogUrl, publishedAt: String(publishedAt || new Date().toISOString().slice(0, 10)),
    fileUrl: finalFileUrl, sha256: finalSha256, size: finalSize, isLatest: false,
    channel: channel || "stable", rolloutPercentage: Number(rolloutPercentage) || 100
  });

  const latestCode = await refreshAppLatestVersion(appId);
  
  await sendWebhookNotification(appId, "release_synced", {
    versionName, versionCode, patchesCount: 0, errorCount: 0, size: finalSize, releaseNotes: releaseNotes, isManual: true
  });
  await pruneOldVersions(appId).catch(console.error);

  return { ...formatVersion(getVersion(appId, vCode)), isLatest: latestCode === vCode };
}

export async function previewLatestRelease(appId) {
  const appRow = getApp(appId);
  if (!appRow) throw new Error(`App "${appId}" 不存在`);
  if (!appRow.github_repo) throw new Error("该 App 尚未配置 githubRepo");

  const cleanRepo = cleanGithubRepo(appRow.github_repo);
  const token = config.resolveGithubToken(appId);
  const platform = appRow.platform || "android";
  const base = String(appRow.github_api_url || "https://api.github.com").replace(/\/$/, "");
  const headers = buildHeaders(token);

  const res = await fetchWithTimeout(`${base}/repos/${cleanRepo}/releases?per_page=1`, { headers }, metadataTimeoutMs);
  if (!res.ok) {
    throw new Error(`GitHub API 请求失败: HTTP ${res.status}`);
  }
  const list = await res.json();
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`GitHub 仓库 "${cleanRepo}" 中尚未发布任何 Release`);
  }
  const release = list[0];
  const assets = release.assets || [];

  // Check metadata
  const metaAsset = findMetadataAsset(assets, platform);
  let metadata = null;
  let metadataError = null;
  if (metaAsset) {
    try {
      const metaRes = await fetchWithTimeout(metaAsset.browser_download_url, { headers }, metadataTimeoutMs);
      if (metaRes.ok) {
        metadata = await metaRes.json();
      } else {
        metadataError = `元数据下载失败: HTTP ${metaRes.status}`;
      }
    } catch (err) {
      metadataError = `元数据解析失败: ${err.message}`;
    }
  }

  // Check binary asset
  const preferredName = metadata?.fileName || metadata?.assetName || "";
  const fileAsset = findBinaryAsset(assets, {
    platform,
    assetPattern: appRow.asset_pattern || "",
    preferredFileName: preferredName,
  });

  const allAssetNames = assets.map((a) => ({ name: a.name, size: a.size, downloadUrl: a.browser_download_url }));

  return {
    repo: cleanRepo,
    release: {
      tagName: release.tag_name,
      name: release.name || release.tag_name,
      publishedAt: release.published_at,
      htmlUrl: release.html_url,
      body: release.body || "",
    },
    metaAsset: metaAsset ? { name: metaAsset.name, size: metaAsset.size } : null,
    metadata,
    metadataError,
    matchedBinaryAsset: fileAsset ? { name: fileAsset.name, size: fileAsset.size, downloadUrl: fileAsset.browser_download_url } : null,
    allAssets: allAssetNames,
    assetPattern: appRow.asset_pattern || "",
    platform,
    isMatchSuccess: Boolean(fileAsset && (metadata || !metaAsset)),
  };
}

export async function rollbackToVersion(appId, targetVersionCode) {
  const appRow = getApp(appId);
  if (!appRow) throw new Error(`App "${appId}" 不存在`);
  const vCode = Number(targetVersionCode);

  const targetVer = rollbackVersionToLatest(appId, vCode);

  // Refresh legacy file latest.{ext}
  const ext = getFileExt(appRow.platform);
  const releaseDir = path.join(getAppFilesDir(appId), "releases");
  const legacyFile = path.join(releaseDir, `latest.${ext}`);
  if (targetVer.file_url) {
    const targetFile = path.join(releaseDir, path.basename(targetVer.file_url));
    try {
      await copyFile(targetFile, legacyFile);
    } catch (err) {
      console.warn(`[releaseService] 更新 latest.${ext} 失败:`, err.message);
    }
  }

  // Send webhook notification
  await sendWebhookNotification(appId, "rollback", {
    versionName: targetVer.version_name,
    versionCode: targetVer.version_code,
  }).catch(console.error);

  return formatVersion(targetVer);
}
