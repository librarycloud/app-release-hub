import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { config } from "../src/config.js";
import { db } from "../src/db/index.js";
import { initSchema } from "../src/db/schema.js";
import publicRoutes from "../src/routes/publicRoutes.js";
import adminRoutes from "../src/routes/adminRoutes.js";
import { insertApp, deleteApp, upsertVersion, upsertPatch } from "../src/services/storageAdapter.js";

const TEST_API_KEY = "test-secret-key";
const TEST_APP_ID = "test-unit-app";

describe("Version Management & Force Update Tests", () => {
  let app;

  beforeAll(async () => {
    config.adminApiKey = TEST_API_KEY;
    initSchema();

    // Clean up if previous leftover
    deleteApp(TEST_APP_ID);

    // Register test app
    insertApp({
      appId: TEST_APP_ID,
      name: "Test Unit App",
      platform: "android",
    });

    // Create fastify test instance
    app = Fastify();
    await app.register(publicRoutes);
    await app.register(adminRoutes);
    await app.ready();
  });

  afterAll(async () => {
    deleteApp(TEST_APP_ID);
    await app.close();
  });

  it("should insert initial versions and setup patches", async () => {
    const releaseDir = path.join(config.filesDir, TEST_APP_ID, "releases");
    const patchDir = path.join(config.filesDir, TEST_APP_ID, "patches");
    await mkdir(releaseDir, { recursive: true });
    await mkdir(patchDir, { recursive: true });

    // Create dummy files on disk
    await writeFile(path.join(releaseDir, "release-v100.apk"), "apk-100");
    await writeFile(path.join(releaseDir, "release-v101.apk"), "apk-101");
    await writeFile(path.join(releaseDir, "release-v102.apk"), "apk-102");
    await writeFile(path.join(releaseDir, "latest.apk"), "apk-102");

    await writeFile(path.join(patchDir, "patch-v100-to-v101.patch"), "patch-100-101");
    await writeFile(path.join(patchDir, "patch-v101-to-v102.patch"), "patch-101-102");

    // Insert 3 versions: v100, v101, v102
    upsertVersion(TEST_APP_ID, {
      versionCode: 100,
      versionName: "1.0.0",
      minVersionCode: 1,
      forceUpdate: false,
      isLatest: false,
      size: 1000,
      fileUrl: `/api/apps/${TEST_APP_ID}/releases/release-v100.apk`,
      releaseNotes: ["初始版本发布"],
    });

    upsertVersion(TEST_APP_ID, {
      versionCode: 101,
      versionName: "1.0.1",
      minVersionCode: 1,
      forceUpdate: false,
      isLatest: false,
      size: 1100,
      fileUrl: `/api/apps/${TEST_APP_ID}/releases/release-v101.apk`,
      releaseNotes: ["修复微信分享失败"],
    });

    upsertVersion(TEST_APP_ID, {
      versionCode: 102,
      versionName: "1.0.2",
      minVersionCode: 1,
      forceUpdate: false,
      isLatest: true,
      size: 1200,
      fileUrl: `/api/apps/${TEST_APP_ID}/releases/release-v102.apk`,
      releaseNotes: ["优化启动性能", "适配最新系统"],
    });

    // Insert patches
    upsertPatch(TEST_APP_ID, {
      fromVersionCode: 100,
      targetVersionCode: 101,
      patchFile: "patch-v100-to-v101.patch",
      patchUrl: `/api/apps/${TEST_APP_ID}/patches/patch-v100-to-v101.patch`,
      patchSize: 100,
    });

    upsertPatch(TEST_APP_ID, {
      fromVersionCode: 101,
      targetVersionCode: 102,
      patchFile: "patch-v101-to-v102.patch",
      patchUrl: `/api/apps/${TEST_APP_ID}/patches/patch-v101-to-v102.patch`,
      patchSize: 150,
    });

    // Check patch matrix returns forceUpdate & minVersionCode
    const matrixRes = await app.inject({
      method: "GET",
      url: `/admin/apps/${TEST_APP_ID}/patches`,
      headers: { "x-api-key": TEST_API_KEY },
    });
    expect(matrixRes.statusCode).toBe(200);
    const groups = matrixRes.json().data.versionGroups;
    expect(groups.length).toBe(3);
    expect(groups[0].versionCode).toBe(102);
    expect(groups[0].forceUpdate).toBe(false);
    expect(groups[0].minVersionCode).toBe(1);
    expect(groups[0].isLatest).toBe(true);
  });

  it("should update version config via PATCH (toggle forceUpdate and minVersionCode)", async () => {
    // 1. Toggle forceUpdate on v102
    const patchRes1 = await app.inject({
      method: "PATCH",
      url: `/admin/apps/${TEST_APP_ID}/versions/102`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: { forceUpdate: true },
    });
    expect(patchRes1.statusCode).toBe(200);
    expect(patchRes1.json().data.forceUpdate).toBe(true);

    // Client version check should now show forceUpdate: true
    const clientRes1 = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version/android?versionCode=101`,
    });
    expect(clientRes1.statusCode).toBe(200);
    expect(clientRes1.json().data.forceUpdate).toBe(true);

    // 2. Toggle forceUpdate back to false, but set minVersionCode to 102
    const patchRes2 = await app.inject({
      method: "PATCH",
      url: `/admin/apps/${TEST_APP_ID}/versions/102`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: { forceUpdate: false, minVersionCode: 102 },
    });
    expect(patchRes2.statusCode).toBe(200);
    expect(patchRes2.json().data.forceUpdate).toBe(false);
    expect(patchRes2.json().data.minVersionCode).toBe(102);

    // Client with versionCode 101 (< 102) should receive forceUpdate: true
    const clientRes2 = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version/android?versionCode=101`,
    });
    expect(clientRes2.statusCode).toBe(200);
    expect(clientRes2.json().data.forceUpdate).toBe(true);

    // Client with versionCode 102 (= 102) has no update
    const clientRes3 = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version/android?versionCode=102`,
    });
    expect(clientRes3.statusCode).toBe(200);
    expect(clientRes3.json().data.hasUpdate).toBe(false);
  });

  it("should trigger forceUpdate if an intermediate version had forceUpdate enabled", async () => {
    // Reset v102 minVersionCode to 100, forceUpdate to false
    await app.inject({
      method: "PATCH",
      url: `/admin/apps/${TEST_APP_ID}/versions/102`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: { forceUpdate: false, minVersionCode: 1 },
    });

    // Mark intermediate version v101 as forceUpdate: true
    await app.inject({
      method: "PATCH",
      url: `/admin/apps/${TEST_APP_ID}/versions/101`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: { forceUpdate: true },
    });

    // Client on v100 upgrading to latest (v102) should have forceUpdate: true because v101 was mandatory
    const clientRes = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version/android?versionCode=100`,
    });
    expect(clientRes.statusCode).toBe(200);
    expect(clientRes.json().data.forceUpdate).toBe(true);

    // Client on v101 upgrading to v102 should NOT be forced (already past v101)
    const clientResPast = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version/android?versionCode=101`,
    });
    expect(clientResPast.statusCode).toBe(200);
    expect(clientResPast.json().data.forceUpdate).toBe(false);
  });

  it("should support editing releaseNotes and automatically accumulate release notes across multiple versions", async () => {
    // 1. Edit release notes of v101 via PATCH (multiline string format)
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/admin/apps/${TEST_APP_ID}/versions/101`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: { releaseNotes: "新增聊天功能\n修复闪退问题" },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().data.releaseNotes).toEqual(["新增聊天功能", "修复闪退问题"]);

    // 2. Client on v100 checks update (crosses v101 and v102 -> multi-version cumulative)
    const clientResCross = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version/android?versionCode=100`,
    });
    expect(clientResCross.statusCode).toBe(200);
    const data = clientResCross.json().data;
    expect(data.releaseNotes).toEqual([
      "【v1.0.2】",
      "• 优化启动性能",
      "• 适配最新系统",
      "",
      "【v1.0.1】",
      "• 新增聊天功能",
      "• 修复闪退问题",
    ]);
    expect(data.historyReleaseNotes).toEqual([
      {
        versionCode: 102,
        versionName: "1.0.2",
        releaseNotes: ["优化启动性能", "适配最新系统"],
      },
      {
        versionCode: 101,
        versionName: "1.0.1",
        releaseNotes: ["新增聊天功能", "修复闪退问题"],
      },
    ]);

    // 3. Client on v101 checks update (single version update to v102 -> clean latest notes)
    const clientResSingle = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version/android?versionCode=101`,
    });
    expect(clientResSingle.statusCode).toBe(200);
    expect(clientResSingle.json().data.releaseNotes).toEqual([
      "优化启动性能",
      "适配最新系统",
    ]);
  });

  it("should delete a middle version and clean up related patches and files", async () => {
    const releaseDir = path.join(config.filesDir, TEST_APP_ID, "releases");
    const patchDir = path.join(config.filesDir, TEST_APP_ID, "patches");

    // Delete v101
    const delRes = await app.inject({
      method: "DELETE",
      url: `/admin/apps/${TEST_APP_ID}/versions/101`,
      headers: { "x-api-key": TEST_API_KEY },
    });
    expect(delRes.statusCode).toBe(200);

    // Verify DB
    const ver101 = db.prepare("SELECT * FROM versions WHERE app_id = ? AND version_code = 101").get(TEST_APP_ID);
    expect(ver101).toBeUndefined();

    // Verify patches relating to 101 are deleted
    const patches = db.prepare("SELECT * FROM patches WHERE app_id = ?").all(TEST_APP_ID);
    expect(patches.length).toBe(0); // both 100->101 and 101->102 should be gone

    // Verify disk files
    await expect(stat(path.join(releaseDir, "release-v101.apk"))).rejects.toThrow();
    await expect(stat(path.join(patchDir, "patch-v100-to-v101.patch"))).rejects.toThrow();
    await expect(stat(path.join(patchDir, "patch-v101-to-v102.patch"))).rejects.toThrow();

    // v100 and v102 files should still exist
    const st100 = await stat(path.join(releaseDir, "release-v100.apk"));
    expect(st100.isFile()).toBe(true);
    const st102 = await stat(path.join(releaseDir, "release-v102.apk"));
    expect(st102.isFile()).toBe(true);
  });

  it("should delete the latest version and automatically promote the next highest version to latest", async () => {
    const releaseDir = path.join(config.filesDir, TEST_APP_ID, "releases");

    // Delete v102 (current latest)
    const delRes = await app.inject({
      method: "DELETE",
      url: `/admin/apps/${TEST_APP_ID}/versions/102`,
      headers: { "x-api-key": TEST_API_KEY },
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().data.newLatestVersionCode).toBe(100);

    // Verify DB
    const ver100 = db.prepare("SELECT * FROM versions WHERE app_id = ? AND version_code = 100").get(TEST_APP_ID);
    expect(ver100.is_latest).toBe(1);

    // Client version check should now return v100 as latest
    const clientRes = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version/android`,
    });
    expect(clientRes.statusCode).toBe(200);
    expect(clientRes.json().data.versionCode).toBe(100);

    // Check that release-v102.apk is removed
    await expect(stat(path.join(releaseDir, "release-v102.apk"))).rejects.toThrow();
  });

  it("should reject unauthorized requests without valid X-API-Key", async () => {
    const res1 = await app.inject({
      method: "PATCH",
      url: `/admin/apps/${TEST_APP_ID}/versions/100`,
      payload: { forceUpdate: true },
    });
    expect(res1.statusCode).toBe(401);

    const res2 = await app.inject({
      method: "DELETE",
      url: `/admin/apps/${TEST_APP_ID}/versions/100`,
    });
    expect(res2.statusCode).toBe(401);
  });

  it("should delete the last version and clean up latest file", async () => {
    const releaseDir = path.join(config.filesDir, TEST_APP_ID, "releases");

    // Delete v100 (only version left)
    const delRes = await app.inject({
      method: "DELETE",
      url: `/admin/apps/${TEST_APP_ID}/versions/100`,
      headers: { "x-api-key": TEST_API_KEY },
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().data.newLatestVersionCode).toBeNull();

    // Verify DB has 0 versions
    const all = db.prepare("SELECT * FROM versions WHERE app_id = ?").all(TEST_APP_ID);
    expect(all.length).toBe(0);

    // Verify latest.apk removed
    await expect(stat(path.join(releaseDir, "latest.apk"))).rejects.toThrow();
  });

  it("should support creating and updating app with assetPattern and multi-platform routes", async () => {
    const multiAppId = "test-windows-app";

    // 1. Register windows app with assetPattern
    const regRes = await app.inject({
      method: "POST",
      url: "/admin/apps",
      headers: { "x-api-key": TEST_API_KEY },
      payload: {
        appId: multiAppId,
        name: "Test Windows App",
        platform: "windows",
        assetPattern: ".*-setup-.*\\.exe$",
      },
    });
    expect(regRes.statusCode).toBe(201);
    expect(regRes.json().data.assetPattern).toBe(".*-setup-.*\\.exe$");
    expect(regRes.json().data.platform).toBe("windows");

    // 2. Update assetPattern
    const updateRes = await app.inject({
      method: "PATCH",
      url: `/admin/apps/${multiAppId}`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: {
        assetPattern: ".*-win-x64\\.exe$",
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().data.assetPattern).toBe(".*-win-x64\\.exe$");

    // 3. Add a version
    upsertVersion(multiAppId, {
      versionCode: 200,
      versionName: "2.0.0",
      minVersionCode: 1,
      forceUpdate: false,
      isLatest: true,
      size: 5000,
      fileUrl: `/api/apps/${multiAppId}/releases/release-v200.exe`,
    });

    // 4. Test universal route /api/apps/:appId/version
    const univRes = await app.inject({
      method: "GET",
      url: `/api/apps/${multiAppId}/version`,
    });
    expect(univRes.statusCode).toBe(200);
    expect(univRes.json().data.versionCode).toBe(200);

    // 5. Test platform-specific route /api/apps/:appId/version/windows
    const winRes = await app.inject({
      method: "GET",
      url: `/api/apps/${multiAppId}/version/windows`,
    });
    expect(winRes.statusCode).toBe(200);
    expect(winRes.json().data.versionCode).toBe(200);

    // Cleanup
    deleteApp(multiAppId);
  });
});

