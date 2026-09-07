<template>
  <div class="page-container">
    <!-- Top Navigation Bar -->
    <header class="navbar glass-header">
      <div class="navbar-content">
        <div class="brand">
          <div class="brand-icon">🚀</div>
          <div>
            <div class="brand-title">App Release Hub</div>
            <div class="brand-sub">版本分发与差分增量更新管理系统</div>
          </div>
        </div>
        <div class="nav-actions">
          <ThemeToggle />
          <el-button :loading="syncingAll" :icon="Refresh" @click="doSyncAll">
            <span class="btn-text-full">检查全部更新</span>
            <span class="btn-text-short">检查更新</span>
          </el-button>
          <el-button type="primary" :icon="Plus" @click="showCreate = true">
            <span class="btn-text-full">注册新 App</span>
            <span class="btn-text-short">注册 App</span>
          </el-button>
          <el-button text @click="logout" class="logout-btn">
            退出
          </el-button>
        </div>
      </div>
    </header>

    <main class="main-content">
      <!-- Overview Metric Cards -->
      <section class="stats-grid">
        <div class="stat-card modern-card">
          <div class="stat-icon-wrap blue">📦</div>
          <div class="stat-info">
            <div class="stat-label">已接入应用</div>
            <div class="stat-value">{{ apps.length }} <span class="stat-unit">个</span></div>
          </div>
        </div>
        <div class="stat-card modern-card">
          <div class="stat-icon-wrap green">🔄</div>
          <div class="stat-info">
            <div class="stat-label">开启自动同步</div>
            <div class="stat-value">{{ autoSyncCount }} <span class="stat-unit">个</span></div>
          </div>
        </div>
        <div class="stat-card modern-card">
          <div class="stat-icon-wrap purple">📡</div>
          <div class="stat-info">
            <div class="stat-label">检查更新请求</div>
            <div class="stat-value">{{ globalStats.totalChecks || 0 }} <span class="stat-unit">次</span></div>
            <div class="stat-sub-text">今日 {{ globalStats.todayChecks || 0 }} 次</div>
          </div>
        </div>
        <div class="stat-card modern-card">
          <div class="stat-icon-wrap amber">📥</div>
          <div class="stat-info">
            <div class="stat-label">累计下载安装</div>
            <div class="stat-value">{{ globalStats.totalDownloads || 0 }} <span class="stat-unit">次</span></div>
            <div class="stat-sub-text">今日 {{ globalStats.todayDownloads || 0 }} 次</div>
          </div>
        </div>
        <div class="stat-card modern-card">
          <div class="stat-icon-wrap cyan">⚡</div>
          <div class="stat-info">
            <div class="stat-label">bsdiff 差分引擎</div>
            <div class="stat-value text-success">已启用</div>
          </div>
        </div>
      </section>

      <!-- Filter & Search Bar -->
      <div class="filter-bar modern-card">
        <div class="platform-tabs">
          <button
            v-for="p in platformFilters"
            :key="p.value"
            class="filter-pill"
            :class="{ active: currentPlatform === p.value }"
            @click="currentPlatform = p.value"
          >
            <span>{{ p.label }}</span>
            <span class="pill-count" v-if="p.count > 0">{{ p.count }}</span>
          </button>
        </div>
        <div class="search-wrap">
          <el-input
            v-model="searchQuery"
            placeholder="搜索 App 名称或 ID..."
            clearable
            prefix-icon="Search"
            style="width: 240px"
          />
        </div>
      </div>

      <!-- Apps Grid -->
      <div v-loading="loading" class="apps-container">
        <div v-if="filteredApps.length === 0 && !loading" class="empty-wrap modern-card">
          <el-empty description="未找到匹配的 App">
            <el-button type="primary" :icon="Plus" @click="showCreate = true">注册第一个 App</el-button>
          </el-empty>
        </div>

        <div class="apps-grid">
          <div
            v-for="app in filteredApps"
            :key="app.appId"
            class="app-card modern-card"
            @click="$router.push(`/apps/${app.appId}`)"
          >
            <div class="app-card-top">
              <div class="app-avatar" :class="app.platform">
                {{ platformIcon(app.platform) }}
              </div>
              <div class="app-top-tags">
                <el-tag size="small" :type="platformTagType(app.platform)" effect="light">
                  {{ app.platform.toUpperCase() }}
                </el-tag>
                <el-tag size="small" :type="app.autoSync ? 'success' : 'info'" effect="plain">
                  {{ app.autoSync ? `🔄 ${formatInterval(app.autoSyncIntervalMinutes)}` : '手动同步' }}
                </el-tag>
              </div>
            </div>

            <div class="app-title-area">
              <div class="app-name" :title="app.name">{{ app.name }}</div>
              <div class="app-id-code">
                <code>{{ app.appId }}</code>
              </div>
            </div>

            <div class="app-details">
              <div v-if="app.githubRepo" class="detail-row">
                <span class="detail-label">仓库:</span>
                <span class="repo-text" :title="app.githubRepo">
                  {{ app.githubRepo }}
                </span>
              </div>
              <div v-if="app.assetPattern" class="detail-row">
                <span class="detail-label">匹配:</span>
                <span class="pattern-badge" :title="`正则匹配: ${app.assetPattern}`">
                  {{ app.assetPattern }}
                </span>
              </div>
              <div class="detail-row">
                <span class="detail-label">检查:</span>
                <span class="detail-val" :title="`浏览器时区: ${browserTimeZone} (${timeZoneOffset})`">{{ formatTime(app.lastSyncedAt) }}</span>
              </div>
              <div v-if="app.lastSyncError" class="sync-error-banner" :title="app.lastSyncError">
                ⚠️ {{ app.lastSyncError }}
              </div>
            </div>

            <div class="app-card-stats">
              <div class="app-card-stat-item" title="客户端检查更新请求次数">
                <span class="stat-icon">📡</span>
                <span class="stat-text">请求 <strong>{{ app.checkCount || 0 }}</strong></span>
              </div>
              <div class="app-card-stat-item" title="安装包/补丁累计下载次数">
                <span class="stat-icon">📥</span>
                <span class="stat-text">下载 <strong>{{ app.downloadCount || 0 }}</strong></span>
              </div>
            </div>

            <div class="app-card-actions">
              <el-popconfirm
                title="确定删除此 App 及所有版本吗？"
                confirm-button-text="确定"
                cancel-button-text="取消"
                confirm-button-type="danger"
                @confirm="confirmDelete(app)"
              >
                <template #reference>
                  <el-button size="small" text type="danger" @click.stop>
                    删除
                  </el-button>
                </template>
              </el-popconfirm>
              <el-button
                size="small"
                type="primary"
                plain
                @click.stop="$router.push(`/apps/${app.appId}`)"
              >
                管理版本 →
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Register App Dialog -->
    <el-dialog v-model="showCreate" title="注册新 App" :width="isMobile ? '92%' : '500px'" :close-on-click-modal="false">
      <el-form :model="form" label-position="top" @submit.prevent="submitCreate">
        <el-form-item label="App ID (唯一标识符)" required>
          <el-input v-model="form.appId" placeholder="如 android-main（仅限小写字母、数字、短横线）" />
        </el-form-item>
        <el-form-item label="显示名称" required>
          <el-input v-model="form.name" placeholder="如 TCM Android 主版本" />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :xs="24" :sm="12">
            <el-form-item label="目标平台">
              <el-select v-model="form.platform" style="width:100%">
                <el-option label="🤖 Android (.apk/.aab)" value="android" />
                <el-option label="🪟 Windows (.exe/.msi)" value="windows" />
                <el-option label="🍎 macOS (.dmg/.pkg)" value="macos" />
                <el-option label="🐧 Linux (.AppImage/.deb)" value="linux" />
                <el-option label="📱 iOS (.ipa)" value="ios" />
                <el-option label="📦 其他通用" value="other" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="开启定时自动同步">
              <el-switch v-model="form.autoSync" style="margin-top: 4px" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item v-if="form.autoSync" label="自动同步周期">
          <div style="display:flex;gap:10px;width:100%">
            <el-select v-model="form.intervalPreset" style="width:160px" @change="onIntervalPresetChange">
              <el-option label="每 15 分钟" :value="15" />
              <el-option label="每 30 分钟" :value="30" />
              <el-option label="每 1 小时" :value="60" />
              <el-option label="每 2 小时" :value="120" />
              <el-option label="每 6 小时" :value="360" />
              <el-option label="每 12 小时" :value="720" />
              <el-option label="每 24 小时 (1天)" :value="1440" />
              <el-option label="自定义分钟" value="custom" />
            </el-select>
            <el-input-number
              v-if="form.intervalPreset === 'custom'"
              v-model="form.autoSyncIntervalMinutes"
              :min="5"
              :max="10080"
              style="width:160px"
              placeholder="分钟数(≥5)"
            />
          </div>
          <span class="hint">按设定的时间间隔在后台检测 GitHub 是否发布新 Release</span>
        </el-form-item>
        <el-form-item label="GitHub 仓库 (owner/repo)">
          <el-input v-model="form.githubRepo" placeholder="如 yourorg/your-repo（支持直接粘贴仓库 URL）" />
        </el-form-item>
        <el-form-item label="安装包匹配正则 (可选)">
          <el-input v-model="form.assetPattern" placeholder="选填，如 .*-win-x64\.exe$ ，留空则智能识别" />
        </el-form-item>
        <el-form-item label="GitHub API URL (默认官方)">
          <el-input v-model="form.githubApiUrl" placeholder="https://api.github.com" />
        </el-form-item>
        <el-form-item label="差分就绪策略">
          <el-select v-model="form.patchReadinessPolicy" style="width:100%">
            <el-option label="隐藏下载链接 (默认推荐，差分生成完毕前不给下载地址)" value="hide_download_link" />
            <el-option label="完全静默等待 (差分包未生成前不提示有更新)" value="silent" />
            <el-option label="回退全量包 (差分未就绪时直接提供完整全量包)" value="fallback_full" />
          </el-select>
          <span class="hint">当发布新版本但差分包尚未生成好时，控制客户端检查更新时的表现</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">立即注册</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { Refresh, Plus } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { listApps, createApp, deleteApp, syncAllApps, clearApiKey, getGlobalStats } from "../api/appHub.js";
import ThemeToggle from "../components/ThemeToggle.vue";
import {
  getBrowserTimeZone,
  getTimeZoneOffsetString,
  formatChineseTime,
} from "../utils/time.js";

const router = useRouter();
const timeZoneOffset = getTimeZoneOffsetString();
const browserTimeZone = getBrowserTimeZone();
const isMobile = ref(false);
function handleResize() {
  isMobile.value = window.innerWidth < 768;
}

const apps = ref([]);
const globalStats = ref({
  totalApps: 0,
  autoSyncApps: 0,
  totalChecks: 0,
  totalDownloads: 0,
  todayChecks: 0,
  todayDownloads: 0,
});
const loading = ref(false);
const syncingAll = ref(false);
const showCreate = ref(false);
const creating = ref(false);
const searchQuery = ref("");
const currentPlatform = ref("all");

const form = ref({
  appId: "",
  name: "",
  platform: "android",
  githubRepo: "",
  githubApiUrl: "https://api.github.com",
  autoSync: false,
  autoSyncIntervalMinutes: 60,
  intervalPreset: 60,
  assetPattern: "",
  patchReadinessPolicy: "hide_download_link",
});

function onIntervalPresetChange(val) {
  if (val !== "custom") {
    form.value.autoSyncIntervalMinutes = Number(val);
  }
}

function formatInterval(minutes) {
  const m = Number(minutes) || 60;
  if (m < 60) return `每 ${m} 分钟`;
  if (m % 60 === 0) return `每 ${m / 60} 小时`;
  return `每 ${(m / 60).toFixed(1)} 小时`;
}

const autoSyncCount = computed(() => apps.value.filter((a) => a.autoSync).length);
const platformCount = computed(() => new Set(apps.value.map((a) => a.platform)).size);

const platformFilters = computed(() => {
  const counts = { all: apps.value.length };
  for (const a of apps.value) {
    counts[a.platform] = (counts[a.platform] || 0) + 1;
  }
  return [
    { label: "全部", value: "all", count: counts.all || 0 },
    { label: "Android", value: "android", count: counts.android || 0 },
    { label: "Windows", value: "windows", count: counts.windows || 0 },
    { label: "macOS", value: "macos", count: counts.macos || 0 },
    { label: "Linux", value: "linux", count: counts.linux || 0 },
    { label: "iOS", value: "ios", count: counts.ios || 0 },
  ];
});

const filteredApps = computed(() => {
  let list = apps.value;
  if (currentPlatform.value !== "all") {
    list = list.filter((a) => a.platform === currentPlatform.value);
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase().trim();
    list = list.filter(
      (a) =>
        (a.name && a.name.toLowerCase().includes(q)) ||
        (a.appId && a.appId.toLowerCase().includes(q)) ||
        (a.githubRepo && a.githubRepo.toLowerCase().includes(q))
    );
  }
  return list;
});

function platformIcon(p) {
  return { android: "🤖", windows: "🪟", macos: "🍎", linux: "🐧", ios: "📱" }[p] || "📦";
}

function platformTagType(p) {
  return { android: "success", windows: "primary", macos: "warning", linux: "danger", ios: "info" }[p] || "info";
}

function formatTime(iso) {
  return formatChineseTime(iso);
}

async function doSyncAll() {
  syncingAll.value = true;
  try {
    const res = await syncAllApps();
    ElMessage.success(res.message || "已触发全部自动同步任务");
    await load();
  } catch (e) {
    ElMessage.error(e?.message || "批量同步失败");
  } finally {
    syncingAll.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const [appsRes, statsRes] = await Promise.all([
      listApps(),
      getGlobalStats().catch(() => ({ data: {} })),
    ]);
    apps.value = appsRes.data || [];
    if (statsRes?.data) {
      globalStats.value = statsRes.data;
    }
  } catch {
    ElMessage.error("加载 App 列表失败");
  } finally {
    loading.value = false;
  }
}

async function submitCreate() {
  if (!form.value.appId || !form.value.name) return ElMessage.warning("App ID 和名称为必填项");
  creating.value = true;
  try {
    const payload = {
      appId: form.value.appId,
      name: form.value.name,
      platform: form.value.platform,
      githubRepo: form.value.githubRepo,
      githubApiUrl: form.value.githubApiUrl,
      autoSync: form.value.autoSync,
      autoSyncIntervalMinutes: Number(form.value.autoSyncIntervalMinutes) || 60,
      assetPattern: form.value.assetPattern,
      patchReadinessPolicy: form.value.patchReadinessPolicy || "hide_download_link",
    };
    await createApp(payload);
    ElMessage.success("App 注册成功");
    showCreate.value = false;
    form.value = {
      appId: "",
      name: "",
      platform: "android",
      githubRepo: "",
      githubApiUrl: "https://api.github.com",
      autoSync: false,
      autoSyncIntervalMinutes: 60,
      intervalPreset: 60,
      assetPattern: "",
      patchReadinessPolicy: "hide_download_link",
    };
    await load();
  } catch (e) {
    ElMessage.error(e?.message || "注册失败");
  } finally {
    creating.value = false;
  }
}

async function confirmDelete(app) {
  try {
    await deleteApp(app.appId);
    ElMessage.success(`App "${app.name}" 已删除`);
    await load();
  } catch (e) {
    ElMessage.error(e?.message || "删除失败");
  }
}

function logout() {
  clearApiKey();
  router.push("/login");
}

onMounted(() => {
  handleResize();
  window.addEventListener("resize", handleResize);
  load();
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
});
</script>

<style scoped>
.page-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Navbar */
.navbar {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 12px 24px;
}

.navbar-content {
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-icon {
  font-size: 24px;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-card-border);
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--app-text-main);
  letter-spacing: -0.01em;
}

.brand-sub {
  font-size: 12px;
  color: var(--app-text-muted);
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Main */
.main-content {
  flex: 1;
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  padding: 24px;
  box-sizing: border-box;
}

/* Metric Stats Cards */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon-wrap {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-icon-wrap.blue { background: rgba(59, 130, 246, 0.12); }
.stat-icon-wrap.green { background: rgba(16, 185, 129, 0.12); }
.stat-icon-wrap.purple { background: rgba(139, 92, 246, 0.12); }
.stat-icon-wrap.amber { background: rgba(245, 158, 11, 0.12); }
.stat-icon-wrap.cyan { background: rgba(6, 182, 212, 0.12); }

.stat-label {
  font-size: 12px;
  color: var(--app-text-muted);
  margin-bottom: 4px;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--app-text-main);
}

.stat-unit {
  font-size: 13px;
  font-weight: 400;
  color: var(--app-text-muted);
}

.stat-sub-text {
  font-size: 11px;
  color: var(--app-text-muted);
  margin-top: 3px;
}

.text-success {
  color: #10b981 !important;
  font-size: 16px;
}

/* Filter bar */
.filter-bar {
  padding: 10px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.platform-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-pill {
  border: 1px solid transparent;
  background: var(--app-surface-subtle);
  color: var(--app-text-sub);
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
}

.filter-pill:hover {
  background: rgba(59, 130, 246, 0.1);
  color: var(--app-accent);
}

.filter-pill.active {
  background: var(--app-accent);
  color: #ffffff;
  border-color: var(--app-accent);
}

.pill-count {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.12);
}

html.dark .pill-count {
  background: rgba(255, 255, 255, 0.18);
}

/* Apps Grid */
.apps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 20px;
}

.empty-wrap {
  padding: 40px;
  text-align: center;
}

.app-card {
  padding: 20px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
}

.app-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.app-avatar {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-card-border);
}

.app-top-tags {
  display: flex;
  gap: 6px;
}

.app-title-area {
  margin-bottom: 14px;
}

.app-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--app-text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-id-code {
  margin-top: 4px;
}

.app-id-code code {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--app-code-bg);
  color: var(--app-accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.app-details {
  flex: 1;
  padding: 10px 0;
  border-top: 1px solid var(--app-card-border);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-label {
  color: var(--app-text-muted);
  width: 36px;
  flex-shrink: 0;
}

.detail-val {
  color: var(--app-text-sub);
}

.repo-text {
  color: var(--app-accent);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pattern-badge {
  font-family: monospace;
  color: #8b5cf6;
  background: rgba(139, 92, 246, 0.08);
  padding: 1px 6px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-error-banner {
  margin-top: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-card-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: var(--app-surface-subtle);
  border-radius: 8px;
  border: 1px solid var(--app-card-border);
}

.app-card-stat-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--app-text-muted);
}

.app-card-stat-item strong {
  color: var(--app-text-main);
  font-weight: 600;
}

.app-card-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 14px;
  margin-top: auto;
  border-top: 1px solid var(--app-card-border);
}

.btn-text-short {
  display: none;
}

@media (max-width: 768px) {
  .navbar {
    padding: 10px 14px;
  }

  .navbar-content {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .nav-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
  }

  .nav-actions .el-button {
    flex: 1;
    padding: 0 10px;
  }

  .nav-actions .logout-btn {
    flex: 0 0 auto;
    padding: 0 8px;
  }

  .main-content {
    padding: 14px 12px;
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr) !important;
    gap: 8px !important;
  }

  .stat-card {
    padding: 10px 12px;
    gap: 10px;
    border-radius: 10px;
  }

  .stat-card:last-child {
    grid-column: 1 / -1;
  }

  .stat-icon-wrap {
    width: 36px;
    height: 36px;
    font-size: 17px;
    border-radius: 8px;
  }

  .stat-label {
    font-size: 11px;
    margin-bottom: 2px;
  }

  .stat-value {
    font-size: 16px;
  }

  .stat-unit {
    font-size: 11px;
  }

  .stat-sub-text {
    font-size: 10px;
  }

  .filter-bar {
    flex-direction: column;
    align-items: stretch;
    padding: 10px 12px;
    gap: 10px;
  }

  .platform-tabs {
    overflow-x: auto;
    flex-wrap: nowrap;
    width: 100%;
    padding-bottom: 4px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .platform-tabs::-webkit-scrollbar {
    display: none;
  }

  .filter-pill {
    flex-shrink: 0;
    padding: 5px 12px;
    font-size: 12px;
  }

  .search-wrap {
    width: 100%;
  }

  .search-wrap :deep(.el-input) {
    width: 100% !important;
  }

  .apps-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .app-card {
    padding: 14px 14px;
  }
}

@media (max-width: 600px) {
  .btn-text-full {
    display: none;
  }

  .btn-text-short {
    display: inline;
  }

  .brand-title {
    font-size: 16px;
  }

  .brand-sub {
    font-size: 11px;
  }
}
</style>
