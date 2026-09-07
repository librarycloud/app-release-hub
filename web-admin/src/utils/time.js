/**
 * Browser timezone and date/time formatting utilities.
 * Automatically adapts to the user's browser local timezone.
 */

export function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function getTimeZoneOffsetString() {
  try {
    const offsetMinutes = -new Date().getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absMinutes = Math.abs(offsetMinutes);
    const hours = Math.floor(absMinutes / 60);
    const minutes = absMinutes % 60;
    return minutes > 0
      ? `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`
      : `UTC${sign}${hours}`;
  } catch {
    return "UTC";
  }
}

/**
 * Safely parse date string into Date object.
 * Handles:
 * - Standard ISO strings: '2026-09-07T04:18:10.000Z'
 * - SQLite datetime('now') strings: '2026-09-07 04:18:10' (UTC)
 * - Epoch timestamps (numbers)
 */
export function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === "number") return new Date(val);
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
    // SQLite format 'YYYY-MM-DD HH:MM:SS' is stored in UTC
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed)) {
      return new Date(trimmed.replace(" ", "T") + "Z");
    }
    // Standard ISO string without timezone indicator -> treat as UTC
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
      return new Date(trimmed + "Z");
    }
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Format date-time as YYYY-MM-DD HH:mm:ss in browser timezone.
 */
export function formatDateTime(val, { withZone = false } = {}) {
  const d = parseDate(val);
  if (!d) return val ? String(val) : "—";
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const base = `${Y}-${M}-${D} ${h}:${m}:${s}`;
  return withZone ? `${base} (${getTimeZoneOffsetString()})` : base;
}

/**
 * Format short date-time as M/D HH:mm in browser timezone.
 */
export function formatShortTime(val, { withZone = false } = {}) {
  const d = parseDate(val);
  if (!d) return val ? String(val) : "—";
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const base = `${M}/${D} ${h}:${m}`;
  return withZone ? `${base} (${getTimeZoneOffsetString()})` : base;
}

/**
 * Format date-time with Chinese locale: M月D日 HH:mm in browser timezone.
 */
export function formatChineseTime(val, { withZone = false } = {}) {
  const d = parseDate(val);
  if (!d) return val ? String(val) : "尚未检查";
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const base = `${M}月${D}日 ${h}:${m}`;
  return withZone ? `${base} (${getTimeZoneOffsetString()})` : base;
}
