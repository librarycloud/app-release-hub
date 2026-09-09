import { listApps, getApp, insertApp, updateApp, deleteApp } from "./storageAdapter.js";

export function getAllApps() {
  return listApps().map(formatApp);
}

export function getAppById(appId) {
  const row = getApp(appId);
  if (!row) return null;
  return formatApp(row);
}

export function cleanGithubRepo(input) {
  if (!input) return "";
  let repo = String(input).trim();
  repo = repo.replace(/^https?:\/\/github\.com\//i, "");
  repo = repo.replace(/^github\.com\//i, "");
  repo = repo.replace(/\.git$/i, "");
  repo = repo.replace(/\/+$/, "");
  return repo;
}

export function registerApp({
  appId,
  name,
  platform = "android",
  githubRepo = "",
  githubApiUrl = "https://api.github.com",
  autoSync = false,
  autoSyncIntervalMinutes = 60,
  assetPattern = "",
  patchReadinessPolicy = "hide_download_link",
  isPrivate = false,
  clientToken = "",
  maxRetainedVersions = 0,
  webhookUrl = "",
  webhookType = "generic",
}) {
  if (!appId || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(appId)) {
    throw new Error("appId 只能包含小写字母、数字和连字符，且不能以连字符开头或结尾");
  }
  if (getApp(appId)) {
    throw new Error(`App "${appId}" 已存在`);
  }
  if (!name) throw new Error("name 不能为空");
  insertApp({
    appId,
    name,
    platform,
    githubRepo: cleanGithubRepo(githubRepo),
    githubApiUrl,
    autoSync,
    autoSyncIntervalMinutes,
    assetPattern,
    patchReadinessPolicy,
    isPrivate,
    clientToken,
    maxRetainedVersions,
    webhookUrl,
    webhookType,
  });
  return getAppById(appId);
}

export function updateAppConfig(appId, fields) {
  if (!getApp(appId)) throw new Error(`App "${appId}" 不存在`);
  const mapped = {};
  if (fields.name !== undefined) mapped.name = fields.name;
  if (fields.platform !== undefined) mapped.platform = fields.platform;
  if (fields.githubRepo !== undefined) mapped.github_repo = cleanGithubRepo(fields.githubRepo);
  if (fields.githubApiUrl !== undefined) mapped.github_api_url = fields.githubApiUrl;
  if (fields.autoSync !== undefined) mapped.auto_sync = fields.autoSync;
  if (fields.autoSyncIntervalMinutes !== undefined) {
    mapped.auto_sync_interval_minutes = Math.max(Number(fields.autoSyncIntervalMinutes) || 60, 5);
  }
  if (fields.assetPattern !== undefined) mapped.asset_pattern = fields.assetPattern;
  if (fields.patchReadinessPolicy !== undefined) {
    mapped.patch_readiness_policy = ["hide_download_link", "silent", "fallback_full"].includes(fields.patchReadinessPolicy)
      ? fields.patchReadinessPolicy
      : "hide_download_link";
  }
  if (fields.isPrivate !== undefined) mapped.is_private = Boolean(fields.isPrivate);
  if (fields.clientToken !== undefined) mapped.client_token = String(fields.clientToken || "");
  if (fields.maxRetainedVersions !== undefined) mapped.max_retained_versions = Math.max(0, Number(fields.maxRetainedVersions) || 0);
  if (fields.webhookUrl !== undefined) mapped.webhook_url = String(fields.webhookUrl || "");
  if (fields.webhookType !== undefined) {
    const validTypes = ["generic", "feishu", "dingtalk", "wecom"];
    mapped.webhook_type = validTypes.includes(fields.webhookType) ? fields.webhookType : "generic";
  }
  updateApp(appId, mapped);
  return getAppById(appId);
}

export function removeApp(appId) {
  if (!getApp(appId)) throw new Error(`App "${appId}" 不存在`);
  deleteApp(appId);
}

function formatApp(row) {
  return {
    appId: row.app_id,
    name: row.name,
    platform: row.platform,
    githubRepo: row.github_repo,
    githubApiUrl: row.github_api_url,
    autoSync: row.auto_sync === 1,
    autoSyncIntervalMinutes: Number(row.auto_sync_interval_minutes || 60),
    assetPattern: row.asset_pattern || "",
    patchReadinessPolicy: row.patch_readiness_policy || "hide_download_link",
    isPrivate: row.is_private === 1,
    clientToken: row.client_token || "",
    maxRetainedVersions: Number(row.max_retained_versions || 0),
    webhookUrl: row.webhook_url || "",
    webhookType: row.webhook_type || "generic",
    checkCount: Number(row.check_count || 0),
    downloadCount: Number(row.download_count || 0),
    lastSyncedAt: row.last_synced_at || null,
    lastSyncError: row.last_sync_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
