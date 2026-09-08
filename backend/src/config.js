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
  // New configurations
  enableNginxAccel: process.env.ENABLE_NGINX_ACCEL === "true",
  nginxInternalPathPrefix: process.env.NGINX_INTERNAL_PATH_PREFIX || "/internal-files",
  maxConcurrentBsdiff: Math.max(1, Number(process.env.MAX_CONCURRENT_BSDIFF) || 2),
  rateLimitPublic: Number(process.env.RATE_LIMIT_PUBLIC) || 60,
  rateLimitDownloads: Number(process.env.RATE_LIMIT_DOWNLOADS) || 30,
  // Storage
  storageType: process.env.STORAGE_TYPE || "local",
  s3: {
    endpoint: process.env.S3_ENDPOINT || "",
    region: process.env.S3_REGION || "auto",
    bucket: process.env.S3_BUCKET || "",
    accessKey: process.env.S3_ACCESS_KEY || "",
    secretKey: process.env.S3_SECRET_KEY || "",
    publicDomain: (process.env.S3_PUBLIC_DOMAIN || "").trim().replace(/\/+$/, ""),
  },
};
