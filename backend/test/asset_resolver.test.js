import { describe, it, expect } from "vitest";
import {
  getFileExt,
  findMetadataAsset,
  findBinaryAsset,
  resolveReleaseAssets,
} from "../src/services/assetResolver.js";

describe("Asset Resolver Tests", () => {
  describe("getFileExt", () => {
    it("should return canonical file extensions for known platforms", () => {
      expect(getFileExt("android")).toBe("apk");
      expect(getFileExt("Android")).toBe("apk");
      expect(getFileExt("windows")).toBe("exe");
      expect(getFileExt("Windows")).toBe("exe");
      expect(getFileExt("macos")).toBe("dmg");
      expect(getFileExt("linux")).toBe("AppImage");
      expect(getFileExt("ios")).toBe("ipa");
      expect(getFileExt("other")).toBe("bin");
      expect(getFileExt("")).toBe("bin");
    });
  });

  describe("findMetadataAsset", () => {
    it("should prioritize platform-specific metadata file", () => {
      const assets = [
        { name: "app-version.json", browser_download_url: "http://example.com/universal" },
        { name: "app-version.windows.json", browser_download_url: "http://example.com/windows" },
        { name: "app-version.android.json", browser_download_url: "http://example.com/android" },
      ];

      const winMeta = findMetadataAsset(assets, "windows");
      expect(winMeta?.name).toBe("app-version.windows.json");

      const droidMeta = findMetadataAsset(assets, "android");
      expect(droidMeta?.name).toBe("app-version.android.json");
    });

    it("should fall back to app-version.json if platform-specific does not exist", () => {
      const assets = [
        { name: "app-version.json", browser_download_url: "http://example.com/universal" },
        { name: "setup.exe", browser_download_url: "http://example.com/setup" },
      ];

      const macMeta = findMetadataAsset(assets, "macos");
      expect(macMeta?.name).toBe("app-version.json");
    });

    it("should return null if no metadata json exists", () => {
      const assets = [
        { name: "setup.exe", browser_download_url: "http://example.com/setup" },
        { name: "readme.txt", browser_download_url: "http://example.com/readme" },
      ];

      expect(findMetadataAsset(assets, "windows")).toBeNull();
    });
  });

  describe("findBinaryAsset", () => {
    const multiPlatformAssets = [
      { name: "app-version.android.json" },
      { name: "app-version.windows.json" },
      { name: "MyApp-1.0.0-android.apk" },
      { name: "MyApp-1.0.0-android-unaligned.apk" },
      { name: "MyApp-1.0.0-android.apk.sha256" },
      { name: "MyApp-Setup-1.0.0-win-x64.exe" },
      { name: "MyApp-Setup-1.0.0-win-x64.exe.blockmap" },
      { name: "MyApp-1.0.0-mac-arm64.dmg" },
      { name: "MyApp-1.0.0-mac-x64.dmg" },
      { name: "MyApp-1.0.0-linux-amd64.AppImage" },
      { name: "MyApp-1.0.0-linux.deb" },
    ];

    it("should match preferredFileName specified by metadata", () => {
      const matched = findBinaryAsset(multiPlatformAssets, {
        platform: "windows",
        preferredFileName: "MyApp-Setup-1.0.0-win-x64.exe",
      });
      expect(matched?.name).toBe("MyApp-Setup-1.0.0-win-x64.exe");
    });

    it("should match asset via custom regex assetPattern", () => {
      const matchedMacArm = findBinaryAsset(multiPlatformAssets, {
        platform: "macos",
        assetPattern: ".*-mac-arm64\\.dmg$",
      });
      expect(matchedMacArm?.name).toBe("MyApp-1.0.0-mac-arm64.dmg");

      const matchedMacIntel = findBinaryAsset(multiPlatformAssets, {
        platform: "macos",
        assetPattern: ".*-mac-x64\\.dmg$",
      });
      expect(matchedMacIntel?.name).toBe("MyApp-1.0.0-mac-x64.dmg");
    });

    it("should intelligently fallback to platform installer and ignore checksums and unaligned files", () => {
      // Android
      const droid = findBinaryAsset(multiPlatformAssets, { platform: "android" });
      expect(droid?.name).toBe("MyApp-1.0.0-android.apk");

      // Windows
      const win = findBinaryAsset(multiPlatformAssets, { platform: "windows" });
      expect(win?.name).toBe("MyApp-Setup-1.0.0-win-x64.exe");

      // Linux
      const linux = findBinaryAsset(multiPlatformAssets, { platform: "linux" });
      expect(linux?.name).toBe("MyApp-1.0.0-linux-amd64.AppImage");
    });

    it("should throw a descriptive error for invalid regex", () => {
      expect(() => {
        findBinaryAsset(multiPlatformAssets, {
          platform: "windows",
          assetPattern: "[invalid(regex",
        });
      }).toThrow(/安装包匹配正则表达式无效/);
    });
  });

  describe("resolveReleaseAssets", () => {
    it("should resolve both metadata and binary asset for target platform", () => {
      const assets = [
        { name: "app-version.windows.json" },
        { name: "app-version.android.json" },
        { name: "app-release.apk" },
        { name: "app-setup.exe" },
      ];

      const winRes = resolveReleaseAssets(assets, "windows");
      expect(winRes.metaAsset?.name).toBe("app-version.windows.json");
      expect(winRes.fileAsset?.name).toBe("app-setup.exe");

      const droidRes = resolveReleaseAssets(assets, "android");
      expect(droidRes.metaAsset?.name).toBe("app-version.android.json");
      expect(droidRes.fileAsset?.name).toBe("app-release.apk");
    });
  });
});
