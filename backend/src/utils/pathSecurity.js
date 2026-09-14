import path from "node:path";
import os from "node:os";
import { config } from "../config.js";

const SAFE_APP_ID_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9._-]+$/;
const ALLOWED_SUBDIRS = new Set(["releases", "patches", "uploads", "tmp"]);

/**
 * Validates that an appId is strictly alphanumeric with hyphens/underscores.
 * Throws an error if invalid or contains path traversal characters.
 */
export function sanitizeAppId(appId) {
  const str = String(appId || "").trim();
  if (!str || !SAFE_APP_ID_REGEX.test(str) || str.includes("..") || str.includes("/") || str.includes("\\")) {
    throw new Error(`非法应用标识 (appId): "${appId}"`);
  }
  return str;
}

/**
 * Validates that a filename contains only safe characters and no directory separators.
 */
export function sanitizeFilename(filename) {
  const str = String(filename || "").trim();
  if (!str || str.includes("/") || str.includes("\\") || str.includes("..")) {
    throw new Error(`非法文件名: "${filename}"`);
  }
  const bn = path.basename(str);
  if (!bn || bn === "." || bn === ".." || !SAFE_FILENAME_REGEX.test(bn) || bn.includes("..")) {
    throw new Error(`非法文件名: "${filename}"`);
  }
  return bn;
}

/**
 * Validates that a subdirectory is in the allowed whitelist.
 */
export function sanitizeSubDir(subDir) {
  const str = String(subDir || "").trim();
  if (!ALLOWED_SUBDIRS.has(str)) {
    throw new Error(`非法的存储子目录: "${subDir}"`);
  }
  return str;
}

/**
 * Returns a fully verified directory path for the given app.
 * Guarantees that the path is strictly contained within config.filesDir.
 */
export function getSafeAppDir(appId) {
  const safeId = sanitizeAppId(appId);
  const base = path.resolve(config.filesDir);
  const target = path.resolve(base, safeId);
  if (!target.startsWith(base + path.sep)) {
    throw new Error("检测到路径穿越尝试 (Path traversal detected)");
  }
  return target;
}

/**
 * Returns a fully verified file path within an app's designated subdirectory.
 * Guarantees that the path is strictly contained within config.filesDir/appId.
 */
export function getSafeFilePath(appId, subDir, filename) {
  const appDir = getSafeAppDir(appId);
  const safeSub = sanitizeSubDir(subDir);
  const safeFn = filename ? sanitizeFilename(filename) : "";
  const target = safeFn ? path.resolve(appDir, safeSub, safeFn) : path.resolve(appDir, safeSub);
  if (!target.startsWith(appDir + path.sep) && target !== appDir) {
    throw new Error("检测到路径穿越尝试 (Path traversal detected)");
  }
  return target;
}

/**
 * Asserts that a local file path is strictly contained within config.filesDir or os.tmpdir().
 */
export function assertSafeLocalPath(targetPath) {
  const resolved = path.resolve(String(targetPath || ""));
  const filesDirBase = path.resolve(config.filesDir);
  const tmpDirBase = path.resolve(os.tmpdir());
  if (
    !resolved.startsWith(filesDirBase + path.sep) &&
    resolved !== filesDirBase &&
    !resolved.startsWith(tmpDirBase + path.sep) &&
    resolved !== tmpDirBase
  ) {
    throw new Error("操作被拒绝: 目标文件路径超出允许的安全存储根目录");
  }
  return resolved;
}
