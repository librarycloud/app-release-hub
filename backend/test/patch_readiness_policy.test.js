import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { config } from "../src/config.js";
import { initSchema } from "../src/db/schema.js";
import publicRoutes from "../src/routes/publicRoutes.js";
import adminRoutes from "../src/routes/adminRoutes.js";
import {
  insertApp,
  deleteApp,
  upsertVersion,
  upsertPatch,
  getApp,
} from "../src/services/storageAdapter.js";

const TEST_API_KEY = "test-policy-secret-key";
const TEST_APP_ID = "test-policy-app";

describe("Patch Readiness Policy Tests", () => {
  let app;

  beforeAll(async () => {
    config.adminApiKey = TEST_API_KEY;
    initSchema();

    deleteApp(TEST_APP_ID);

    insertApp({
      appId: TEST_APP_ID,
      name: "Policy Test App",
      platform: "android",
      patchReadinessPolicy: "hide_download_link",
    });

    const releaseDir = path.join(config.filesDir, TEST_APP_ID, "releases");
    const patchDir = path.join(config.filesDir, TEST_APP_ID, "patches");
    await mkdir(releaseDir, { recursive: true });
    await mkdir(patchDir, { recursive: true });

    await writeFile(path.join(releaseDir, "release-v100.apk"), "apk-100-content");
    await writeFile(path.join(releaseDir, "release-v101.apk"), "apk-101-content");
    await writeFile(path.join(releaseDir, "release-v102.apk"), "apk-102-content");
    await writeFile(path.join(releaseDir, "latest.apk"), "apk-102-content");

    upsertVersion(TEST_APP_ID, {
      versionCode: 100,
      versionName: "v1.0.0",
      releaseNotes: ["Release 1.0.0"],
      fileUrl: `/api/apps/${TEST_APP_ID}/releases/release-v100.apk`,
      sha256: "sha-100",
      size: 1000,
    });

    upsertVersion(TEST_APP_ID, {
      versionCode: 101,
      versionName: "v1.0.1",
      releaseNotes: ["Release 1.0.1"],
      fileUrl: `/api/apps/${TEST_APP_ID}/releases/release-v101.apk`,
      sha256: "sha-101",
      size: 1100,
    });

    upsertVersion(TEST_APP_ID, {
      versionCode: 102,
      versionName: "v1.0.2",
      releaseNotes: ["Release 1.0.2"],
      fileUrl: `/api/apps/${TEST_APP_ID}/releases/release-v102.apk`,
      sha256: "sha-102",
      size: 1200,
      isLatest: true,
    });

    app = Fastify();
    await app.register(publicRoutes);
    await app.register(adminRoutes);
    await app.ready();
  });

  afterAll(async () => {
    deleteApp(TEST_APP_ID);
    await app.close();
  });

  it("should return pending state without download links when patch is not ready under default hide_download_link policy", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version?versionCode=101`,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.code).toBe(0);
    expect(json.data.hasUpdate).toBe(true);
    expect(json.data.patchReady).toBe(false);
    expect(json.data.updateType).toBe("pending");
    expect(json.data.versionCode).toBe(102);
    expect(json.data.versionName).toBe("v1.0.2");
    // Download URLs must be null/omitted
    expect(json.data.downloadUrl).toBeNull();
    expect(json.data.patchUrl).toBeNull();
    expect(json.data.fallbackUrl).toBeNull();
    expect(json.data.message).toContain("差分包");
  });

  it("should return hasUpdate: false under silent policy when patch is not ready", async () => {
    // Override via query parameter ?policy=silent
    const res = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version?versionCode=101&policy=silent`,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.code).toBe(0);
    expect(json.data.hasUpdate).toBe(false);
    expect(json.data.patchReady).toBe(false);
    expect(json.data.downloadUrl).toBeNull();
    expect(json.data.patchUrl).toBeNull();
  });

  it("should return full package under fallback_full policy when patch is not ready", async () => {
    // Override via query parameter ?policy=fallback_full
    const res = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version?versionCode=101&policy=fallback_full`,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.code).toBe(0);
    expect(json.data.hasUpdate).toBe(true);
    expect(json.data.updateType).toBe("full");
    expect(json.data.downloadUrl).toContain("release-v102.apk");
  });

  it("should return incremental patchUrl once patch is ready", async () => {
    // Simulate patch generated and inserted
    upsertPatch(TEST_APP_ID, {
      fromVersionCode: 101,
      targetVersionCode: 102,
      patchFile: "patch-v101-to-v102.patch",
      patchUrl: `/api/apps/${TEST_APP_ID}/patches/patch-v101-to-v102.patch`,
      patchSha256: "sha-patch-101-102",
      patchSize: 150,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version?versionCode=101`,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.code).toBe(0);
    expect(json.data.hasUpdate).toBe(true);
    expect(json.data.patchReady).toBe(true);
    expect(json.data.updateType).toBe("incremental");
    expect(json.data.patchUrl).toContain("patch-v101-to-v102.patch");
    expect(json.data.patchSha256).toBe("sha-patch-101-102");
    expect(json.data.fallbackUrl).toContain("release-v102.apk");
  });

  it("should update app configuration with patchReadinessPolicy via admin API", async () => {
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/admin/apps/${TEST_APP_ID}`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: {
        patchReadinessPolicy: "silent",
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const patchedJson = patchRes.json();
    expect(patchedJson.data.patchReadinessPolicy).toBe("silent");

    // Check version 100 which does NOT have a patch to 102
    const res = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version?versionCode=100`,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    // App's saved policy is now 'silent'
    expect(json.data.hasUpdate).toBe(false);
    expect(json.data.patchReady).toBe(false);
  });

  it("should always return full update for new installs without versionCode", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version`,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.code).toBe(0);
    expect(json.data.hasUpdate).toBe(true);
    expect(json.data.updateType).toBe("full");
    expect(json.data.downloadUrl).toContain("release-v102.apk");
  });
});
