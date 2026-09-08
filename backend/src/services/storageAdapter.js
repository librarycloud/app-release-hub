import { db } from "../db/index.js";

// ─── Apps ────────────────────────────────────────────────────────────────────

export function listApps() {
  return db.prepare("SELECT * FROM apps ORDER BY created_at DESC").all();
}

export function getApp(appId) {
  return db.prepare("SELECT * FROM apps WHERE app_id = ?").get(appId) || null;
}

export function insertApp({
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
  const policy = ["hide_download_link", "silent", "fallback_full"].includes(patchReadinessPolicy)
    ? patchReadinessPolicy
    : "hide_download_link";
  const validWebhookTypes = ["generic", "feishu", "dingtalk", "wecom"];
  const wType = validWebhookTypes.includes(webhookType) ? webhookType : "generic";
  db.prepare(`
    INSERT INTO apps (app_id, name, platform, github_repo, github_api_url, auto_sync, auto_sync_interval_minutes, asset_pattern, patch_readiness_policy, is_private, client_token, max_retained_versions, webhook_url, webhook_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    appId,
    name,
    platform,
    githubRepo,
    githubApiUrl,
    autoSync ? 1 : 0,
    Math.max(Number(autoSyncIntervalMinutes) || 60, 5),
    assetPattern || "",
    policy,
    isPrivate ? 1 : 0,
    clientToken || "",
    Math.max(0, Number(maxRetainedVersions) || 0),
    webhookUrl || "",
    wType
  );
}

export function getAutoSyncApps() {
  return db.prepare("SELECT * FROM apps WHERE auto_sync = 1 AND github_repo != ''").all();
}

export function getDueAutoSyncApps() {
  return db.prepare(`
    SELECT * FROM apps 
    WHERE auto_sync = 1 AND github_repo != ''
      AND (
        last_synced_at IS NULL
        OR (strftime('%s', 'now') - strftime('%s', last_synced_at)) >= (COALESCE(auto_sync_interval_minutes, 60) * 60)
      )
  `).all();
}

export function updateApp(appId, fields) {
  const allowed = [
    "name",
    "platform",
    "github_repo",
    "github_api_url",
    "auto_sync",
    "auto_sync_interval_minutes",
    "asset_pattern",
    "patch_readiness_policy",
    "last_synced_at",
    "last_sync_error",
    "is_private",
    "client_token",
    "max_retained_versions",
    "webhook_url",
    "webhook_type",
  ];
  const updates = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      updates.push(`${k} = ?`);
      if (k === "auto_sync" || k === "is_private") {
        values.push(v ? 1 : 0);
      } else if (k === "auto_sync_interval_minutes") {
        values.push(Math.max(Number(v) || 60, 5));
      } else if (k === "max_retained_versions") {
        values.push(Math.max(0, Number(v) || 0));
      } else {
        values.push(v);
      }
    }
  }
  if (updates.length === 0) return;
  updates.push("updated_at = datetime('now')");
  values.push(appId);
  db.prepare(`UPDATE apps SET ${updates.join(", ")} WHERE app_id = ?`).run(...values);
}

export function recordSyncResult(appId, { error = null } = {}) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE apps 
    SET last_synced_at = ?, last_sync_error = ?, updated_at = datetime('now')
    WHERE app_id = ?
  `).run(now, error ? String(error) : null, appId);
}

export function deleteApp(appId) {
  db.prepare("DELETE FROM apps WHERE app_id = ?").run(appId);
}

// ─── Versions ────────────────────────────────────────────────────────────────

export function getLatestVersion(appId) {
  return db.prepare("SELECT * FROM versions WHERE app_id = ? AND is_latest = 1").get(appId) || null;
}

export function getVersionHistory(appId) {
  return db.prepare("SELECT * FROM versions WHERE app_id = ? ORDER BY version_code DESC").all(appId);
}

export function getVersion(appId, versionCode) {
  return db.prepare("SELECT * FROM versions WHERE app_id = ? AND version_code = ?").get(appId, Number(versionCode)) || null;
}

export function formatVersion(row) {
  if (!row) return null;
  return {
    versionCode: Number(row.version_code),
    versionName: row.version_name,
    minVersionCode: Number(row.min_version_code),
    forceUpdate: Boolean(row.force_update),
    releaseNotes: Array.isArray(row.release_notes)
      ? row.release_notes
      : JSON.parse(row.release_notes || "[]"),
    changelogUrl: row.changelog_url,
    publishedAt: row.published_at,
    fileUrl: row.file_url,
    sha256: row.sha256,
    size: row.size,
    downloadCount: Number(row.download_count || 0),
    isLatest: Boolean(row.is_latest),
    rolloutPercentage: Number(row.rollout_percentage ?? 100),
    channel: row.channel || "stable",
  };
}

export function upsertVersion(appId, ver) {
  // Atomically: clear previous latest flag if this is latest, then upsert
  const upsert = db.transaction(() => {
    if (ver.isLatest) {
      db.prepare("UPDATE versions SET is_latest = 0 WHERE app_id = ? AND channel = ?").run(appId, ver.channel || "stable");
    }
    db.prepare(`
      INSERT INTO versions (app_id, version_code, version_name, min_version_code, force_update,
        release_notes, changelog_url, published_at, file_url, sha256, size, is_latest, rollout_percentage, channel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(app_id, version_code) DO UPDATE SET
        version_name     = excluded.version_name,
        min_version_code = excluded.min_version_code,
        force_update     = excluded.force_update,
        release_notes    = excluded.release_notes,
        changelog_url    = excluded.changelog_url,
        published_at     = excluded.published_at,
        file_url         = excluded.file_url,
        sha256           = excluded.sha256,
        size             = excluded.size,
        is_latest        = excluded.is_latest,
        rollout_percentage = excluded.rollout_percentage,
        channel          = excluded.channel
    `).run(
      appId,
      Number(ver.versionCode),
      String(ver.versionName),
      Number(ver.minVersionCode ?? 1),
      ver.forceUpdate ? 1 : 0,
      JSON.stringify(Array.isArray(ver.releaseNotes) ? ver.releaseNotes : []),
      String(ver.changelogUrl ?? ""),
      String(ver.publishedAt ?? ""),
      String(ver.fileUrl ?? ""),
      String(ver.sha256 ?? ""),
      Number(ver.size ?? 0),
      ver.isLatest ? 1 : 0,
      Number(ver.rolloutPercentage ?? 100),
      String(ver.channel || "stable"),
    );
  });
  upsert();
}

export function updateVersion(appId, versionCode, fields) {
  const allowed = ["force_update", "min_version_code", "release_notes", "version_name", "changelog_url", "rollout_percentage", "channel"];
  const updates = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      updates.push(`${k} = ?`);
      if (k === "force_update") {
        values.push(v ? 1 : 0);
      } else if (k === "rollout_percentage") {
        values.push(Math.max(1, Math.min(100, Number(v) || 100)));
      } else {
        values.push(v);
      }
    }
  }
  if (updates.length === 0) return getVersion(appId, versionCode);
  values.push(appId, Number(versionCode));
  db.prepare(`UPDATE versions SET ${updates.join(", ")} WHERE app_id = ? AND version_code = ?`).run(...values);
  return getVersion(appId, versionCode);
}

export function deleteVersionRecord(appId, versionCode) {
  const vCode = Number(versionCode);
  const runTx = db.transaction(() => {
    const ver = getVersion(appId, vCode);
    if (!ver) return null;

    // Delete patches where this version was either from or target
    db.prepare(`
      DELETE FROM patches 
      WHERE app_id = ? AND (from_version_code = ? OR target_version_code = ?)
    `).run(appId, vCode, vCode);

    // Delete the version row
    db.prepare("DELETE FROM versions WHERE app_id = ? AND version_code = ?").run(appId, vCode);

    // If this version was latest, set new latest to highest remaining version
    let newLatest = null;
    if (ver.is_latest === 1) {
      const remaining = db.prepare("SELECT * FROM versions WHERE app_id = ? ORDER BY version_code DESC LIMIT 1").get(appId);
      if (remaining) {
        db.prepare("UPDATE versions SET is_latest = 1 WHERE app_id = ? AND version_code = ?").run(appId, remaining.version_code);
        newLatest = remaining;
      }
    }

    return { deleted: ver, newLatest };
  });

  return runTx();
}

export function hasForceUpdateBetween(appId, fromVersionCode, toVersionCode) {
  const row = db.prepare(`
    SELECT 1 FROM versions 
    WHERE app_id = ? AND version_code > ? AND version_code <= ? AND force_update = 1 
    LIMIT 1
  `).get(appId, Number(fromVersionCode), Number(toVersionCode));
  return Boolean(row);
}

export function getVersionsBetween(appId, fromVersionCode, toVersionCode) {
  return db.prepare(`
    SELECT * FROM versions 
    WHERE app_id = ? AND version_code > ? AND version_code <= ?
    ORDER BY version_code DESC
  `).all(appId, Number(fromVersionCode), Number(toVersionCode));
}

// ─── Patches ─────────────────────────────────────────────────────────────────

export function getPatch(appId, fromVersionCode, targetVersionCode) {
  return db.prepare(`
    SELECT * FROM patches WHERE app_id = ? AND from_version_code = ? AND target_version_code = ?
  `).get(appId, Number(fromVersionCode), Number(targetVersionCode)) || null;
}

export function getPatchesForTarget(appId, targetVersionCode) {
  return db.prepare(`
    SELECT * FROM patches WHERE app_id = ? AND target_version_code = ? ORDER BY from_version_code DESC
  `).all(appId, Number(targetVersionCode));
}

export function getAllPatches(appId) {
  return db.prepare("SELECT * FROM patches WHERE app_id = ? ORDER BY target_version_code DESC, from_version_code DESC").all(appId);
}

export function upsertPatch(appId, patch) {
  db.prepare(`
    INSERT INTO patches (app_id, from_version_code, target_version_code, patch_file, patch_url, patch_sha256, patch_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_id, from_version_code, target_version_code) DO UPDATE SET
      patch_file   = excluded.patch_file,
      patch_url    = excluded.patch_url,
      patch_sha256 = excluded.patch_sha256,
      patch_size   = excluded.patch_size,
      created_at   = datetime('now')
  `).run(
    appId,
    Number(patch.fromVersionCode),
    Number(patch.targetVersionCode),
    String(patch.patchFile),
    String(patch.patchUrl),
    String(patch.patchSha256 ?? ""),
    Number(patch.patchSize ?? 0),
  );
}

export function deletePatch(appId, fromVersionCode, targetVersionCode) {
  db.prepare("DELETE FROM patches WHERE app_id = ? AND from_version_code = ? AND target_version_code = ?")
    .run(appId, Number(fromVersionCode), Number(targetVersionCode));
}

// ─── Stats Tracking ──────────────────────────────────────────────────────────

export function recordAppCheck(appId) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare("UPDATE apps SET check_count = check_count + 1 WHERE app_id = ?").run(appId);
    db.prepare(`
      INSERT INTO app_daily_stats (app_id, date, check_count)
      VALUES (?, ?, 1)
      ON CONFLICT(app_id, date) DO UPDATE SET check_count = check_count + 1
    `).run(appId, today);
  } catch (err) {
    console.warn(`[storageAdapter] recordAppCheck error for ${appId}:`, err.message);
  }
}

export function recordReleaseDownload(appId, filename) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare("UPDATE apps SET download_count = download_count + 1 WHERE app_id = ?").run(appId);
    db.prepare(`
      INSERT INTO app_daily_stats (app_id, date, full_download_count)
      VALUES (?, ?, 1)
      ON CONFLICT(app_id, date) DO UPDATE SET full_download_count = full_download_count + 1
    `).run(appId, today);

    let vCode = null;
    const match = String(filename).match(/^release-v(\d+)\./i);
    if (match) {
      vCode = Number(match[1]);
    } else if (/^latest\./i.test(filename)) {
      const latest = getLatestVersion(appId);
      if (latest) vCode = Number(latest.version_code);
    }

    if (vCode) {
      db.prepare("UPDATE versions SET download_count = download_count + 1 WHERE app_id = ? AND version_code = ?").run(appId, vCode);
    }
  } catch (err) {
    console.warn(`[storageAdapter] recordReleaseDownload error for ${appId}/${filename}:`, err.message);
  }
}

export function recordPatchDownload(appId, filename) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare("UPDATE apps SET download_count = download_count + 1 WHERE app_id = ?").run(appId);
    db.prepare(`
      INSERT INTO app_daily_stats (app_id, date, patch_download_count)
      VALUES (?, ?, 1)
      ON CONFLICT(app_id, date) DO UPDATE SET patch_download_count = patch_download_count + 1
    `).run(appId, today);

    const match = String(filename).match(/^patch-v(\d+)-to-v(\d+)\.patch$/i);
    if (match) {
      const fromCode = Number(match[1]);
      const targetCode = Number(match[2]);
      db.prepare(`
        UPDATE patches 
        SET download_count = download_count + 1 
        WHERE app_id = ? AND from_version_code = ? AND target_version_code = ?
      `).run(appId, fromCode, targetCode);
    }
  } catch (err) {
    console.warn(`[storageAdapter] recordPatchDownload error for ${appId}/${filename}:`, err.message);
  }
}

export function getAppStats(appId) {
  const app = getApp(appId);
  if (!app) return null;
  const today = new Date().toISOString().slice(0, 10);

  const todayRow = db.prepare(`
    SELECT * FROM app_daily_stats WHERE app_id = ? AND date = ?
  `).get(appId, today) || { check_count: 0, full_download_count: 0, patch_download_count: 0 };

  const totals = db.prepare(`
    SELECT 
      SUM(full_download_count) as total_full_downloads,
      SUM(patch_download_count) as total_patch_downloads
    FROM app_daily_stats WHERE app_id = ?
  `).get(appId);

  const recentDays = db.prepare(`
    SELECT date, check_count, full_download_count, patch_download_count,
      (full_download_count + patch_download_count) as total_downloads
    FROM app_daily_stats 
    WHERE app_id = ? AND date >= date('now', '-6 days')
    ORDER BY date ASC
  `).all(appId);

  const devStats = getAppDeviceStats(appId);
  const versionCoverage = getVersionCoverage(appId);

  return {
    appId,
    totalChecks: Number(app.check_count || 0),
    totalDownloads: Number(app.download_count || 0),
    todayChecks: Number(todayRow.check_count || 0),
    todayDownloads: Number((todayRow.full_download_count || 0) + (todayRow.patch_download_count || 0)),
    totalFullDownloads: Number(totals?.total_full_downloads || 0),
    totalPatchDownloads: Number(totals?.total_patch_downloads || 0),
    totalDevices: devStats.totalDevices,
    todayDevices: devStats.todayDevices,
    versionCoverage,
    recentDays,
  };
}

export function getGlobalStats() {
  const today = new Date().toISOString().slice(0, 10);

  const appAgg = db.prepare(`
    SELECT 
      COUNT(*) as total_apps,
      SUM(CASE WHEN auto_sync = 1 THEN 1 ELSE 0 END) as auto_sync_apps,
      SUM(check_count) as total_checks,
      SUM(download_count) as total_downloads
    FROM apps
  `).get();

  const todayAgg = db.prepare(`
    SELECT 
      SUM(check_count) as today_checks,
      SUM(full_download_count + patch_download_count) as today_downloads,
      SUM(full_download_count) as today_full_downloads,
      SUM(patch_download_count) as today_patch_downloads
    FROM app_daily_stats
    WHERE date = ?
  `).get(today);

  const devAgg = getGlobalDeviceStats();

  return {
    totalApps: Number(appAgg?.total_apps || 0),
    autoSyncApps: Number(appAgg?.auto_sync_apps || 0),
    totalChecks: Number(appAgg?.total_checks || 0),
    totalDownloads: Number(appAgg?.total_downloads || 0),
    todayChecks: Number(todayAgg?.today_checks || 0),
    todayDownloads: Number(todayAgg?.today_downloads || 0),
    todayFullDownloads: Number(todayAgg?.today_full_downloads || 0),
    todayPatchDownloads: Number(todayAgg?.today_patch_downloads || 0),
    totalDevices: devAgg.totalDevices,
    todayDevices: devAgg.todayDevices,
  };
}

// ─── Device Tracking ─────────────────────────────────────────────────────────

export function recordDeviceActive(appId, deviceId, { platform = "", versionCode = null } = {}) {
  if (!appId || !deviceId) return;
  const devId = String(deviceId).trim();
  if (!devId) return;

  db.prepare(`
    INSERT INTO app_devices (app_id, device_id, platform, current_version_code, last_seen_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(app_id, device_id) DO UPDATE SET
      platform = CASE WHEN ? != '' THEN ? ELSE platform END,
      current_version_code = CASE WHEN ? IS NOT NULL THEN ? ELSE current_version_code END,
      last_seen_at = datetime('now')
  `).run(
    appId,
    devId,
    platform,
    versionCode,
    platform,
    platform,
    versionCode,
    versionCode
  );
}

export function getAppDeviceStats(appId) {
  const row = db.prepare(`
    SELECT 
      COUNT(*) as total_devices,
      SUM(CASE WHEN date(last_seen_at) = date('now') THEN 1 ELSE 0 END) as today_devices
    FROM app_devices
    WHERE app_id = ?
  `).get(appId);

  return {
    totalDevices: Number(row?.total_devices || 0),
    todayDevices: Number(row?.today_devices || 0),
  };
}

export function getGlobalDeviceStats() {
  const row = db.prepare(`
    SELECT 
      COUNT(DISTINCT device_id) as total_devices,
      COUNT(DISTINCT CASE WHEN date(last_seen_at) = date('now') THEN device_id ELSE NULL END) as today_devices
    FROM app_devices
  `).get();

  return {
    totalDevices: Number(row?.total_devices || 0),
    todayDevices: Number(row?.today_devices || 0),
  };
}

export function getVersionCoverage(appId) {
  const rows = db.prepare(`
    SELECT 
      current_version_code,
      COUNT(*) as device_count
    FROM app_devices
    WHERE app_id = ? AND current_version_code IS NOT NULL
    GROUP BY current_version_code
    ORDER BY current_version_code DESC
  `).all(appId);

  const total = rows.reduce((acc, r) => acc + Number(r.device_count || 0), 0);
  const versions = db.prepare("SELECT version_code, version_name, is_latest FROM versions WHERE app_id = ?").all(appId);
  const verMap = new Map(versions.map((v) => [Number(v.version_code), v]));

  return rows.map((r) => {
    const vCode = Number(r.current_version_code);
    const ver = verMap.get(vCode);
    const count = Number(r.device_count || 0);
    const percentage = total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0;

    return {
      versionCode: vCode,
      versionName: ver ? ver.version_name : `代码: ${vCode}`,
      isLatest: ver ? ver.is_latest === 1 : false,
      deviceCount: count,
      percentage,
    };
  });
}

// ─── Version Rollback ────────────────────────────────────────────────────────

export function rollbackVersionToLatest(appId, targetVersionCode) {
  const vCode = Number(targetVersionCode);
  const targetVer = getVersion(appId, vCode);
  if (!targetVer) throw new Error(`目标版本 ${vCode} 不存在`);

  const runTx = db.transaction(() => {
    db.prepare("UPDATE versions SET is_latest = 0 WHERE app_id = ?").run(appId);
    db.prepare("UPDATE versions SET is_latest = 1 WHERE app_id = ? AND version_code = ?").run(appId, vCode);
  });
  runTx();

  return getVersion(appId, vCode);
}

// ─── App Config Batch Export / Import ────────────────────────────────────────

export function exportAllAppsConfig() {
  const rows = db.prepare(`
    SELECT 
      app_id, name, platform, github_repo, github_api_url, 
      auto_sync, auto_sync_interval_minutes, asset_pattern, 
      patch_readiness_policy, is_private, client_token, 
      max_retained_versions, webhook_url, webhook_type
    FROM apps
    ORDER BY created_at ASC
  `).all();

  return rows.map((r) => ({
    appId: r.app_id,
    name: r.name,
    platform: r.platform,
    githubRepo: r.github_repo,
    githubApiUrl: r.github_api_url,
    autoSync: r.auto_sync === 1,
    autoSyncIntervalMinutes: Number(r.auto_sync_interval_minutes || 60),
    assetPattern: r.asset_pattern || "",
    patchReadinessPolicy: r.patch_readiness_policy || "hide_download_link",
    isPrivate: r.is_private === 1,
    clientToken: r.client_token || "",
    maxRetainedVersions: Number(r.max_retained_versions || 0),
    webhookUrl: r.webhook_url || "",
    webhookType: r.webhook_type || "generic",
  }));
}

export function importAppsConfig(appsList) {
  if (!Array.isArray(appsList)) throw new Error("导入内容必须是 App 配置数组");
  let createdCount = 0;
  let updatedCount = 0;
  const errors = [];

  for (const item of appsList) {
    if (!item.appId || !item.name) {
      errors.push({ appId: item.appId || "unknown", error: "appId 和 name 不能为空" });
      continue;
    }
    try {
      const existing = getApp(item.appId);
      if (existing) {
        updateApp(item.appId, {
          name: item.name,
          platform: item.platform || existing.platform,
          github_repo: item.githubRepo !== undefined ? item.githubRepo : existing.github_repo,
          github_api_url: item.githubApiUrl !== undefined ? item.githubApiUrl : existing.github_api_url,
          auto_sync: item.autoSync !== undefined ? item.autoSync : existing.auto_sync === 1,
          auto_sync_interval_minutes: item.autoSyncIntervalMinutes !== undefined ? item.autoSyncIntervalMinutes : existing.auto_sync_interval_minutes,
          asset_pattern: item.assetPattern !== undefined ? item.assetPattern : existing.asset_pattern,
          patch_readiness_policy: item.patchReadinessPolicy !== undefined ? item.patchReadinessPolicy : existing.patch_readiness_policy,
          is_private: item.isPrivate !== undefined ? item.isPrivate : existing.is_private === 1,
          client_token: item.clientToken !== undefined ? item.clientToken : existing.client_token,
          max_retained_versions: item.maxRetainedVersions !== undefined ? item.maxRetainedVersions : existing.max_retained_versions,
          webhook_url: item.webhookUrl !== undefined ? item.webhookUrl : existing.webhook_url,
          webhook_type: item.webhookType !== undefined ? item.webhookType : existing.webhook_type,
        });
        updatedCount++;
      } else {
        insertApp({
          appId: item.appId,
          name: item.name,
          platform: item.platform || "android",
          githubRepo: item.githubRepo || "",
          githubApiUrl: item.githubApiUrl || "https://api.github.com",
          autoSync: Boolean(item.autoSync),
          autoSyncIntervalMinutes: Number(item.autoSyncIntervalMinutes) || 60,
          assetPattern: item.assetPattern || "",
          patchReadinessPolicy: item.patchReadinessPolicy || "hide_download_link",
          isPrivate: Boolean(item.isPrivate),
          clientToken: item.clientToken || "",
          maxRetainedVersions: Number(item.maxRetainedVersions) || 0,
          webhookUrl: item.webhookUrl || "",
          webhookType: item.webhookType || "generic",
        });
        createdCount++;
      }
    } catch (err) {
      errors.push({ appId: item.appId, error: err.message });
    }
  }

  return { total: appsList.length, createdCount, updatedCount, errors };
}

