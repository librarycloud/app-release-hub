import { db } from "../db/index.js";

// ─── Apps ────────────────────────────────────────────────────────────────────

export function listApps() {
  return db.prepare("SELECT * FROM apps ORDER BY created_at DESC").all();
}

export function getApp(appId) {
  return db.prepare("SELECT * FROM apps WHERE app_id = ?").get(appId) || null;
}

export function insertApp({ appId, name, platform = "android", githubRepo = "", githubApiUrl = "https://api.github.com", autoSync = false }) {
  db.prepare(`
    INSERT INTO apps (app_id, name, platform, github_repo, github_api_url, auto_sync)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(appId, name, platform, githubRepo, githubApiUrl, autoSync ? 1 : 0);
}

export function getAutoSyncApps() {
  return db.prepare("SELECT * FROM apps WHERE auto_sync = 1 AND github_repo != ''").all();
}

export function updateApp(appId, fields) {
  const allowed = ["name", "platform", "github_repo", "github_api_url", "auto_sync", "last_synced_at", "last_sync_error"];
  const updates = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      updates.push(`${k} = ?`);
      values.push(k === "auto_sync" ? (v ? 1 : 0) : v);
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
  return db.prepare("SELECT * FROM versions WHERE app_id = ? ORDER BY version_code DESC").all();
}

export function getVersion(appId, versionCode) {
  return db.prepare("SELECT * FROM versions WHERE app_id = ? AND version_code = ?").get(appId, Number(versionCode)) || null;
}

export function upsertVersion(appId, ver) {
  // Atomically: clear previous latest flag if this is latest, then upsert
  const upsert = db.transaction(() => {
    if (ver.isLatest) {
      db.prepare("UPDATE versions SET is_latest = 0 WHERE app_id = ?").run(appId);
    }
    db.prepare(`
      INSERT INTO versions (app_id, version_code, version_name, min_version_code, force_update,
        release_notes, changelog_url, published_at, file_url, sha256, size, is_latest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        is_latest        = excluded.is_latest
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
    );
  });
  upsert();
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
