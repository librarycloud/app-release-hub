export function getPlatformIcon(p) {
  return { android: "🤖", windows: "🪟", macos: "🍎", linux: "🐧", ios: "📱", wgt: "⚡", rn: "⚛️" }[p] || "📦";
}

export function getPlatformTagType(p) {
  return { android: "success", windows: "primary", macos: "warning", linux: "danger", ios: "info", wgt: "warning", rn: "primary" }[p] || "info";
}

export function formatSize(bytes) {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
