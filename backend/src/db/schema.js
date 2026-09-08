import { db } from "./index.js";

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      app_id         TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      platform       TEXT NOT NULL DEFAULT 'android',
      github_repo    TEXT NOT NULL DEFAULT '',
      github_api_url TEXT NOT NULL DEFAULT 'https://api.github.com',
      auto_sync      INTEGER NOT NULL DEFAULT 0,
      auto_sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
      asset_pattern  TEXT NOT NULL DEFAULT '',
      last_synced_at TEXT,
      last_sync_error TEXT,
      check_count    INTEGER NOT NULL DEFAULT 0,
      download_count INTEGER NOT NULL DEFAULT 0,
      patch_readiness_policy TEXT NOT NULL DEFAULT 'hide_download_link',
      is_private     INTEGER NOT NULL DEFAULT 0,
      client_token   TEXT NOT NULL DEFAULT '',
      max_retained_versions INTEGER NOT NULL DEFAULT 0,
      webhook_url    TEXT NOT NULL DEFAULT '',
      webhook_type   TEXT NOT NULL DEFAULT 'generic',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS versions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id           TEXT NOT NULL,
      version_code     INTEGER NOT NULL,
      version_name     TEXT NOT NULL,
      min_version_code INTEGER NOT NULL DEFAULT 1,
      force_update     INTEGER NOT NULL DEFAULT 0,
      release_notes    TEXT NOT NULL DEFAULT '[]',
      changelog_url    TEXT NOT NULL DEFAULT '',
      published_at     TEXT NOT NULL DEFAULT '',
      file_url         TEXT NOT NULL DEFAULT '',
      sha256           TEXT NOT NULL DEFAULT '',
      size             INTEGER NOT NULL DEFAULT 0,
      download_count   INTEGER NOT NULL DEFAULT 0,
      is_latest        INTEGER NOT NULL DEFAULT 0,
      rollout_percentage INTEGER NOT NULL DEFAULT 100,
      channel          TEXT NOT NULL DEFAULT 'stable',
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(app_id, version_code),
      FOREIGN KEY(app_id) REFERENCES apps(app_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS patches (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id              TEXT NOT NULL,
      from_version_code   INTEGER NOT NULL,
      target_version_code INTEGER NOT NULL,
      patch_file          TEXT NOT NULL,
      patch_url           TEXT NOT NULL,
      patch_sha256        TEXT NOT NULL DEFAULT '',
      patch_size          INTEGER NOT NULL DEFAULT 0,
      download_count      INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(app_id, from_version_code, target_version_code),
      FOREIGN KEY(app_id) REFERENCES apps(app_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_daily_stats (
      app_id               TEXT NOT NULL,
      date                 TEXT NOT NULL,
      check_count          INTEGER NOT NULL DEFAULT 0,
      full_download_count  INTEGER NOT NULL DEFAULT 0,
      patch_download_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(app_id, date),
      FOREIGN KEY(app_id) REFERENCES apps(app_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_versions_app_id ON versions(app_id);
    CREATE INDEX IF NOT EXISTS idx_versions_latest ON versions(app_id, is_latest);
    CREATE INDEX IF NOT EXISTS idx_patches_app_target ON patches(app_id, target_version_code);
    CREATE INDEX IF NOT EXISTS idx_patches_lookup ON patches(app_id, from_version_code, target_version_code);
    CREATE INDEX IF NOT EXISTS idx_daily_stats_app_date ON app_daily_stats(app_id, date);
  `);

  // Migrate existing tables if missing new columns
  const columns = db.prepare("PRAGMA table_info(apps)").all().map((c) => c.name);
  if (!columns.includes("last_synced_at")) {
    db.exec("ALTER TABLE apps ADD COLUMN last_synced_at TEXT");
  }
  if (!columns.includes("last_sync_error")) {
    db.exec("ALTER TABLE apps ADD COLUMN last_sync_error TEXT");
  }
  if (!columns.includes("asset_pattern")) {
    db.exec("ALTER TABLE apps ADD COLUMN asset_pattern TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.includes("auto_sync_interval_minutes")) {
    db.exec("ALTER TABLE apps ADD COLUMN auto_sync_interval_minutes INTEGER NOT NULL DEFAULT 60");
  }
  if (!columns.includes("check_count")) {
    db.exec("ALTER TABLE apps ADD COLUMN check_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.includes("download_count")) {
    db.exec("ALTER TABLE apps ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.includes("patch_readiness_policy")) {
    db.exec("ALTER TABLE apps ADD COLUMN patch_readiness_policy TEXT NOT NULL DEFAULT 'hide_download_link'");
  }
  if (!columns.includes("is_private")) {
    db.exec("ALTER TABLE apps ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.includes("client_token")) {
    db.exec("ALTER TABLE apps ADD COLUMN client_token TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.includes("max_retained_versions")) {
    db.exec("ALTER TABLE apps ADD COLUMN max_retained_versions INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.includes("webhook_url")) {
    db.exec("ALTER TABLE apps ADD COLUMN webhook_url TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.includes("webhook_type")) {
    db.exec("ALTER TABLE apps ADD COLUMN webhook_type TEXT NOT NULL DEFAULT 'generic'");
  }

  const versionColumns = db.prepare("PRAGMA table_info(versions)").all().map((c) => c.name);
  if (!versionColumns.includes("download_count")) {
    db.exec("ALTER TABLE versions ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!versionColumns.includes("rollout_percentage")) {
    db.exec("ALTER TABLE versions ADD COLUMN rollout_percentage INTEGER NOT NULL DEFAULT 100");
  }
  if (!versionColumns.includes("channel")) {
    db.exec("ALTER TABLE versions ADD COLUMN channel TEXT NOT NULL DEFAULT 'stable'");
  }

  const patchColumns = db.prepare("PRAGMA table_info(patches)").all().map((c) => c.name);
  if (!patchColumns.includes("download_count")) {
    db.exec("ALTER TABLE patches ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0");
  }
}
