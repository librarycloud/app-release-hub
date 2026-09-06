import { config } from "../config.js";
import { getAutoSyncApps, recordSyncResult } from "./storageAdapter.js";
import { syncLatestRelease } from "./releaseService.js";

let isSyncRunning = false;

/**
 * Execute a single auto-sync pass across all apps that have auto_sync enabled.
 */
export async function runAutoSyncCycle() {
  if (isSyncRunning) {
    console.log("[AutoSync] 上一轮自动检测仍在进行中，跳过本次触发");
    return { skipped: true };
  }

  isSyncRunning = true;
  const results = [];

  try {
    const apps = getAutoSyncApps();
    if (apps.length === 0) {
      return { count: 0, results: [] };
    }

    console.log(`[AutoSync] 开始定时检测 Release 更新，共有 ${apps.length} 个 App 开启了自动同步`);

    for (const app of apps) {
      const appId = app.app_id;
      const token = config.resolveGithubToken(appId);

      try {
        console.log(`[AutoSync] 检查 ${appId} (${app.github_repo})...`);
        const syncRes = await syncLatestRelease(appId, {
          githubRepo: app.github_repo,
          githubApiUrl: app.github_api_url,
          token,
          platform: app.platform,
        });

        recordSyncResult(appId);
        console.log(`[AutoSync] ${appId} 同步成功: v${syncRes.versionName} (代码: ${syncRes.versionCode})`);
        results.push({ appId, success: true, version: syncRes.versionName });
      } catch (err) {
        recordSyncResult(appId, { error: err.message });
        console.warn(`[AutoSync] ${appId} 同步失败:`, err.message);
        results.push({ appId, success: false, error: err.message });
      }
    }
  } finally {
    isSyncRunning = false;
  }

  return { count: results.length, results };
}

/**
 * Start the background periodic scheduler based on configured interval.
 */
export function startAutoSyncScheduler() {
  const minutes = config.autoSyncIntervalMinutes;
  if (!minutes || minutes <= 0) {
    console.log("[AutoSync] 自动定时检测未启用 (AUTO_SYNC_INTERVAL_MINUTES <= 0)");
    return null;
  }

  const intervalMs = minutes * 60 * 1000;
  console.log(`[AutoSync] 定时检测已启动，每 ${minutes} 分钟检测一次所有开启 autoSync 的 App`);

  // Run initial check 10 seconds after server launch
  const initialTimeout = setTimeout(() => {
    runAutoSyncCycle().catch((err) => console.error("[AutoSync] 初始同步检查异常:", err));
  }, 10_000);

  const timer = setInterval(() => {
    runAutoSyncCycle().catch((err) => console.error("[AutoSync] 定时同步异常:", err));
  }, intervalMs);

  return {
    stop() {
      clearTimeout(initialTimeout);
      clearInterval(timer);
      console.log("[AutoSync] 定时检测已停止");
    },
  };
}
