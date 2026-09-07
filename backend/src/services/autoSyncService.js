import { config } from "../config.js";
import { getAutoSyncApps, getDueAutoSyncApps, recordSyncResult } from "./storageAdapter.js";
import { syncLatestRelease } from "./releaseService.js";

let isSyncRunning = false;

/**
 * Check if a specific app is due for sync at a given timestamp.
 */
export function isAppDueForSync(app, now = new Date()) {
  if (!app || !app.auto_sync || !app.github_repo) return false;
  if (!app.last_synced_at) return true;
  const lastTime = new Date(app.last_synced_at).getTime();
  if (Number.isNaN(lastTime)) return true;
  const intervalMinutes = Math.max(Number(app.auto_sync_interval_minutes) || 60, 5);
  return (now.getTime() - lastTime) >= intervalMinutes * 60 * 1000;
}

/**
 * Helper to run async tasks with a concurrency limit.
 */
async function runWithConcurrency(items, limit, fn) {
  const results = [];
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item)).then((res) => {
      executing.delete(p);
      return res;
    });
    results.push(p);
    executing.add(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

/**
 * Execute an auto-sync pass.
 * @param {Object} options
 * @param {boolean} options.forceAll If true, syncs all autoSync-enabled apps regardless of interval. If false, syncs only due apps.
 */
export async function runAutoSyncCycle({ forceAll = false } = {}) {
  if (isSyncRunning) {
    console.log("[AutoSync] 上一轮自动检测仍在进行中，跳过本次触发");
    return { skipped: true };
  }

  isSyncRunning = true;

  try {
    const apps = forceAll ? getAutoSyncApps() : getDueAutoSyncApps();
    if (apps.length === 0) {
      return { count: 0, results: [] };
    }

    console.log(
      `[AutoSync] 开始检测 Release 更新（模式: ${forceAll ? "全量强制" : "按周期到期"}），共有 ${apps.length} 个 App 需同步`
    );

    // Concurrency limit = 2 to avoid network / CPU spikes
    const results = await runWithConcurrency(apps, 2, async (app) => {
      const appId = app.app_id;
      const token = config.resolveGithubToken(appId);

      try {
        console.log(`[AutoSync] 检查 ${appId} (${app.github_repo}, 周期: ${app.auto_sync_interval_minutes || 60}m)...`);
        const syncRes = await syncLatestRelease(appId, {
          githubRepo: app.github_repo,
          githubApiUrl: app.github_api_url,
          token,
          platform: app.platform,
          assetPattern: app.asset_pattern,
        });

        recordSyncResult(appId);
        console.log(`[AutoSync] ${appId} 同步成功: v${syncRes.versionName} (代码: ${syncRes.versionCode})`);
        return { appId, success: true, version: syncRes.versionName };
      } catch (err) {
        recordSyncResult(appId, { error: err.message });
        console.warn(`[AutoSync] ${appId} 同步失败:`, err.message);
        return { appId, success: false, error: err.message };
      }
    });

    return { count: results.length, results };
  } finally {
    isSyncRunning = false;
  }
}

/**
 * Start the background 1-minute heartbeat scheduler.
 */
export function startAutoSyncScheduler() {
  if (config.autoSyncIntervalMinutes <= 0) {
    console.log("[AutoSync] 自动定时检测未启用 (AUTO_SYNC_INTERVAL_MINUTES <= 0)");
    return null;
  }

  const HEARTBEAT_INTERVAL_MS = 60_000;
  console.log("[AutoSync] 独立定时检测调度器已启动（1分钟心跳轮询，按各 App 独立配置的周期触发）");

  // Run initial check 10 seconds after server launch (only for apps due)
  const initialTimeout = setTimeout(() => {
    runAutoSyncCycle({ forceAll: false }).catch((err) =>
      console.error("[AutoSync] 初始同步检查异常:", err)
    );
  }, 10_000);

  const timer = setInterval(() => {
    runAutoSyncCycle({ forceAll: false }).catch((err) =>
      console.error("[AutoSync] 定时同步异常:", err)
    );
  }, HEARTBEAT_INTERVAL_MS);

  return {
    stop() {
      clearTimeout(initialTimeout);
      clearInterval(timer);
      console.log("[AutoSync] 定时检测已停止");
    },
  };
}
