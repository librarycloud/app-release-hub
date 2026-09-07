import axios from "axios";

const API_KEY = localStorage.getItem("admin_api_key") || "";

const http = axios.create({ baseURL: "/" });

http.interceptors.request.use((cfg) => {
  const key = localStorage.getItem("admin_api_key") || "";
  if (key) cfg.headers["X-API-Key"] = key;
  return cfg;
});

http.interceptors.response.use(
  (r) => r.data,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("admin_api_key");
      window.location.href = "/login";
    }
    return Promise.reject(err.response?.data || err);
  }
);

// ─── Apps ────────────────────────────────────────────────────────────────────
export const listApps = () => http.get("/admin/apps");
export const createApp = (data) => http.post("/admin/apps", data);
export const updateApp = (appId, data) => http.patch(`/admin/apps/${appId}`, data);
export const deleteApp = (appId) => http.delete(`/admin/apps/${appId}`);

// ─── Release ─────────────────────────────────────────────────────────────────
export const syncRelease = (appId) => http.post(`/admin/apps/${appId}/sync`);
export const syncHistoryReleases = (appId, data) => http.post(`/admin/apps/${appId}/sync-history`, data);
export const syncAllApps = () => http.post("/admin/sync-all");

// ─── Versions ────────────────────────────────────────────────────────────────
export const createVersion = (appId, data, isMultipart = false) =>
  http.post(`/admin/apps/${appId}/versions`, data, isMultipart ? { headers: { "Content-Type": "multipart/form-data" } } : {});
export const updateVersion = (appId, versionCode, data) => http.patch(`/admin/apps/${appId}/versions/${versionCode}`, data);
export const deleteVersion = (appId, versionCode) => http.delete(`/admin/apps/${appId}/versions/${versionCode}`);

// ─── Patches ─────────────────────────────────────────────────────────────────
export const getPatchMatrix = (appId) => http.get(`/admin/apps/${appId}/patches`);
export const generatePatch = (appId, data) => http.post(`/admin/apps/${appId}/patches/generate`, data);
export const generateAllPatches = (appId, data) => http.post(`/admin/apps/${appId}/patches/generate-all`, data);

// ─── Auth helper ─────────────────────────────────────────────────────────────
export function setApiKey(key) { localStorage.setItem("admin_api_key", key); }
export function getApiKey() { return localStorage.getItem("admin_api_key") || ""; }
export function clearApiKey() { localStorage.removeItem("admin_api_key"); }
