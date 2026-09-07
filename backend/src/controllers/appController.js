import { createReadStream, createWriteStream } from "node:fs";
import { stat, mkdir, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { config } from "../config.js";
import {
  getApp,
  recordSyncResult,
  recordAppCheck,
  recordReleaseDownload,
  recordPatchDownload,
  getAppStats,
  getGlobalStats,
} from "../services/storageAdapter.js";
import {
  getAllApps,
  getAppById,
  registerApp,
  updateAppConfig,
  removeApp,
} from "../services/appRegistryService.js";
import {
  syncLatestRelease,
  generatePatchBetweenVersions,
  generateAllMissingPatchesForVersion,
  deleteReleaseVersion,
  syncHistoricalReleases,
  createManualVersion,
} from "../services/releaseService.js";
import { getVersionForClient, getPatchMatrix, updateVersionConfig } from "../services/versionService.js";

function ok(reply, data, message = "ok") {
  return reply.send({ code: 0, message, data });
}

function appFilesDir(appId) {
  return path.resolve(config.filesDir, appId);
}

async function requireApp(appId, reply) {
  const app = getAppById(appId);
  if (!app) {
    reply.code(404).send({ code: 404, message: `App "${appId}" 不存在` });
    return null;
  }
  return app;
}

// ─── Public ──────────────────────────────────────────────────────────────────

export async function clientVersionController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;
  try {
    recordAppCheck(appId);
  } catch {
    // Non-blocking
  }
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate").header("Pragma", "no-cache");
  const currentVersionCode = request.query.versionCode || request.query.currentVersionCode;
  const policy = request.query.policy;
  return ok(reply, await getVersionForClient(appId, { currentVersionCode, policy }));
}

export async function serveReleaseController(request, reply) {
  const { appId, filename } = request.params;
  if (!/^[A-Za-z0-9._-]+\.(apk|aab|bin|exe|msi|dmg|pkg|appimage|deb|rpm|ipa|zip|tar\.gz)$/i.test(filename)) {
    return reply.code(404).send({ code: 404, message: "文件不存在" });
  }
  if (!getApp(appId)) return reply.code(404).send({ code: 404, message: "App 不存在" });
  const filePath = path.join(appFilesDir(appId), "releases", filename);
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return reply.code(404).send({ code: 404, message: "文件不存在" });
  } catch {
    return reply.code(404).send({ code: 404, message: "文件不存在" });
  }
  try {
    recordReleaseDownload(appId, filename);
  } catch {
    // Non-blocking
  }
  reply
    .header("Cache-Control", "no-store, no-cache, must-revalidate")
    .header("Content-Disposition", `attachment; filename="${filename}"`);
  return reply.send(createReadStream(filePath));
}

export async function servePatchController(request, reply) {
  const { appId, filename } = request.params;
  if (!/^[A-Za-z0-9._-]+\.patch$/.test(filename)) {
    return reply.code(404).send({ code: 404, message: "补丁文件不存在" });
  }
  if (!getApp(appId)) return reply.code(404).send({ code: 404, message: "App 不存在" });
  const filePath = path.join(appFilesDir(appId), "patches", filename);
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return reply.code(404).send({ code: 404, message: "补丁文件不存在" });
  } catch {
    return reply.code(404).send({ code: 404, message: "补丁文件不存在" });
  }
  try {
    recordPatchDownload(appId, filename);
  } catch {
    // Non-blocking
  }
  reply
    .type("application/octet-stream")
    .header("Cache-Control", "no-store, no-cache, must-revalidate")
    .header("Content-Disposition", `attachment; filename="${filename}"`);
  return reply.send(createReadStream(filePath));
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export async function listAppsController(_request, reply) {
  return ok(reply, getAllApps());
}

export async function createAppController(request, reply) {
  const { appId, name, platform, githubRepo, githubApiUrl, autoSync, autoSyncIntervalMinutes, assetPattern, patchReadinessPolicy } = request.body || {};
  const app = registerApp({ appId, name, platform, githubRepo, githubApiUrl, autoSync, autoSyncIntervalMinutes, assetPattern, patchReadinessPolicy });
  return reply.code(201).send({ code: 0, message: "App 注册成功", data: app });
}

export async function updateAppController(request, reply) {
  const { appId } = request.params;
  const updated = updateAppConfig(appId, request.body || {});
  return ok(reply, updated, "App 配置已更新");
}

export async function deleteAppController(request, reply) {
  const { appId } = request.params;
  removeApp(appId);
  return ok(reply, null, `App "${appId}" 已删除（文件需手动清理）`);
}

export async function syncReleaseController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;
  const token = config.resolveGithubToken(appId);
  try {
    const result = await syncLatestRelease(appId, {
      githubRepo: app.githubRepo,
      githubApiUrl: app.githubApiUrl,
      token,
      platform: app.platform,
      assetPattern: app.assetPattern,
    });
    recordSyncResult(appId);
    return ok(reply, result, "Release 已同步");
  } catch (err) {
    recordSyncResult(appId, { error: err.message });
    throw err;
  }
}

export async function patchMatrixController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;
  return ok(reply, await getPatchMatrix(appId));
}

export async function generatePatchController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;
  const { fromVersionCode, targetVersionCode } = request.body || {};
  if (!fromVersionCode || !targetVersionCode) {
    return reply.code(400).send({ code: 400, message: "fromVersionCode 和 targetVersionCode 必填" });
  }
  const result = await generatePatchBetweenVersions(appId, fromVersionCode, targetVersionCode);
  return ok(reply, result, "差分补丁已生成");
}

export async function generateAllPatchesController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;
  const { targetVersionCode } = request.body || {};
  if (!targetVersionCode) {
    return reply.code(400).send({ code: 400, message: "targetVersionCode 必填" });
  }
  const token = config.resolveGithubToken(appId);
  const githubContext = app.githubRepo
    ? { base: (app.githubApiUrl || "https://api.github.com").replace(/\/$/, ""), repo: app.githubRepo, headers: { Accept: "application/vnd.github+json", "User-Agent": "app-release-hub", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
    : null;
  const result = await generateAllMissingPatchesForVersion(appId, targetVersionCode, githubContext);
  return ok(reply, result, `已生成 ${result.generatedCount} 个差分补丁`);
}

export async function syncAllAppsController(_request, reply) {
  const { runAutoSyncCycle } = await import("../services/autoSyncService.js");
  const result = await runAutoSyncCycle({ forceAll: true });
  return ok(reply, result, "全部自动同步任务已触发");
}

export async function updateVersionController(request, reply) {
  const { appId, versionCode } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;
  const result = await updateVersionConfig(appId, versionCode, request.body || {});
  return ok(reply, result, "版本配置已更新");
}

export async function deleteVersionController(request, reply) {
  const { appId, versionCode } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;
  const result = await deleteReleaseVersion(appId, versionCode);
  return ok(reply, result, `版本 v${versionCode} 及关联差分包已删除`);
}

export async function syncHistoryReleasesController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;
  const { limit = 20, autoGeneratePatches = false } = request.body || {};
  const result = await syncHistoricalReleases(appId, { limit, autoGeneratePatches });
  return ok(reply, result, `已同步历史版本 (导入 ${result.importedCount} 个，跳过 ${result.skippedCount} 个)`);
}

export async function createVersionController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;

  if (request.isMultipart()) {
    const parts = request.parts();
    const fields = {};
    let tempFilePath = null;
    let originalFilename = null;

    try {
      for await (const part of parts) {
        if (part.type === "file") {
          originalFilename = part.filename;
          const uploadDir = path.join(appFilesDir(appId), "uploads");
          await mkdir(uploadDir, { recursive: true });
          const tmpName = `.upload-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(part.filename || "")}`;
          tempFilePath = path.join(uploadDir, tmpName);
          await pipeline(part.file, createWriteStream(tempFilePath));
        } else {
          fields[part.fieldname] = part.value;
        }
      }

      let releaseNotes = fields.releaseNotes;
      if (typeof releaseNotes === "string" && releaseNotes.trim().startsWith("[")) {
        try {
          const parsed = JSON.parse(releaseNotes);
          if (Array.isArray(parsed)) releaseNotes = parsed;
        } catch {}
      }

      const fileInfo = tempFilePath ? { filePath: tempFilePath, originalFilename } : null;
      const result = await createManualVersion(
        appId,
        {
          versionCode: fields.versionCode,
          versionName: fields.versionName,
          releaseNotes,
          publishedAt: fields.publishedAt,
          minVersionCode: fields.minVersionCode,
          forceUpdate: fields.forceUpdate === "true" || fields.forceUpdate === true || fields.forceUpdate === "1" || fields.forceUpdate === 1,
          changelogUrl: fields.changelogUrl,
          fileUrl: fields.fileUrl,
          sha256: fields.sha256,
          size: fields.size,
        },
        fileInfo
      );

      return reply.code(201).send({ code: 0, message: "版本创建成功", data: result });
    } catch (err) {
      if (tempFilePath) {
        await rm(tempFilePath, { force: true }).catch(() => {});
      }
      throw err;
    }
  } else {
    const body = request.body || {};
    const result = await createManualVersion(appId, body, null);
    return reply.code(201).send({ code: 0, message: "版本创建成功", data: result });
  }
}

export async function getGlobalStatsController(_request, reply) {
  return ok(reply, getGlobalStats());
}

export async function getAppStatsController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;
  return ok(reply, getAppStats(appId));
}


