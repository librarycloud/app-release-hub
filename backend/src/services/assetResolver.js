/**
 * Multi-platform Release Asset Resolver
 *
 * Provides smart identification and matching of platform-specific
 * installation packages and metadata manifests from GitHub releases.
 */

const NON_INSTALLER_EXTS = new Set([
  ".sha256", ".sha512", ".md5", ".sig", ".asc", ".blockmap",
  ".json", ".yml", ".yaml", ".txt", ".log", ".gitkeep", ".md"
]);

const PLATFORM_CANONICAL_EXTS = {
  android: "apk",
  windows: "exe",
  macos: "dmg",
  linux: "AppImage",
  ios: "ipa",
};

const PLATFORM_RULES = {
  android: {
    exts: [".apk", ".aab"],
    keywords: ["android", "apk"],
    avoidKeywords: ["-unaligned", "unaligned"],
  },
  windows: {
    exts: [".exe", ".msi"],
    keywords: ["win", "windows", "setup", "x64", "win32", "win64", "x86_64"],
    avoidKeywords: ["uninstall", "helper"],
  },
  macos: {
    exts: [".dmg", ".pkg"],
    keywords: ["mac", "macos", "darwin", "osx", "apple", "arm64", "universal", "x64"],
    avoidKeywords: ["uninstall"],
  },
  linux: {
    exts: [".appimage", ".deb", ".rpm", ".tar.gz", ".tar.xz"],
    keywords: ["linux", "appimage", "ubuntu", "debian", "amd64", "x86_64"],
    avoidKeywords: [],
  },
  ios: {
    exts: [".ipa"],
    keywords: ["ios", "ipa"],
    avoidKeywords: [],
  },
};

/**
 * Get canonical file extension for a platform
 */
export function getFileExt(platform) {
  const norm = String(platform || "").toLowerCase();
  return PLATFORM_CANONICAL_EXTS[norm] || "bin";
}

/**
 * Check if a filename ends with a non-installer extension
 */
function isIgnoredAsset(name) {
  const lower = name.toLowerCase();
  for (const ext of NON_INSTALLER_EXTS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Find the metadata JSON asset from release assets
 */
export function findMetadataAsset(assets, platform = "") {
  if (!Array.isArray(assets) || assets.length === 0) return null;

  const normPlatform = String(platform || "").toLowerCase();
  const platformMetaName = `app-version.${normPlatform}.json`;
  const universalMetaName = "app-version.json";
  const altPlatformMetaName = `${normPlatform}-version.json`;

  // 1. Exact platform-specific metadata: app-version.<platform>.json
  if (normPlatform) {
    const platformMatch = assets.find((a) => a.name.toLowerCase() === platformMetaName);
    if (platformMatch) return platformMatch;
  }

  // 2. Generic metadata: app-version.json
  const universalMatch = assets.find((a) => a.name.toLowerCase() === universalMetaName);
  if (universalMatch) return universalMatch;

  // 3. Alternative platform-specific: <platform>-version.json
  if (normPlatform) {
    const altMatch = assets.find((a) => a.name.toLowerCase() === altPlatformMetaName);
    if (altMatch) return altMatch;
  }

  // 4. Any JSON asset matching app-version*.json
  const patternMatch = assets.find((a) => /^app-version.*\.json$/i.test(a.name));
  if (patternMatch) return patternMatch;

  // 5. Any JSON matching *version*.json
  const versionJsonMatch = assets.find((a) => a.name.toLowerCase().endsWith("version.json"));
  if (versionJsonMatch) return versionJsonMatch;

  return null;
}

/**
 * Find the binary installation asset from release assets
 */
export function findBinaryAsset(assets, { platform = "android", assetPattern = "", preferredFileName = "" } = {}) {
  if (!Array.isArray(assets) || assets.length === 0) return null;

  const validAssets = assets.filter((a) => a && a.name && !isIgnoredAsset(a.name));
  if (validAssets.length === 0) return null;

  // 1. Preferred filename specified by metadata JSON
  if (preferredFileName) {
    const target = preferredFileName.trim().toLowerCase();
    const exactMatch = validAssets.find((a) => a.name.toLowerCase() === target);
    if (exactMatch) return exactMatch;
  }

  // 2. Custom regex pattern configured for this App
  if (assetPattern && typeof assetPattern === "string" && assetPattern.trim()) {
    try {
      const regex = new RegExp(assetPattern.trim(), "i");
      const matched = validAssets.find((a) => regex.test(a.name));
      if (matched) return matched;
    } catch (err) {
      throw new Error(`安装包匹配正则表达式无效: ${assetPattern} (${err.message})`);
    }
  }

  // 3. Smart heuristic fallback by platform
  const normPlatform = String(platform || "").toLowerCase();
  const rule = PLATFORM_RULES[normPlatform];

  if (!rule) {
    // Unknown platform, fallback to canonical extension or first valid asset
    const canonicalExt = `.${getFileExt(normPlatform)}`.toLowerCase();
    return validAssets.find((a) => a.name.toLowerCase().endsWith(canonicalExt)) || validAssets[0] || null;
  }

  // Filter candidates matching platform extensions
  let candidates = validAssets.filter((a) => {
    const lower = a.name.toLowerCase();
    return rule.exts.some((ext) => lower.endsWith(ext));
  });

  if (candidates.length === 0) {
    return null;
  }

  // Filter out avoidKeywords (e.g. -unaligned.apk, uninstall.exe) if other candidates exist
  if (rule.avoidKeywords && rule.avoidKeywords.length > 0) {
    const cleanCandidates = candidates.filter((a) => {
      const lower = a.name.toLowerCase();
      return !rule.avoidKeywords.some((kw) => lower.includes(kw));
    });
    if (cleanCandidates.length > 0) {
      candidates = cleanCandidates;
    }
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  // Score candidates by platform keywords
  function scoreAsset(asset) {
    const lower = asset.name.toLowerCase();
    let score = 0;
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) score += 2;
    }
    return score;
  }

  candidates.sort((a, b) => scoreAsset(b) - scoreAsset(a));
  return candidates[0];
}

/**
 * Resolve metadata asset and binary installer asset together
 */
export function resolveReleaseAssets(assets, platform, { assetPattern = "", preferredFileName = "" } = {}) {
  const metaAsset = findMetadataAsset(assets, platform);
  const fileAsset = findBinaryAsset(assets, { platform, assetPattern, preferredFileName });
  return { metaAsset, fileAsset };
}
