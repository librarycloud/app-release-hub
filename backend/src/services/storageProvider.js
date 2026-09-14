import { createReadStream, createWriteStream } from "node:fs";
import { stat, mkdir, rm, copyFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

let s3Client = null;
if (config.storageType === "s3") {
  s3Client = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: {
      accessKeyId: config.s3.accessKey,
      secretAccessKey: config.s3.secretKey,
    },
    // Force path style for MinIO / compatible layers
    forcePathStyle: true,
  });
}

import {
  getSafeAppDir,
  getSafeFilePath,
  assertSafeLocalPath,
  sanitizeAppId,
  sanitizeSubDir,
  sanitizeFilename,
} from "../utils/pathSecurity.js";

function getAppFilesDir(appId) {
  return getSafeAppDir(appId);
}

/**
 * Ensures the target local directory exists.
 */
async function ensureLocalDir(appId, subDir) {
  const dir = getSafeFilePath(appId, subDir);
  await mkdir(dir, { recursive: true });
  return dir;
}

import { Upload } from "@aws-sdk/lib-storage";

const MIME_TYPES = {
  ".apk": "application/vnd.android.package-archive",
  ".aab": "application/octet-stream",
  ".wgt": "application/widget",
  ".zip": "application/zip",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".msi": "application/x-msi",
  ".dmg": "application/x-apple-diskimage",
  ".pkg": "application/octet-stream",
  ".ipa": "application/octet-stream",
  ".appimage": "application/octet-stream",
  ".deb": "application/vnd.debian.binary-package",
  ".patch": "application/octet-stream",
};

export async function saveFile(appId, subDir, filename, sourceFilePath) {
  const safeAppId = sanitizeAppId(appId);
  const safeSubDir = sanitizeSubDir(subDir);
  const safeFilename = sanitizeFilename(filename);
  const safeSource = assertSafeLocalPath(sourceFilePath);

  if (config.storageType === "s3") {
    const key = `apps/${safeAppId}/${safeSubDir}/${safeFilename}`;
    const fileStream = createReadStream(safeSource);
    const ext = path.extname(safeFilename).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: config.s3.bucket,
        Key: key,
        Body: fileStream,
        ContentType: contentType,
      },
      queueSize: 4,
      partSize: 10 * 1024 * 1024, // 10MB
    });
    
    await upload.done();
    return key;
  } else {
    const targetPath = getSafeFilePath(safeAppId, safeSubDir, safeFilename);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(safeSource, targetPath);
    return targetPath;
  }
}

export async function deleteFile(appId, subDir, filenameOrKey) {
  const safeAppId = sanitizeAppId(appId);
  const safeSubDir = sanitizeSubDir(subDir);
  if (config.storageType === "s3") {
    let key = String(filenameOrKey || "");
    if (!key.startsWith("apps/")) {
      key = `apps/${safeAppId}/${safeSubDir}/${sanitizeFilename(filenameOrKey)}`;
    }
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
      })
    ).catch(() => {});
  } else {
    const safeFn = sanitizeFilename(filenameOrKey);
    const targetPath = getSafeFilePath(safeAppId, safeSubDir, safeFn);
    await rm(targetPath, { force: true }).catch(() => {});
  }
}

export async function getFileMeta(appId, subDir, filenameOrKey) {
  const safeAppId = sanitizeAppId(appId);
  const safeSubDir = sanitizeSubDir(subDir);
  if (config.storageType === "s3") {
    let key = String(filenameOrKey || "");
    if (!key.startsWith("apps/")) {
      key = `apps/${safeAppId}/${safeSubDir}/${sanitizeFilename(filenameOrKey)}`;
    }
    try {
      const head = await s3Client.send(
        new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key })
      );
      return { exists: true, size: head.ContentLength, isS3: true, key };
    } catch (err) {
      return { exists: false, isS3: true, key };
    }
  } else {
    const safeFn = sanitizeFilename(filenameOrKey);
    const targetPath = getSafeFilePath(safeAppId, safeSubDir, safeFn);
    try {
      const s = await stat(targetPath);
      return { exists: s.isFile(), size: s.size, isS3: false, path: targetPath };
    } catch {
      return { exists: false, isS3: false, path: targetPath };
    }
  }
}

export async function getDownloadUrl(appId, subDir, filenameOrKey, isPrivate = false) {
  const safeAppId = sanitizeAppId(appId);
  const safeSubDir = sanitizeSubDir(subDir);
  const safeFn = sanitizeFilename(filenameOrKey);
  if (config.storageType === "s3") {
    let key = String(filenameOrKey || "");
    if (!key.startsWith("apps/")) {
      key = `apps/${safeAppId}/${safeSubDir}/${safeFn}`;
    }
    if (!isPrivate && config.s3.publicDomain) {
      return `${config.s3.publicDomain}/${key}`;
    }
    // Generate pre-signed URL (15 minutes)
    const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key });
    return await getSignedUrl(s3Client, command, { expiresIn: 900 });
  } else {
    return `/api/apps/${safeAppId}/${safeSubDir}/${safeFn}`;
  }
}

/**
 * For Bsdiff, we need the actual file on disk. If S3, we download it to a temp path.
 * The caller is responsible for deleting the temp path after use.
 */
export async function ensureLocalFilePath(appId, subDir, filenameOrKey) {
  const safeAppId = sanitizeAppId(appId);
  const safeSubDir = sanitizeSubDir(subDir);
  const safeFn = sanitizeFilename(filenameOrKey);
  if (config.storageType === "s3") {
    let key = String(filenameOrKey || "");
    if (!key.startsWith("apps/")) {
      key = `apps/${safeAppId}/${safeSubDir}/${safeFn}`;
    }
    const { exists } = await getFileMeta(safeAppId, safeSubDir, key);
    if (!exists) throw new Error(`文件在 S3 中不存在: ${key}`);
    
    const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key });
    const response = await s3Client.send(command);
    
    const tmpPath = getSafeFilePath(safeAppId, "tmp", `dl-${Date.now()}-${safeFn}`);
    await mkdir(path.dirname(tmpPath), { recursive: true });
    await pipeline(response.Body, createWriteStream(tmpPath));
    return { path: tmpPath, isTemp: true };
  } else {
    const targetPath = getSafeFilePath(safeAppId, safeSubDir, safeFn);
    return { path: targetPath, isTemp: false };
  }
}
