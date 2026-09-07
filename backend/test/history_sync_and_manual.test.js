import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import path from "node:path";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { config } from "../src/config.js";
import { db } from "../src/db/index.js";
import { initSchema } from "../src/db/schema.js";
import publicRoutes from "../src/routes/publicRoutes.js";
import adminRoutes from "../src/routes/adminRoutes.js";
import {
  insertApp,
  deleteApp,
  upsertVersion,
  getVersion,
  getVersions,
  getApp,
} from "../src/services/storageAdapter.js";
import {
  createManualVersion,
  syncHistoricalReleases,
  refreshAppLatestVersion,
} from "../src/services/releaseService.js";

const TEST_API_KEY = "test-history-sync-key";
const TEST_APP_ID = "test-history-app";

function buildMultipartBody(fields, file) {
  const boundary = "----TestBoundary" + Math.random().toString(36).substring(2);
  let body = "";
  for (const [key, val] of Object.entries(fields)) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
    body += `${val}\r\n`;
  }
  if (file) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\n`;
    body += `Content-Type: ${file.contentType || "application/octet-stream"}\r\n\r\n`;
    body += file.content;
    body += `\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.from(body, "utf-8"),
  };
}

describe("Historical Version Sync & Manual Backfill Tests", () => {
  let app;

  beforeAll(async () => {
    config.adminApiKey = TEST_API_KEY;
    initSchema();

    deleteApp(TEST_APP_ID);

    insertApp({
      appId: TEST_APP_ID,
      name: "History Test App",
      platform: "android",
      githubRepo: "myorg/history-app",
      githubApiUrl: "https://api.github.com",
    });

    const releaseDir = path.join(config.filesDir, TEST_APP_ID, "releases");
    await mkdir(releaseDir, { recursive: true });

    // Seed an existing current version v100
    await writeFile(path.join(releaseDir, "release-v100.apk"), "base-content-100");
    await writeFile(path.join(releaseDir, "latest.apk"), "base-content-100");

    upsertVersion(TEST_APP_ID, {
      versionCode: 100,
      versionName: "1.0.0",
      minVersionCode: 1,
      forceUpdate: false,
      isLatest: true,
      size: 16,
      sha256: "dummy-sha-100",
      fileUrl: `/api/apps/${TEST_APP_ID}/releases/release-v100.apk`,
      releaseNotes: ["当前版本"],
      publishedAt: "2024-01-01",
    });

    app = Fastify();
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
    await app.register(publicRoutes);
    await app.register(adminRoutes);
    await app.ready();
  });

  afterAll(async () => {
    deleteApp(TEST_APP_ID);
    await app.close();
  });

  it("should manually backfill an older version via JSON (POST /admin/apps/:appId/versions)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/admin/apps/${TEST_APP_ID}/versions`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: {
        versionCode: 80,
        versionName: "0.8.0",
        publishedAt: "2023-08-01",
        releaseNotes: ["历史基础版本", "修复初期Bug"],
        forceUpdate: false,
        fileUrl: "https://cdn.example.com/downloads/v0.8.0.apk",
        size: 5000,
      },
    });

    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.code).toBe(0);
    expect(json.data.versionCode).toBe(80);
    expect(json.data.versionName).toBe("0.8.0");
    expect(json.data.isLatest).toBe(false);

    // Verify existing latest version remains v100
    const v80 = getVersion(TEST_APP_ID, 80);
    expect(v80).toBeDefined();
    expect(v80.is_latest).toBe(0);

    const v100 = getVersion(TEST_APP_ID, 100);
    expect(v100.is_latest).toBe(1);
  });

  it("should reject duplicate versionCode backfill", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/admin/apps/${TEST_APP_ID}/versions`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: {
        versionCode: 80,
        versionName: "0.8.0-dup",
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain("已存在，不能重复补录");
  });

  it("should validate versionCode and versionName", async () => {
    const resNoCode = await app.inject({
      method: "POST",
      url: `/admin/apps/${TEST_APP_ID}/versions`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: {
        versionCode: -1,
        versionName: "0.5.0",
      },
    });
    expect(resNoCode.statusCode).toBe(500);
    expect(resNoCode.json().message).toContain("versionCode 必须为大于等于 1 的整数");

    const resNoName = await app.inject({
      method: "POST",
      url: `/admin/apps/${TEST_APP_ID}/versions`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: {
        versionCode: 85,
        versionName: "",
      },
    });
    expect(resNoName.statusCode).toBe(500);
    expect(resNoName.json().message).toContain("versionName 不能为空");
  });

  it("should manually backfill a version with file upload (multipart/form-data)", async () => {
    const fileContent = "dummy-binary-apk-content-for-v90";
    const mp = buildMultipartBody(
      {
        versionCode: "90",
        versionName: "0.9.0",
        publishedAt: "2023-11-01",
        forceUpdate: "false",
        minVersionCode: "1",
        releaseNotes: "这是旧版本90\n更新说明第二行",
      },
      {
        fieldname: "file",
        filename: "test-v0.9.0.apk",
        content: fileContent,
      }
    );

    const res = await app.inject({
      method: "POST",
      url: `/admin/apps/${TEST_APP_ID}/versions`,
      headers: {
        "x-api-key": TEST_API_KEY,
        "content-type": mp.contentType,
      },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.code).toBe(0);
    expect(json.data.versionCode).toBe(90);
    expect(json.data.versionName).toBe("0.9.0");
    expect(json.data.fileUrl).toBe(`/api/apps/${TEST_APP_ID}/releases/release-v90.apk`);
    expect(json.data.size).toBe(fileContent.length);
    expect(json.data.sha256).toBeDefined();

    // Verify saved file on disk
    const savedFilePath = path.join(config.filesDir, TEST_APP_ID, "releases", "release-v90.apk");
    const diskContent = await readFile(savedFilePath, "utf-8");
    expect(diskContent).toBe(fileContent);

    // Verify release notes array
    expect(json.data.releaseNotes).toEqual(["这是旧版本90", "更新说明第二行"]);
    const v90 = getVersion(TEST_APP_ID, 90);
    expect(JSON.parse(v90.release_notes)).toEqual(["这是旧版本90", "更新说明第二行"]);
  });

  it("should automatically update latest version when a higher version is manually backfilled", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/admin/apps/${TEST_APP_ID}/versions`,
      headers: { "x-api-key": TEST_API_KEY },
      payload: {
        versionCode: 150,
        versionName: "1.5.0",
        publishedAt: "2024-06-01",
        releaseNotes: ["全新升级 1.5.0"],
      },
    });

    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.data.isLatest).toBe(true);

    const v150 = getVersion(TEST_APP_ID, 150);
    expect(v150.is_latest).toBe(1);

    const v100 = getVersion(TEST_APP_ID, 100);
    expect(v100.is_latest).toBe(0);
  });

  it("should batch sync historical releases from GitHub mock", async () => {
    const originalFetch = globalThis.fetch;

    const mockReleases = [
      {
        tag_name: "v0.7.0",
        name: "Release 0.7.0",
        published_at: "2023-06-01T00:00:00Z",
        body: "- 优化网络请求\n- 修复历史Bug",
        assets: [
          {
            name: "app-version.json",
            browser_download_url: "https://mock.github.com/v0.7.0/app-version.json",
          },
          {
            name: "app-release.apk",
            browser_download_url: "https://mock.github.com/v0.7.0/app-release.apk",
          },
        ],
      },
      {
        tag_name: "v0.6.0",
        name: "Release 0.6.0",
        published_at: "2023-04-01T00:00:00Z",
        body: "- 最早公测版",
        assets: [
          {
            name: "app-version.json",
            browser_download_url: "https://mock.github.com/v0.6.0/app-version.json",
          },
          {
            name: "app-release.apk",
            browser_download_url: "https://mock.github.com/v0.6.0/app-release.apk",
          },
        ],
      },
      {
        tag_name: "v0.5.0-invalid",
        name: "Release 0.5.0 without apk",
        assets: [],
      },
    ];

    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/releases?per_page=")) {
        return {
          ok: true,
          status: 200,
          json: async () => mockReleases,
        };
      }
      if (urlStr.includes("/v0.7.0/app-version.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            versionCode: 70,
            versionName: "0.7.0",
            minVersionCode: 1,
            releaseNotes: ["0.7.0 更新内容"],
          }),
        };
      }
      if (urlStr.includes("/v0.7.0/app-release.apk")) {
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.from("mock-apk-data-v70"));
              controller.close();
            },
          }),
        };
      }
      if (urlStr.includes("/v0.6.0/app-version.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            versionCode: 60,
            versionName: "0.6.0",
            minVersionCode: 1,
            releaseNotes: ["0.6.0 初版内容"],
          }),
        };
      }
      if (urlStr.includes("/v0.6.0/app-release.apk")) {
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.from("mock-apk-data-v60"));
              controller.close();
            },
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    try {
      const res = await app.inject({
        method: "POST",
        url: `/admin/apps/${TEST_APP_ID}/sync-history`,
        headers: { "x-api-key": TEST_API_KEY },
        payload: { limit: 10, autoGeneratePatches: false },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.code).toBe(0);
      expect(json.data.totalScanned).toBe(3);
      expect(json.data.importedCount).toBe(2);
      expect(json.data.skippedCount).toBe(1);
      expect(json.data.latestVersionCode).toBe(150);

      // Check DB records for v70 and v60
      const v70 = getVersion(TEST_APP_ID, 70);
      expect(v70).toBeDefined();
      expect(v70.version_name).toBe("0.7.0");
      expect(v70.is_latest).toBe(0);

      const v60 = getVersion(TEST_APP_ID, 60);
      expect(v60).toBeDefined();
      expect(v60.version_name).toBe("0.6.0");
      expect(v60.is_latest).toBe(0);

      // Verify files downloaded to releases dir
      const file70 = path.join(config.filesDir, TEST_APP_ID, "releases", "release-v70.apk");
      expect((await stat(file70)).isFile()).toBe(true);
      expect(await readFile(file70, "utf-8")).toBe("mock-apk-data-v70");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should accumulate release notes from imported historical version up to latest", async () => {
    const clientRes = await app.inject({
      method: "GET",
      url: `/api/apps/${TEST_APP_ID}/version?currentVersionCode=60`,
    });

    expect(clientRes.statusCode).toBe(200);
    const clientData = clientRes.json().data;
    expect(clientData.hasUpdate).toBe(true);
    expect(clientData.versionCode).toBe(150);

    expect(clientData.releaseNotes.some((n) => n.includes("【v1.5.0】"))).toBe(true);
    expect(clientData.releaseNotes.some((n) => n.includes("全新升级 1.5.0"))).toBe(true);
    expect(clientData.releaseNotes.some((n) => n.includes("【v0.7.0】"))).toBe(true);
    expect(clientData.releaseNotes.some((n) => n.includes("0.7.0 更新内容"))).toBe(true);
  });
});
