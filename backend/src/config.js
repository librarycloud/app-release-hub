import dotenv from "dotenv";
dotenv.config();

/**
 * Resolve GitHub token for a given appId.
 * Env var naming: GITHUB_TOKEN_{APPID_UPPERCASE_UNDERSCORED}
 * e.g. appId "android-main" → GITHUB_TOKEN_ANDROID_MAIN
 */
function resolveGithubToken(appId) {
  if (!appId) return "";
  const key = `GITHUB_TOKEN_${appId.toUpperCase().replace(/-/g, "_")}`;
  return (process.env[key] || process.env.GITHUB_TOKEN || "").trim();
}

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",
  adminApiKey: (process.env.ADMIN_API_KEY || "").trim().replace(/^["']|["']$/g, ""),
  dbPath: process.env.DB_PATH || "data/hub.db",
  filesDir: process.env.FILES_DIR || "data/files",
  // Optional CDN/download base URL override for served files
  downloadBaseUrl: (process.env.DOWNLOAD_BASE_URL || "").trim().replace(/\/+$/, ""),
  // Periodic background check interval in minutes (default 60 min, 0 to disable)
  autoSyncIntervalMinutes: Number(process.env.AUTO_SYNC_INTERVAL_MINUTES || 60),
  resolveGithubToken,
};
