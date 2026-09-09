import { createReadStream, createWriteStream } from "node:fs";
import { stat, mkdir, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { config } from "../config.js";
import {
  getApp, recordSyncResult, recordAppCheck, recordReleaseDownload, recordPatchDownload, 
  getAppStats, getGlobalStats, recordDeviceActive, exportAllAppsConfig, importAppsConfig
} from "../services/storageAdapter.js";
import {
  getAllApps, getAppById, registerApp, updateAppConfig, removeApp
} from "../services/appRegistryService.js";
import {
  syncLatestRelease, syncHistoricalReleases, generatePatchBetweenVersions, 
  generateAllMissingPatchesForVersion, deleteReleaseVersion, createManualVersion,
  previewLatestRelease, rollbackToVersion
} from "../services/releaseService.js";
import { getVersionForClient, getPatchMatrix, updateVersionConfig } from "../services/versionService.js";
import { getDownloadUrl, getFileMeta, saveFile } from "../services/storageProvider.js";
import { sendWebhookNotification } from "../services/notificationService.js";

function ok(reply, data, message = "ok") {
  return reply.send({ code: 0, message, data });
}

function appFilesDir(appId) { return path.resolve(config.filesDir, appId); }

async function requireApp(appId, reply) {
  const app = getAppById(appId);
  if (!app) {
    reply.code(404).send({ code: 404, message: `App "${appId}" 不存在` });
    return null;
  }
  return app;
}

function validateClientToken(app, request) {
  if (!app.isPrivate) return true;
  const token = request.headers["x-client-token"] || request.query.token;
  return token && token === app.clientToken;
}

// ─── Public ──────────────────────────────────────────────────────────────────

export async function clientVersionController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;

  if (!validateClientToken(app, request)) {
    return reply.code(403).send({ code: 403, message: "无权访问此私有 App" });
  }

  try { recordAppCheck(appId); } catch {}
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate").header("Pragma", "no-cache");
  const currentVersionCode = request.query.versionCode || request.query.currentVersionCode;
  const policy = request.query.policy;
  const channel = request.query.channel || "stable";
  const deviceId = request.query.deviceId || request.headers["x-device-id"] || "";

  if (deviceId) {
    try {
      recordDeviceActive(appId, deviceId, {
        platform: app.platform,
        versionCode: Number(currentVersionCode) || null,
      });
    } catch {}
  }

  const versionData = await getVersionForClient(appId, { currentVersionCode, policy, channel, deviceId });
  if (versionData && app.isPrivate && app.clientToken) {
    const tokenQuery = `token=${encodeURIComponent(app.clientToken)}`;
    const appendToken = (url) => {
      if (!url) return url;
      if (url.includes("token=")) return url;
      return url.includes("?") ? `${url}&${tokenQuery}` : `${url}?${tokenQuery}`;
    };
    if (versionData.downloadUrl) versionData.downloadUrl = appendToken(versionData.downloadUrl);
    if (versionData.patchUrl) versionData.patchUrl = appendToken(versionData.patchUrl);
    if (versionData.fallbackUrl) versionData.fallbackUrl = appendToken(versionData.fallbackUrl);
    if (versionData.apkUrl) versionData.apkUrl = appendToken(versionData.apkUrl);
    if (versionData.fallbackApkUrl) versionData.fallbackApkUrl = appendToken(versionData.fallbackApkUrl);
  }

  return ok(reply, versionData);
}

export async function getShareInfoController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;

  if (app.isPrivate && !validateClientToken(app, request)) {
    return reply.send({
      code: 403,
      message: "该 App 已开启私有保护，请输入访问 Token",
      data: {
        isPrivate: true,
        requireAuth: true,
        appId: app.appId,
        name: app.name,
        platform: app.platform,
      },
    });
  }

  const channel = request.query.channel || "stable";
  const versionData = await getVersionForClient(appId, { channel, policy: "fallback_full" });

  const tokenParam = app.isPrivate && app.clientToken ? `?token=${encodeURIComponent(app.clientToken)}` : "";
  const iosPlistUrl = app.platform === "ios" ? `/api/apps/${appId}/install.plist${tokenParam}` : null;

  return ok(reply, {
    appId: app.appId,
    name: app.name,
    platform: app.platform,
    isPrivate: app.isPrivate,
    channel,
    hasRelease: Boolean(versionData),
    version: versionData ? {
      versionName: versionData.versionName,
      versionCode: versionData.versionCode,
      size: versionData.size || versionData.fallbackSize || 0,
      sha256: versionData.sha256 || versionData.targetApkSha256 || "",
      publishedAt: versionData.publishedAt,
      releaseNotes: versionData.releaseNotes || [],
      downloadUrl: (versionData.downloadUrl || versionData.fallbackUrl || "") + (tokenParam && !versionData.downloadUrl?.includes("token=") ? (versionData.downloadUrl?.includes("?") ? `&token=${encodeURIComponent(app.clientToken)}` : tokenParam) : ""),
      iosPlistUrl,
    } : null,
  });
}

async function serveFileWithRange(request, reply, appId, subDir, filename, recordStatFn) {
  const app = await requireApp(appId, reply);
  if (!app) return;

  if (!validateClientToken(app, request)) {
    return reply.code(403).send({ code: 403, message: "无权下载此私有 App" });
  }

  try { recordStatFn(appId, filename); } catch {}

  if (config.storageType === "s3") {
    const url = await getDownloadUrl(appId, subDir, filename, app.isPrivate);
    return reply.redirect(302, url);
  }

  if (config.enableNginxAccel) {
    return reply
      .header("X-Accel-Redirect", `${config.nginxInternalPathPrefix}/${appId}/${subDir}/${filename}`)
      .send();
  }

  const { exists, size, path: filePath } = await getFileMeta(appId, subDir, filename);
  if (!exists) return reply.code(404).send({ code: 404, message: "文件不存在" });

  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Disposition", `attachment; filename="${filename}"`);

  const range = request.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
    if (start >= size || end >= size) {
      return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    }
    reply
      .code(206)
      .header("Content-Range", `bytes ${start}-${end}/${size}`)
      .header("Content-Length", end - start + 1);
    return reply.send(createReadStream(filePath, { start, end }));
  }

  reply.header("Content-Length", size);
  return reply.send(createReadStream(filePath));
}

export async function serveReleaseController(request, reply) {
  return serveFileWithRange(request, reply, request.params.appId, "releases", request.params.filename, recordReleaseDownload);
}


export async function electronUpdateController(request, reply) {
  const { appId, currentVersion } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;

  const channel = request.query.channel || "stable";
  const result = await getVersionForClient(appId, { currentVersionCode: currentVersion, policy: "fallback_full", channel });
  
  if (!result || !result.hasUpdate) {
    return reply.code(204).send(); // 204 No Content for Electron autoUpdater when no update
  }

  // Construct absolute URL safely (prevent double baseUrl if result.downloadUrl already resolved)
  const downloadUrl = ensureAbsoluteUrl(result.downloadUrl, request);

  return reply.send({
    name: result.versionName || result.versionCode,
    notes: Array.isArray(result.releaseNotes) ? result.releaseNotes.join("\n") : result.releaseNotes,
    pub_date: result.publishedAt ? new Date(result.publishedAt).toISOString() : new Date().toISOString(),
    url: downloadUrl
  });
}

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ensureAbsoluteUrl(url, request) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const baseUrl = (config.downloadBaseUrl || `${request.protocol}://${request.hostname}`).replace(/\/+$/, "");
  const cleanPath = url.startsWith("/") ? url : `/${url}`;
  return `${baseUrl}${cleanPath}`;
}

export async function iosManifestController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;

  const result = await getVersionForClient(appId, { policy: "fallback_full" });
  if (!result || !result.downloadUrl) {
    return reply.code(404).send("No iOS version available");
  }

  const downloadUrl = ensureAbsoluteUrl(result.downloadUrl, request);
  const bundleId = escapeXml(app.bundleId || app.bundleIdentifier || appId);
  const bundleVersion = escapeXml(result.versionName || result.versionCode);
  const title = escapeXml(app.name);
  
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>items</key>
    <array>
        <dict>
            <key>assets</key>
            <array>
                <dict>
                    <key>kind</key>
                    <string>software-package</string>
                    <key>url</key>
                    <string>${escapeXml(downloadUrl)}</string>
                </dict>
            </array>
            <key>metadata</key>
            <dict>
                <key>bundle-identifier</key>
                <string>${bundleId}</string>
                <key>bundle-version</key>
                <string>${bundleVersion}</string>
                <key>kind</key>
                <string>software</string>
                <key>title</key>
                <string>${title}</string>
            </dict>
        </dict>
    </array>
</dict>
</plist>`;

  reply.header('Content-Type', 'text/xml');
  return reply.send(manifest);
}

export async function servePatchController(request, reply) {
  return serveFileWithRange(request, reply, request.params.appId, "patches", request.params.filename, recordPatchDownload);
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export async function listAppsController(_request, reply) { return ok(reply, getAllApps()); }

export async function createAppController(request, reply) {
  const data = request.body || {};
  const app = registerApp(data);
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
  return ok(reply, null, `App "${appId}" 已删除`);
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
  const result = await generatePatchBetweenVersions(appId, fromVersionCode, targetVersionCode);
  return ok(reply, result, "差分补丁已生成");
}

export async function generateAllPatchesController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;
  const { targetVersionCode } = request.body || {};
  const result = await generateAllMissingPatchesForVersion(appId, targetVersionCode, null);
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

      const fileInfo = tempFilePath ? { filePath: tempFilePath, originalFilename } : null;
      const result = await createManualVersion(appId, fields, fileInfo);
      return reply.code(201).send({ code: 0, message: "版本创建成功", data: result });
    } catch (err) {
      if (tempFilePath) await rm(tempFilePath, { force: true }).catch(() => {});
      throw err;
    }
  } else {
    const result = await createManualVersion(appId, request.body || {}, null);
    return reply.code(201).send({ code: 0, message: "版本创建成功", data: result });
  }
}

export async function uploadPatchController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;

  if (!request.isMultipart()) return reply.code(400).send({code:400, message:"需要表单上传文件"});
  
  const parts = request.parts();
  const fields = {};
  let tempFilePath = null;
  
  try {
    for await (const part of parts) {
      if (part.type === "file") {
        const uploadDir = path.join(appFilesDir(appId), "uploads");
        await mkdir(uploadDir, { recursive: true });
        tempFilePath = path.join(uploadDir, `patch-${Date.now()}.tmp`);
        await pipeline(part.file, createWriteStream(tempFilePath));
      } else {
        fields[part.fieldname] = part.value;
      }
    }
    
    if (!fields.fromVersionCode || !fields.targetVersionCode || !tempFilePath) {
      throw new Error("参数不完整 (fromVersionCode, targetVersionCode, file)");
    }
    
    const patchFileName = `patch-v${fields.fromVersionCode}-to-v${fields.targetVersionCode}.patch`;
    await saveFile(appId, "patches", patchFileName, tempFilePath);
    
    // We can also trigger a manual upsertPatch here, but releaseService generates the DB record.
    // For manual patch upload, we'd need to insert it manually.
    const { computeFileSha256 } = await import("../services/patchService.js");
    const { upsertPatch } = await import("../services/storageAdapter.js");
    
    const sha256 = await computeFileSha256(tempFilePath);
    const size = (await stat(tempFilePath)).size;
    
    upsertPatch(appId, {
      fromVersionCode: Number(fields.fromVersionCode),
      targetVersionCode: Number(fields.targetVersionCode),
      patchFile: patchFileName,
      patchUrl: `/api/apps/${appId}/patches/${patchFileName}`,
      patchSha256: sha256,
      patchSize: size
    });
    
    return ok(reply, null, "补丁上传成功");
  } finally {
    if (tempFilePath) await rm(tempFilePath, {force:true}).catch(()=>{});
  }
}

export async function testWebhookController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;
  await sendWebhookNotification(appId, "test", {});
  return ok(reply, null, "测试 Webhook 消息已发送");
}

export async function getGlobalStatsController(_request, reply) { return ok(reply, getGlobalStats()); }
export async function getAppStatsController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;
  return ok(reply, getAppStats(appId));
}

export async function previewReleaseController(request, reply) {
  const { appId } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;

  try {
    const preview = await previewLatestRelease(appId);
    return ok(reply, preview);
  } catch (err) {
    return reply.code(400).send({ code: 400, message: err.message });
  }
}

export async function rollbackVersionController(request, reply) {
  const { appId, versionCode } = request.params;
  const app = await requireApp(appId, reply);
  if (!app) return;

  try {
    const result = await rollbackToVersion(appId, versionCode);
    return ok(reply, result, `已成功将版本 v${result.versionName} 设为最新生效版本`);
  } catch (err) {
    return reply.code(400).send({ code: 400, message: err.message });
  }
}

export async function exportAppsController(_request, reply) {
  const apps = exportAllAppsConfig();
  return ok(reply, apps);
}

export async function importAppsController(request, reply) {
  const appsList = request.body;
  if (!Array.isArray(appsList)) {
    return reply.code(400).send({ code: 400, message: "请求体必须为 App 配置数组" });
  }
  const result = importAppsConfig(appsList);
  return ok(reply, result, `批量导入完成: 新增 ${result.createdCount} 个，更新 ${result.updatedCount} 个`);
}
