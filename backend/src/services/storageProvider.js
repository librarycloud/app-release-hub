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

function getAppFilesDir(appId) {
  return path.resolve(config.filesDir, appId);
}

/**
 * Ensures the target local directory exists.
 */
async function ensureLocalDir(appId, subDir) {
  const dir = path.join(getAppFilesDir(appId), subDir);
  await mkdir(dir, { recursive: true });
  return dir;
}

import { Upload } from "@aws-sdk/lib-storage";

export async function saveFile(appId, subDir, filename, sourceFilePath) {
  if (config.storageType === "s3") {
    const key = `apps/${appId}/${subDir}/${filename}`;
    const fileStream = createReadStream(sourceFilePath);
    const contentType = filename.endsWith(".patch") ? "application/octet-stream" : "application/vnd.android.package-archive";
    
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
    const dir = await ensureLocalDir(appId, subDir);
    const targetPath = path.join(dir, filename);
    await copyFile(sourceFilePath, targetPath);
    return targetPath;
  }
}

export async function deleteFile(appId, subDir, filenameOrKey) {
  if (config.storageType === "s3") {
    // filenameOrKey is the S3 key in this case
    let key = filenameOrKey;
    if (!key.startsWith("apps/")) {
      key = `apps/${appId}/${subDir}/${filenameOrKey}`;
    }
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
      })
    ).catch(() => {});
  } else {
    const targetPath = path.isAbsolute(filenameOrKey) 
      ? filenameOrKey 
      : path.join(getAppFilesDir(appId), subDir, filenameOrKey);
    await rm(targetPath, { force: true }).catch(() => {});
  }
}

export async function getFileMeta(appId, subDir, filenameOrKey) {
  if (config.storageType === "s3") {
    let key = filenameOrKey;
    if (!key.startsWith("apps/")) {
      key = `apps/${appId}/${subDir}/${filenameOrKey}`;
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
    const targetPath = path.isAbsolute(filenameOrKey) 
      ? filenameOrKey 
      : path.join(getAppFilesDir(appId), subDir, filenameOrKey);
    try {
      const s = await stat(targetPath);
      return { exists: s.isFile(), size: s.size, isS3: false, path: targetPath };
    } catch {
      return { exists: false, isS3: false, path: targetPath };
    }
  }
}

export async function getDownloadUrl(appId, subDir, filenameOrKey, isPrivate = false) {
  if (config.storageType === "s3") {
    let key = filenameOrKey;
    if (!key.startsWith("apps/")) {
      key = `apps/${appId}/${subDir}/${filenameOrKey}`;
    }
    if (!isPrivate && config.s3.publicDomain) {
      return `${config.s3.publicDomain}/${key}`;
    }
    // Generate pre-signed URL (15 minutes)
    const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key });
    return await getSignedUrl(s3Client, command, { expiresIn: 900 });
  } else {
    // If local, just return the API path
    const bn = path.basename(filenameOrKey);
    return `/api/apps/${appId}/${subDir}/${bn}`;
  }
}

/**
 * For Bsdiff, we need the actual file on disk. If S3, we download it to a temp path.
 * The caller is responsible for deleting the temp path after use.
 */
export async function ensureLocalFilePath(appId, subDir, filenameOrKey) {
  if (config.storageType === "s3") {
    let key = filenameOrKey;
    if (!key.startsWith("apps/")) {
      key = `apps/${appId}/${subDir}/${filenameOrKey}`;
    }
    const { exists } = await getFileMeta(appId, subDir, key);
    if (!exists) throw new Error(`文件在 S3 中不存在: ${key}`);
    
    const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key });
    const response = await s3Client.send(command);
    
    const tmpDir = await ensureLocalDir(appId, "tmp");
    const tmpPath = path.join(tmpDir, `dl-${Date.now()}-${path.basename(key)}`);
    
    await pipeline(response.Body, createWriteStream(tmpPath));
    return { path: tmpPath, isTemp: true };
  } else {
    const targetPath = path.isAbsolute(filenameOrKey) 
      ? filenameOrKey 
      : path.join(getAppFilesDir(appId), subDir, filenameOrKey);
    return { path: targetPath, isTemp: false };
  }
}
