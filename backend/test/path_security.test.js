import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import {
  sanitizeAppId,
  sanitizeFilename,
  sanitizeSubDir,
  getSafeAppDir,
  getSafeFilePath,
  assertSafeLocalPath,
} from "../src/utils/pathSecurity.js";
import { config } from "../src/config.js";

describe("Path Security & Sanitization Unit Tests", () => {
  describe("sanitizeAppId", () => {
    it("accepts valid alphanumeric, hyphenated, or underscored app IDs", () => {
      expect(sanitizeAppId("app-1")).toBe("app-1");
      expect(sanitizeAppId("my_app")).toBe("my_app");
      expect(sanitizeAppId("app123")).toBe("app123");
      expect(sanitizeAppId("A")).toBe("A");
    });

    it("rejects path traversal sequences and invalid characters in appId", () => {
      expect(() => sanitizeAppId("../etc")).toThrow("非法应用标识");
      expect(() => sanitizeAppId("..")).toThrow("非法应用标识");
      expect(() => sanitizeAppId("/root")).toThrow("非法应用标识");
      expect(() => sanitizeAppId("app/sub")).toThrow("非法应用标识");
      expect(() => sanitizeAppId("app\\sub")).toThrow("非法应用标识");
      expect(() => sanitizeAppId("-invalid-prefix")).toThrow("非法应用标识");
      expect(() => sanitizeAppId("")).toThrow("非法应用标识");
      expect(() => sanitizeAppId(null)).toThrow("非法应用标识");
    });
  });

  describe("sanitizeFilename", () => {
    it("accepts valid filenames", () => {
      expect(sanitizeFilename("release-v1.apk")).toBe("release-v1.apk");
      expect(sanitizeFilename("patch-v1-to-v2.patch")).toBe("patch-v1-to-v2.patch");
      expect(sanitizeFilename("app.tar.gz")).toBe("app.tar.gz");
      expect(sanitizeFilename(".release-1.tmp")).toBe(".release-1.tmp");
    });

    it("rejects directory traversal and special path characters", () => {
      expect(() => sanitizeFilename("../../../etc/passwd")).toThrow("非法文件名");
      expect(() => sanitizeFilename("..")).toThrow("非法文件名");
      expect(() => sanitizeFilename(".")).toThrow("非法文件名");
      expect(() => sanitizeFilename("dir/file.txt")).toThrow("非法文件名");
      expect(() => sanitizeFilename("")).toThrow("非法文件名");
      expect(() => sanitizeFilename("foo$bar.apk")).toThrow("非法文件名");
    });
  });

  describe("sanitizeSubDir", () => {
    it("accepts whitelisted subdirectories", () => {
      expect(sanitizeSubDir("releases")).toBe("releases");
      expect(sanitizeSubDir("patches")).toBe("patches");
      expect(sanitizeSubDir("uploads")).toBe("uploads");
      expect(sanitizeSubDir("tmp")).toBe("tmp");
    });

    it("rejects unlisted subdirectories and traversal", () => {
      expect(() => sanitizeSubDir("../")).toThrow("非法的存储子目录");
      expect(() => sanitizeSubDir("system")).toThrow("非法的存储子目录");
      expect(() => sanitizeSubDir("")).toThrow("非法的存储子目录");
    });
  });

  describe("getSafeAppDir", () => {
    it("resolves app directory strictly within config.filesDir", () => {
      const appDir = getSafeAppDir("test-app");
      const base = path.resolve(config.filesDir);
      expect(appDir).toBe(path.resolve(base, "test-app"));
      expect(appDir.startsWith(base + path.sep)).toBe(true);
    });

    it("prevents path traversal out of config.filesDir", () => {
      expect(() => getSafeAppDir("../../../etc")).toThrow();
    });
  });

  describe("getSafeFilePath", () => {
    it("resolves safe file paths inside the app directory", () => {
      const filePath = getSafeFilePath("test-app", "releases", "release-v1.apk");
      const base = path.resolve(config.filesDir, "test-app", "releases", "release-v1.apk");
      expect(filePath).toBe(base);
    });

    it("rejects any directory traversal attempts in parameters", () => {
      expect(() => getSafeFilePath("../traversal", "releases", "test.apk")).toThrow();
      expect(() => getSafeFilePath("test-app", "../", "test.apk")).toThrow();
      expect(() => getSafeFilePath("test-app", "releases", "../etc/passwd")).toThrow();
    });
  });

  describe("assertSafeLocalPath", () => {
    it("allows paths within config.filesDir or os.tmpdir()", () => {
      const insideFiles = path.resolve(config.filesDir, "any-app/file.apk");
      expect(assertSafeLocalPath(insideFiles)).toBe(insideFiles);

      const insideTmp = path.resolve(os.tmpdir(), "temp-upload.tmp");
      expect(assertSafeLocalPath(insideTmp)).toBe(insideTmp);
    });

    it("rejects sensitive system paths", () => {
      expect(() => assertSafeLocalPath("/etc/passwd")).toThrow("操作被拒绝: 目标文件路径超出允许的安全存储根目录");
      expect(() => assertSafeLocalPath("/root/.ssh/id_rsa")).toThrow("操作被拒绝");
      expect(() => assertSafeLocalPath("/bin/sh")).toThrow("操作被拒绝");
    });
  });
});
