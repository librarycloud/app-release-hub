import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import { config } from "../src/config.js";
import { initSchema } from "../src/db/schema.js";
import adminRoutes from "../src/routes/adminRoutes.js";
import publicRoutes from "../src/routes/publicRoutes.js";
import {
  insertApp,
  deleteApp,
  getApp,
  getDueAutoSyncApps,
  getAutoSyncApps,
} from "../src/services/storageAdapter.js";
import {
  isAppDueForSync,
  runAutoSyncCycle,
} from "../src/services/autoSyncService.js";
import * as releaseService from "../src/services/releaseService.js";

const TEST_API_KEY = "test-auto-sync-key";
const APP_DUE = "test-app-due";
const APP_NOT_DUE = "test-app-not-due";
const APP_DISABLED = "test-app-disabled";

describe("Per-App Auto-Sync Scheduling & Configuration Tests", () => {
  let app;

  beforeAll(async () => {
    config.adminApiKey = TEST_API_KEY;
    initSchema();

    deleteApp(APP_DUE);
    deleteApp(APP_NOT_DUE);
    deleteApp(APP_DISABLED);

    app = Fastify();
    await app.register(publicRoutes);
    await app.register(adminRoutes);
    await app.ready();
  });

  afterAll(async () => {
    deleteApp(APP_DUE);
    deleteApp(APP_NOT_DUE);
    deleteApp(APP_DISABLED);
    await app.close();
  });

  it("should register an app with custom autoSyncIntervalMinutes", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/apps",
      headers: { "x-api-key": TEST_API_KEY },
      payload: {
        appId: APP_DUE,
        name: "Due Sync App",
        platform: "android",
        githubRepo: "testorg/app-due",
        autoSync: true,
        autoSyncIntervalMinutes: 15,
      },
    });

    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.data.autoSync).toBe(true);
    expect(json.data.autoSyncIntervalMinutes).toBe(15);

    const row = getApp(APP_DUE);
    expect(row.auto_sync_interval_minutes).toBe(15);
  });

  it("should update autoSyncIntervalMinutes via PATCH /admin/apps/:appId", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/apps/${APP_DUE}`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: {
        autoSyncIntervalMinutes: 30,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.autoSyncIntervalMinutes).toBe(30);

    const row = getApp(APP_DUE);
    expect(row.auto_sync_interval_minutes).toBe(30);
  });

  it("should enforce minimum 5 minutes interval", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/apps/${APP_DUE}`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: {
        autoSyncIntervalMinutes: 1, // less than minimum 5
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.autoSyncIntervalMinutes).toBe(5);
  });

  it("should test isAppDueForSync helper calculation", () => {
    const now = new Date("2026-09-07T12:00:00.000Z");

    // Case 1: Never synced -> always due
    expect(
      isAppDueForSync(
        { auto_sync: 1, github_repo: "org/repo", auto_sync_interval_minutes: 60, last_synced_at: null },
        now
      )
    ).toBe(true);

    // Case 2: Synced 40 minutes ago with 30-min interval -> due
    expect(
      isAppDueForSync(
        {
          auto_sync: 1,
          github_repo: "org/repo",
          auto_sync_interval_minutes: 30,
          last_synced_at: "2026-09-07T11:20:00.000Z",
        },
        now
      )
    ).toBe(true);

    // Case 3: Synced 10 minutes ago with 30-min interval -> NOT due
    expect(
      isAppDueForSync(
        {
          auto_sync: 1,
          github_repo: "org/repo",
          auto_sync_interval_minutes: 30,
          last_synced_at: "2026-09-07T11:50:00.000Z",
        },
        now
      )
    ).toBe(false);

    // Case 4: auto_sync disabled -> NOT due
    expect(
      isAppDueForSync(
        {
          auto_sync: 0,
          github_repo: "org/repo",
          auto_sync_interval_minutes: 30,
          last_synced_at: "2026-09-07T10:00:00.000Z",
        },
        now
      )
    ).toBe(false);
  });

  it("should accurately query due apps from SQLite via getDueAutoSyncApps", async () => {
    // APP_DUE: auto_sync=1, interval=10 mins, last_synced_at = 20 mins ago -> DUE
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    insertApp({
      appId: APP_NOT_DUE,
      name: "Not Due App",
      platform: "android",
      githubRepo: "testorg/app-not-due",
      autoSync: true,
      autoSyncIntervalMinutes: 60,
    });
    // APP_NOT_DUE: auto_sync=1, interval=60 mins, last_synced_at = 5 mins ago -> NOT DUE
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    insertApp({
      appId: APP_DISABLED,
      name: "Disabled App",
      platform: "android",
      githubRepo: "testorg/app-disabled",
      autoSync: false,
      autoSyncIntervalMinutes: 10,
    });

    // Update last_synced_at
    const { db } = await import("../src/db/index.js");
    db.prepare("UPDATE apps SET last_synced_at = ?, auto_sync_interval_minutes = 10 WHERE app_id = ?").run(
      twentyMinsAgo,
      APP_DUE
    );
    db.prepare("UPDATE apps SET last_synced_at = ?, auto_sync_interval_minutes = 60 WHERE app_id = ?").run(
      fiveMinsAgo,
      APP_NOT_DUE
    );

    const dueApps = getDueAutoSyncApps();
    const dueAppIds = dueApps.map((a) => a.app_id);

    expect(dueAppIds).toContain(APP_DUE);
    expect(dueAppIds).not.toContain(APP_NOT_DUE);
    expect(dueAppIds).not.toContain(APP_DISABLED);
  });

  it("should sync only due apps during scheduled pass, and sync all when forceAll is true", async () => {
    const syncedApps = [];
    const spy = vi
      .spyOn(releaseService, "syncLatestRelease")
      .mockImplementation(async (appId) => {
        syncedApps.push(appId);
        return { versionName: "1.0.0", versionCode: 100, patchesGenerated: [] };
      });

    try {
      // 1. Scheduled pass: forceAll = false -> only APP_DUE should be synced
      syncedApps.length = 0;
      const scheduledResult = await runAutoSyncCycle({ forceAll: false });
      expect(scheduledResult.results.map((r) => r.appId)).toContain(APP_DUE);
      expect(scheduledResult.results.map((r) => r.appId)).not.toContain(APP_NOT_DUE);

      // 2. Manual pass: forceAll = true -> both APP_DUE and APP_NOT_DUE should be synced
      syncedApps.length = 0;
      const forcedResult = await runAutoSyncCycle({ forceAll: true });
      const forcedIds = forcedResult.results.map((r) => r.appId);
      expect(forcedIds).toContain(APP_DUE);
      expect(forcedIds).toContain(APP_NOT_DUE);
      expect(forcedIds).not.toContain(APP_DISABLED);
    } finally {
      spy.mockRestore();
    }
  });
});
