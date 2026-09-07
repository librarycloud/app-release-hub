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
  getVersionHistory,
  getAppStats,
  getGlobalStats,
} from "../src/services/storageAdapter.js";

const TEST_API_KEY = "test-secret-key";
const TEST_APP_ID = "test-stats-app";

describe("Download & Check Stats Tests", () => {
  let app;

  beforeAll(async () => {
    config.adminApiKey = TEST_API_KEY;
    initSchema();

    deleteApp(TEST_APP_ID);

    insertApp({
      appId: TEST_APP_ID,
      name: "Stats Test App",
      platform: "android",
    });

    const releaseDir = path.join(config.filesDir, TEST_APP_ID, "releases");
    const patchDir = path.join(config.filesDir, TEST_APP_ID, "patches");
    await mkdir(releaseDir, { recursive: true });
    await mkdir(patchDir, { recursive: true });

    await writeFile(path.join(releaseDir, "release-v100.apk"), "apk-100-content");
    await writeFile(path.join(releaseDir, "release-v101.apk"), "apk-101-content");
    await writeFile(path.join(releaseDir, "latest.apk"), "apk-101-content");
    await writeFile(path.join(patchDir, "patch-v100-to-v101.patch"), "patch-100-101-content");

    upsertVersion(TEST_APP_ID, {
      versionCode: 100,
      versionName: "v1.0.0",
      releaseNotes: ["First release"],
      fileUrl: `/api/apps/${TEST_APP_ID}/releases/release-v100.apk`,
      sha256: "dummy-sha-100",
      size: 1000,
    });

    upsertVersion(TEST_APP_ID, {
      versionCode: 101,
      versionName: "v1.0.1",
      releaseNotes: ["Second release"],
      fileUrl: `/api/apps/${TEST_APP_ID}/releases/release-v101.apk`,
      sha256: "dummy-sha-101",
      size: 1100,
      isLatest: true,
    });

    upsertPatch(TEST_APP_ID, {
      fromVersionCode: 100,
      targetVersionCode: 101,
      patchFile: "patch-v100-to-v101.patch",
      patchUrl: `/api/apps/${TEST_APP_ID}/patches/patch-v100-to-v101.patch`,
      patchSha256: "dummy-patch-sha",
      patchSize: 200,
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

  it("should record app check count on client version request", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version`,
    });
    expect(res.statusCode).toBe(200);

    const appRow = getApp(TEST_APP_ID);
    expect(appRow.check_count).toBeGreaterThanOrEqual(1);

    const stats = getAppStats(TEST_APP_ID);
    expect(stats.totalChecks).toBeGreaterThanOrEqual(1);
    expect(stats.todayChecks).toBeGreaterThanOrEqual(1);
  });

  it("should record release download count on file serve", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/releases/release-v100.apk`,
    });
    expect(res.statusCode).toBe(200);

    const appRow = getApp(TEST_APP_ID);
    expect(appRow.download_count).toBeGreaterThanOrEqual(1);

    const versions = getVersionHistory(TEST_APP_ID);
    const v100 = versions.find((v) => Number(v.version_code) === 100);
    expect(v100.download_count).toBeGreaterThanOrEqual(1);
  });

  it("should record latest download count and attribute to latest version", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/releases/latest.apk`,
    });
    expect(res.statusCode).toBe(200);

    const versions = getVersionHistory(TEST_APP_ID);
    const v101 = versions.find((v) => Number(v.version_code) === 101);
    expect(v101.download_count).toBeGreaterThanOrEqual(1);
  });

  it("should record patch download count on patch file serve", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/patches/patch-v100-to-v101.patch`,
    });
    expect(res.statusCode).toBe(200);

    const stats = getAppStats(TEST_APP_ID);
    expect(stats.totalPatchDownloads).toBeGreaterThanOrEqual(1);
  });

  it("should return global stats overview via admin API", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/stats/overview",
      headers: { "x-api-key": TEST_API_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.code).toBe(0);
    expect(body.data.totalApps).toBeGreaterThanOrEqual(1);
    expect(body.data.totalChecks).toBeGreaterThanOrEqual(1);
    expect(body.data.totalDownloads).toBeGreaterThanOrEqual(2);
  });

  it("should return app stats via admin API", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/admin/apps/${TEST_APP_ID}/stats`,
      headers: { "x-api-key": TEST_API_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.code).toBe(0);
    expect(body.data.appId).toBe(TEST_APP_ID);
    expect(body.data.totalChecks).toBeGreaterThanOrEqual(1);
    expect(body.data.totalDownloads).toBeGreaterThanOrEqual(3);
    expect(body.data.recentDays).toBeInstanceOf(Array);
    expect(body.data.recentDays.length).toBeGreaterThanOrEqual(1);
  });
});
