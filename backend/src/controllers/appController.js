import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { getApp } from "../services/storageAdapter.js";
import {
  getAllApps,
  getAppById,
  registerApp,
  updateAppConfig,
  removeApp,
} from "../services/appRegistryService.js";
import { syncLatestRelease, generatePatchBetweenVersions, generateAllMissingPatchesForVersion } from "../services/releaseService.js";
import { getVersionForClient, getPatchMatrix } from "../services/versionService.js";

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
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate").header("Pragma", "no-cache");
  const currentVersionCode = request.query.versionCode || request.query.currentVersionCode;
  return ok(reply, await getVersionForClient(appId, { currentVersionCode }));
}

export async function serveReleaseController(request, reply) {
  const { appId, filename } = request.params;
  if (!/^[A-Za-z0-9._-]+\.(apk|bin|exe|msi|dmg|zip)$/.test(filename)) {
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
  const { appId, name, platform, githubRepo, githubApiUrl, autoSync } = request.body || {};
  const app = registerApp({ appId, name, platform, githubRepo, githubApiUrl, autoSync });
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
  const result = await syncLatestRelease(appId, {
    githubRepo: app.githubRepo,
    githubApiUrl: app.githubApiUrl,
    token,
    platform: app.platform,
  });
  return ok(reply, result, "Release 已同步");
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
