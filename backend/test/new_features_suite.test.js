import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { initSchema } from "../src/db/schema.js";
import { db } from "../src/db/index.js";
import { config } from "../src/config.js";
import publicRoutes from "../src/routes/publicRoutes.js";
import adminRoutes from "../src/routes/adminRoutes.js";
import { insertApp, upsertVersion } from "../src/services/storageAdapter.js";

const TEST_API_KEY = "test-secret-key-xyz";

describe("New Enterprise Features: Device UV, Rollback, Import/Export, Share Landing", () => {
  let app;

  beforeAll(async () => {
    config.adminApiKey = TEST_API_KEY;
    initSchema();

    app = Fastify();
    await app.register(publicRoutes);
    await app.register(adminRoutes);
    await app.ready();

    // Create a mock app for testing
    insertApp({
      appId: "feature-test-app",
      name: "Feature Test App",
      platform: "android",
      isPrivate: false,
    });

    upsertVersion("feature-test-app", {
      versionCode: 10,
      versionName: "1.0.0",
      isLatest: false,
      fileUrl: "/api/apps/feature-test-app/releases/release-v10.apk",
      size: 1024,
      releaseNotes: ["First version"],
    });

    upsertVersion("feature-test-app", {
      versionCode: 20,
      versionName: "2.0.0",
      isLatest: true,
      fileUrl: "/api/apps/feature-test-app/releases/release-v20.apk",
      size: 2048,
      releaseNotes: ["Second version"],
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    db.prepare("DELETE FROM app_devices WHERE app_id = ?").run("feature-test-app");
    db.prepare("DELETE FROM versions WHERE app_id = ?").run("feature-test-app");
    db.prepare("DELETE FROM apps WHERE app_id = ?").run("feature-test-app");
  });

  it("should record device UV on client version check and return device stats", async () => {
    // Client checks version with deviceId
    const res1 = await app.inject({
      method: "GET",
      url: "/api/apps/feature-test-app/version?deviceId=device-aaa-111&versionCode=10",
    });
    expect(res1.statusCode).toBe(200);

    // Second check from same device
    await app.inject({
      method: "GET",
      url: "/api/apps/feature-test-app/version?deviceId=device-aaa-111&versionCode=10",
    });

    // Check from second device
    await app.inject({
      method: "GET",
      url: "/api/apps/feature-test-app/version?deviceId=device-bbb-222&versionCode=10",
    });

    // Query app stats
    const statsRes = await app.inject({
      method: "GET",
      url: "/admin/apps/feature-test-app/stats",
      headers: { "x-api-key": TEST_API_KEY },
    });
    expect(statsRes.statusCode).toBe(200);
    const data = statsRes.json().data;
    expect(data.totalDevices).toBe(2);
    expect(data.todayDevices).toBe(2);
    expect(Array.isArray(data.versionCoverage)).toBe(true);
    expect(data.versionCoverage.length).toBeGreaterThan(0);
    expect(data.versionCoverage[0].versionCode).toBe(10);
    expect(data.versionCoverage[0].percentage).toBe(100);
  });

  it("should return share landing info via public /api/apps/:appId/share", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/apps/feature-test-app/share",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe(0);
    expect(body.data.appId).toBe("feature-test-app");
    expect(body.data.name).toBe("Feature Test App");
    expect(body.data.hasRelease).toBe(true);
    expect(body.data.version.versionName).toBe("2.0.0");
    expect(body.data.version.versionCode).toBe(20);
  });

  it("should rollback version to an older version (promote to latest)", async () => {
    // Initially v20 is latest
    const v20Before = db.prepare("SELECT is_latest FROM versions WHERE app_id = ? AND version_code = ?").get("feature-test-app", 20);
    expect(v20Before.is_latest).toBe(1);

    // Rollback to v10
    const rollRes = await app.inject({
      method: "POST",
      url: "/admin/apps/feature-test-app/versions/10/rollback",
      headers: { "x-api-key": TEST_API_KEY },
    });
    expect(rollRes.statusCode).toBe(200);
    expect(rollRes.json().code).toBe(0);

    // Now v10 is latest, v20 is not
    const v10After = db.prepare("SELECT is_latest FROM versions WHERE app_id = ? AND version_code = ?").get("feature-test-app", 10);
    const v20After = db.prepare("SELECT is_latest FROM versions WHERE app_id = ? AND version_code = ?").get("feature-test-app", 20);
    expect(v10After.is_latest).toBe(1);
    expect(v20After.is_latest).toBe(0);

    // Share info now reflects v10
    const shareRes = await app.inject({
      method: "GET",
      url: "/api/apps/feature-test-app/share",
    });
    expect(shareRes.json().data.version.versionCode).toBe(10);
  });

  it("should export all app configurations as JSON and allow batch import", async () => {
    // Export
    const exportRes = await app.inject({
      method: "GET",
      url: "/admin/apps/export",
      headers: { "x-api-key": TEST_API_KEY },
    });
    expect(exportRes.statusCode).toBe(200);
    const exportedApps = exportRes.json().data;
    expect(Array.isArray(exportedApps)).toBe(true);
    const found = exportedApps.find((a) => a.appId === "feature-test-app");
    expect(found).toBeDefined();

    // Import with an update and a new app
    const importPayload = [
      {
        appId: "feature-test-app",
        name: "Feature Test App Renamed",
        platform: "android",
        isPrivate: true,
        clientToken: "token-secret-999",
      },
      {
        appId: "batch-imported-app",
        name: "Batch Imported App",
        platform: "windows",
      },
    ];

    const importRes = await app.inject({
      method: "POST",
      url: "/admin/apps/import",
      headers: { "x-api-key": TEST_API_KEY },
      payload: importPayload,
    });
    expect(importRes.statusCode).toBe(200);
    const importResult = importRes.json().data;
    expect(importResult.createdCount).toBe(1);
    expect(importResult.updatedCount).toBe(1);

    // Verify update took effect
    const updated = db.prepare("SELECT * FROM apps WHERE app_id = ?").get("feature-test-app");
    expect(updated.name).toBe("Feature Test App Renamed");
    expect(updated.is_private).toBe(1);
    expect(updated.client_token).toBe("token-secret-999");

    // Clean up imported app
    db.prepare("DELETE FROM apps WHERE app_id = ?").run("batch-imported-app");
  });

  it("should return targetSha256 and platform info for hot updates and inject private token into URLs", async () => {
    // Check version with clientToken for the now-private feature-test-app (with fallback_full policy)
    const res = await app.inject({
      method: "GET",
      url: "/api/apps/feature-test-app/version?token=token-secret-999&policy=fallback_full&versionCode=5",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe(0);
    expect(body.data.hasUpdate).toBe(true);
    expect(body.data.platform).toBe("android");
    expect(body.data.isWgt).toBe(false);
    expect(body.data.targetSha256).toBeDefined();
    expect(body.data.targetFileSha256).toBeDefined();
    // Verify token was auto-injected into download URL for private app
    expect(body.data.downloadUrl).toContain("token=token-secret-999");
  });

  it("should not leak phased rollout version to requests without deviceId", async () => {
    // Set v20 to 10% rollout and is_latest=1
    db.prepare("UPDATE versions SET rollout_percentage = 10, is_latest = 1 WHERE app_id = ? AND version_code = ?").run("feature-test-app", 20);
    // Ensure v10 has 100% rollout
    db.prepare("UPDATE versions SET rollout_percentage = 100 WHERE app_id = ? AND version_code = ?").run("feature-test-app", 10);

    // Request without deviceId should NOT receive the 10% rollout v20; it should fall back to v10
    const resWithoutDevice = await app.inject({
      method: "GET",
      url: "/api/apps/feature-test-app/version?token=token-secret-999&versionCode=5",
    });
    expect(resWithoutDevice.statusCode).toBe(200);
    expect(resWithoutDevice.json().data.versionCode).toBe(10);
  });
});
