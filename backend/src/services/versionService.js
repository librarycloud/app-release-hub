import path from "node:path";
import { stat } from "node:fs/promises";
import { config } from "../config.js";
import {
  getApp,
  getLatestVersion,
  getVersionHistory,
  getVersion,
  getVersionsBetween,
  updateVersion,
  hasForceUpdateBetween,
  getPatch,
  getPatchesForTarget,
  getAllPatches,
} from "./storageAdapter.js";
import { checkBsdiffAvailable } from "./patchService.js";
import { generatePatchBetweenVersions } from "./releaseService.js";

function formatVersionTag(versionName, versionCode) {
  const name = String(versionName || "").trim();
  if (!name) return `v${versionCode}`;
  return /^v/i.test(name) ? name : `v${name}`;
}

function resolveUrl(relUrl) {
  if (!relUrl) return "";
  if (/^https?:\/\//i.test(relUrl)) return relUrl;
  const base = config.downloadBaseUrl;
  const cleanPath = relUrl.startsWith("/") ? relUrl : `/${relUrl}`;
  return base ? `${base}${cleanPath}` : cleanPath;
}

function parseVersion(row) {
  return {
    versionCode: Number(row.version_code),
    versionName: row.version_name,
    minVersionCode: Number(row.min_version_code),
    forceUpdate: row.force_update === 1,
    releaseNotes: (() => { try { return JSON.parse(row.release_notes); } catch { return []; } })(),
    changelogUrl: row.changelog_url,
    publishedAt: row.published_at,
    fileUrl: row.file_url,
    sha256: row.sha256,
    size: Number(row.size),
    downloadCount: Number(row.download_count || 0),
    isLatest: row.is_latest === 1,
  };
}

/**
 * Get version info for a client, including incremental patch info if available.
 */
export async function getVersionForClient(appId, { currentVersionCode } = {}) {
  const latestRow = getLatestVersion(appId);
  if (!latestRow) throw new Error(`App "${appId}" 暂无发布版本`);

  const latest = parseVersion(latestRow);
  const clientCode = Number.isInteger(Number(currentVersionCode)) ? Number(currentVersionCode) : null;
  const hasUpdate = clientCode !== null ? latest.versionCode > clientCode : true;
  const hasIntermediateForce = clientCode !== null && hasForceUpdateBetween(appId, clientCode, latest.versionCode);
  const forceUpdate = Boolean(latest.forceUpdate || (clientCode !== null && clientCode < latest.minVersionCode) || hasIntermediateForce);

  let releaseNotes = latest.releaseNotes;
  let historyReleaseNotes = [
    {
      versionCode: latest.versionCode,
      versionName: latest.versionName,
      releaseNotes: latest.releaseNotes,
    },
  ];

  if (clientCode !== null && hasUpdate) {
    const versionsBetween = getVersionsBetween(appId, clientCode, latest.versionCode);
    if (versionsBetween.length > 1) {
      const cumulativeNotes = [];
      const detailedHistory = [];

      for (const row of versionsBetween) {
        const v = parseVersion(row);
        const tag = formatVersionTag(v.versionName, v.versionCode);
        const notes = Array.isArray(v.releaseNotes) ? v.releaseNotes.filter(Boolean) : [];
        if (notes.length > 0) {
          detailedHistory.push({
            versionCode: v.versionCode,
            versionName: v.versionName,
            releaseNotes: notes,
          });
          for (const rawNote of notes) {
            const note = String(rawNote).trim();
            if (!note) continue;
            const cleanNote = note.replace(/^[-*•]\s*/, "");
            const alreadyHasTag = cleanNote.toLowerCase().startsWith(tag.toLowerCase());
            cumulativeNotes.push(alreadyHasTag ? cleanNote : `${tag}: ${cleanNote}`);
          }
        }
      }

      if (cumulativeNotes.length > 0) {
        releaseNotes = cumulativeNotes;
      }
      if (detailedHistory.length > 0) {
        historyReleaseNotes = detailedHistory;
      }
    }
  }

  const base = {
    versionCode: latest.versionCode,
    versionName: latest.versionName,
    minVersionCode: latest.minVersionCode,
    forceUpdate,
    releaseNotes,
    historyReleaseNotes,
    changelogUrl: latest.changelogUrl,
    publishedAt: latest.publishedAt,
    hasUpdate,
    downloadBaseUrl: config.downloadBaseUrl || "",
  };

  if (clientCode !== null && hasUpdate) {
    let patchRow = getPatch(appId, clientCode, latest.versionCode);

    // On-demand dynamic generation if no cached patch exists
    if (!patchRow) {
      try {
        const appRow = getApp(appId);
        const ext = { android: "apk", windows: "exe", macos: "dmg", ios: "ipa" }[String(appRow?.platform || "").toLowerCase()] || "bin";
        const releaseDir = path.resolve(config.filesDir, appId, "releases");
        const oldFile = path.join(releaseDir, `release-v${clientCode}.${ext}`);
        const newFile = path.join(releaseDir, `release-v${latest.versionCode}.${ext}`);
        const [oldSt, newSt, bsdiffOk] = await Promise.all([
          stat(oldFile).catch(() => null),
          stat(newFile).catch(() => null),
          checkBsdiffAvailable().catch(() => false),
        ]);
        if (oldSt?.isFile() && newSt?.isFile() && bsdiffOk) {
          const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("超时")), 6000));
          const result = await Promise.race([
            generatePatchBetweenVersions(appId, clientCode, latest.versionCode),
            timeout,
          ]);
          if (result?.patchFile) {
            patchRow = {
              from_version_code: clientCode,
              target_version_code: latest.versionCode,
              patch_url: result.patchUrl,
              patch_sha256: result.patchSha256,
              patch_size: result.patchSize,
            };
          }
        }
      } catch (err) {
        console.warn(`[versionService] 动态生成补丁失败 (v${clientCode}→v${latest.versionCode}):`, err.message);
      }
    }

    if (patchRow) {
      return {
        ...base,
        updateType: "incremental",
        patchUrl: resolveUrl(patchRow.patch_url),
        patchSha256: String(patchRow.patch_sha256 || "").toLowerCase(),
        patchSize: Number(patchRow.patch_size || 0),
        fromVersionCode: Number(patchRow.from_version_code),
        targetApkSha256: latest.sha256.toLowerCase(),
        fallbackUrl: resolveUrl(latest.fileUrl),
        fallbackSize: latest.size,
        fallbackApkUrl: resolveUrl(latest.fileUrl),
        fallbackApkSize: latest.size,
      };
    }
  }

  return {
    ...base,
    updateType: "full",
    downloadUrl: resolveUrl(latest.fileUrl),
    apkUrl: resolveUrl(latest.fileUrl),
    fallbackApkUrl: resolveUrl(latest.fileUrl),
    fallbackApkSize: latest.size,
    sha256: latest.sha256.toLowerCase(),
    size: latest.size,
  };
}

/**
 * Get patch matrix grouped by target version for the admin UI.
 */
export async function getPatchMatrix(appId) {
  const bsdiffAvailable = await checkBsdiffAvailable();
  const historyRows = getVersionHistory(appId);
  if (historyRows.length === 0) {
    return { versionGroups: [], patches: [], bsdiffAvailable, downloadBaseUrl: config.downloadBaseUrl || "" };
  }

  const history = historyRows.map(parseVersion);
  const allPatchRows = getAllPatches(appId);

  const versionGroups = history.map((ver) => {
    const vCode = ver.versionCode;
    const incomingPatches = allPatchRows
      .filter((p) => Number(p.target_version_code) === vCode)
      .map((p) => {
        const patchSize = Number(p.patch_size || 0);
        const savedBytes = ver.size > 0 ? Math.max(0, ver.size - patchSize) : 0;
        const fromVer = history.find((h) => h.versionCode === Number(p.from_version_code));
        const patchFromCode = Number(p.from_version_code);
        const intermediate = history.filter((h) => h.versionCode > patchFromCode && h.versionCode <= vCode);
        const cumulativeNotes = [];
        if (intermediate.length > 1) {
          for (const iv of intermediate) {
            const tag = formatVersionTag(iv.versionName, iv.versionCode);
            for (const n of (iv.releaseNotes || [])) {
              const clean = String(n).trim().replace(/^[-*•]\s*/, "");
              if (clean) {
                const already = clean.toLowerCase().startsWith(tag.toLowerCase());
                cumulativeNotes.push(already ? clean : `${tag}: ${clean}`);
              }
            }
          }
        }

        return {
          fromVersionCode: patchFromCode,
          fromVersionName: fromVer?.versionName || `v${p.from_version_code}`,
          targetVersionCode: vCode,
          patchFile: p.patch_file,
          patchUrl: resolveUrl(p.patch_url),
          patchSha256: p.patch_sha256,
          patchSize,
          savedBytes,
          savedPercentage: ver.size > 0 ? Number(((savedBytes / ver.size) * 100).toFixed(1)) : 0,
          downloadCount: Number(p.download_count || 0),
          createdAt: p.created_at
            ? (String(p.created_at).includes("T")
                ? (String(p.created_at).endsWith("Z") ? p.created_at : `${p.created_at}Z`)
                : `${String(p.created_at).replace(" ", "T")}Z`)
            : null,
          cumulativeReleaseNotes: cumulativeNotes,
        };
      })
      .sort((a, b) => b.fromVersionCode - a.fromVersionCode);

    const eligibleOlder = history.filter((h) => h.versionCode < vCode);
    const covered = new Set(incomingPatches.map((p) => p.fromVersionCode));
    const missingVersions = eligibleOlder.filter((h) => !covered.has(h.versionCode))
      .map((h) => ({ versionCode: h.versionCode, versionName: h.versionName }));

    return {
      versionCode: vCode,
      versionName: ver.versionName,
      minVersionCode: ver.minVersionCode,
      forceUpdate: ver.forceUpdate,
      isLatest: ver.isLatest,
      size: ver.size,
      downloadCount: ver.downloadCount,
      downloadUrl: resolveUrl(ver.fileUrl),
      sha256: ver.sha256,
      publishedAt: ver.publishedAt,
      releaseNotes: ver.releaseNotes,
      patches: incomingPatches,
      eligibleCount: eligibleOlder.length,
      coveredCount: incomingPatches.length,
      missingCount: missingVersions.length,
      missingVersions,
    };
  });

  return { versionGroups, bsdiffAvailable, downloadBaseUrl: config.downloadBaseUrl || "" };
}

/**
 * Update version configuration (forceUpdate, minVersionCode, releaseNotes, etc.)
 */
export async function updateVersionConfig(appId, versionCode, { forceUpdate, minVersionCode, releaseNotes, versionName } = {}) {
  const app = getApp(appId);
  if (!app) throw new Error(`App "${appId}" 不存在`);

  const vCode = Number(versionCode);
  const ver = getVersion(appId, vCode);
  if (!ver) throw new Error(`版本 ${vCode} 不存在`);

  const fields = {};
  if (forceUpdate !== undefined) {
    fields.force_update = Boolean(forceUpdate);
  }
  if (minVersionCode !== undefined) {
    const minCode = Number(minVersionCode);
    if (!Number.isInteger(minCode) || minCode < 1) {
      throw new Error("minVersionCode 必须是大于等于 1 的整数");
    }
    fields.min_version_code = minCode;
  }
  if (releaseNotes !== undefined) {
    const list = Array.isArray(releaseNotes)
      ? releaseNotes.map(String).map((s) => s.trim()).filter(Boolean)
      : String(releaseNotes || "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
    fields.release_notes = JSON.stringify(list);
  }
  if (versionName !== undefined) {
    const name = String(versionName).trim();
    if (!name) throw new Error("versionName 不能为空");
    fields.version_name = name;
  }

  const updated = updateVersion(appId, vCode, fields);
  return parseVersion(updated);
}

