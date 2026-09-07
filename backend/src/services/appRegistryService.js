import { listApps, getApp, insertApp, updateApp, deleteApp } from "./storageAdapter.js";

export function getAllApps() {
  return listApps().map(formatApp);
}

export function getAppById(appId) {
  const row = getApp(appId);
  if (!row) return null;
  return formatApp(row);
}

export function registerApp({ appId, name, platform = "android", githubRepo = "", githubApiUrl = "https://api.github.com", autoSync = false, assetPattern = "" }) {
  if (!appId || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(appId)) {
    throw new Error("appId 只能包含小写字母、数字和连字符，且不能以连字符开头或结尾");
  }
  if (getApp(appId)) {
    throw new Error(`App "${appId}" 已存在`);
  }
  if (!name) throw new Error("name 不能为空");
  insertApp({ appId, name, platform, githubRepo, githubApiUrl, autoSync, assetPattern });
  return getAppById(appId);
}

export function updateAppConfig(appId, fields) {
  if (!getApp(appId)) throw new Error(`App "${appId}" 不存在`);
  const mapped = {};
  if (fields.name !== undefined) mapped.name = fields.name;
  if (fields.platform !== undefined) mapped.platform = fields.platform;
  if (fields.githubRepo !== undefined) mapped.github_repo = fields.githubRepo;
  if (fields.githubApiUrl !== undefined) mapped.github_api_url = fields.githubApiUrl;
  if (fields.autoSync !== undefined) mapped.auto_sync = fields.autoSync;
  if (fields.assetPattern !== undefined) mapped.asset_pattern = fields.assetPattern;
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
    assetPattern: row.asset_pattern || "",
    lastSyncedAt: row.last_synced_at || null,
    lastSyncError: row.last_sync_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
