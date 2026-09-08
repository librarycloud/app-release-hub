<template>
  <div class="share-container">
    <div class="theme-bar">
      <ThemeToggle />
    </div>

    <div v-if="loading" class="loading-wrap">
      <el-icon class="is-loading" :size="36"><Loading /></el-icon>
      <div style="margin-top: 12px; color: var(--text-secondary)">正在加载应用信息...</div>
    </div>

    <!-- Private App Auth Dialog / Card -->
    <div v-else-if="needToken" class="auth-card modern-card glass-panel">
      <div class="auth-icon">🔒</div>
      <h2>私有应用访问验证</h2>
      <p class="auth-desc"><strong>{{ appMeta.name || appMeta.appId }}</strong> 已开启私有保护，请输入客户端访问 Token 后查看并下载应用。</p>
      
      <div class="auth-form">
        <el-input
          v-model="inputToken"
          type="password"
          placeholder="请输入访问 Token"
          show-password
          @keyup.enter="verifyToken"
          style="margin-bottom: 16px"
        />
        <el-button type="primary" size="large" style="width: 100%" :loading="verifying" @click="verifyToken">
          验证并解锁
        </el-button>
      </div>
    </div>

    <!-- No Release Yet -->
    <div v-else-if="!shareData || !shareData.hasRelease" class="empty-card modern-card glass-panel">
      <div class="platform-avatar">{{ getPlatformIcon(shareData?.platform) }}</div>
      <h2>{{ shareData?.name || appId }}</h2>
      <el-tag :type="getPlatformTagType(shareData?.platform)" style="margin-top: 6px">
        {{ (shareData?.platform || "APP").toUpperCase() }}
      </el-tag>
      <p style="margin-top: 24px; color: var(--text-secondary)">该应用暂无可供下载的已发布版本</p>
    </div>

    <!-- Main Download Card -->
    <div v-else class="download-card modern-card glass-panel">
      <div class="app-header">
        <div class="platform-avatar">{{ getPlatformIcon(shareData.platform) }}</div>
        <div class="app-info">
          <div class="app-title-row">
            <h1 class="app-name">{{ shareData.name }}</h1>
            <el-tag v-if="shareData.isPrivate" size="small" type="danger" effect="plain">🔒 私有</el-tag>
          </div>
          <div class="app-sub-row">
            <el-tag :type="getPlatformTagType(shareData.platform)" size="small">
              {{ shareData.platform.toUpperCase() }}
            </el-tag>
            <span class="version-name">v{{ shareData.version.versionName }}</span>
            <span class="version-code">(Build {{ shareData.version.versionCode }})</span>
          </div>
        </div>
      </div>

      <div class="meta-strip">
        <div class="meta-item">
          <span class="meta-label">文件大小</span>
          <span class="meta-val">{{ formatSize(shareData.version.size) }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">更新时间</span>
          <span class="meta-val">{{ shareData.version.publishedAt || "近期" }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">发布通道</span>
          <span class="meta-val">{{ shareData.channel || "stable" }}</span>
        </div>
      </div>

      <!-- Action Area -->
      <div class="action-wrap">
        <el-button
          type="primary"
          size="large"
          class="download-btn"
          :icon="Download"
          @click="handleInstallClick"
        >
          {{ isIos ? "一键安装到 iOS 设备" : "立即下载安装包" }}
        </el-button>

        <el-button
          size="large"
          class="copy-btn"
          @click="copyDownloadLink"
        >
          复制下载链接
        </el-button>
      </div>

      <!-- QR Code Section -->
      <div class="qr-section">
        <div class="qr-box">
          <qrcode-vue :value="currentShareUrl" :size="150" level="H" render-as="svg" />
        </div>
        <div class="qr-tip">
          <div class="qr-title">📱 手机扫码安装</div>
          <div class="qr-sub">支持手机系统相机或浏览器直接扫码下载</div>
        </div>
      </div>

      <!-- Release Notes -->
      <div v-if="shareData.version.releaseNotes && shareData.version.releaseNotes.length > 0" class="notes-card">
        <div class="notes-title">📝 更新日志</div>
        <ul class="notes-list">
          <li v-for="(note, idx) in shareData.version.releaseNotes" :key="idx">
            {{ note }}
          </li>
        </ul>
      </div>

      <div v-if="shareData.version.sha256" class="sha-box">
        <span class="sha-label">SHA-256:</span>
        <code class="sha-text">{{ shareData.version.sha256 }}</code>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { Download, Loading } from "@element-plus/icons-vue";
import QrcodeVue from "qrcode.vue";
import ThemeToggle from "../components/ThemeToggle.vue";

const route = useRoute();
const appId = computed(() => route.params.appId);

const loading = ref(true);
const needToken = ref(false);
const verifying = ref(false);
const inputToken = ref("");
const shareData = ref(null);
const appMeta = ref({});

const currentShareUrl = computed(() => {
  return window.location.href;
});

const isIos = computed(() => {
  return shareData.value?.platform === "ios";
});

function getPlatformIcon(p) {
  return { android: "🤖", windows: "🪟", macos: "🍎", linux: "🐧", ios: "📱", wgt: "⚡", rn: "⚛️" }[p] || "📦";
}

function getPlatformTagType(p) {
  return { android: "success", windows: "primary", macos: "warning", linux: "danger", ios: "info", wgt: "warning", rn: "primary" }[p] || "info";
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return "未知大小";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

async function loadShareInfo(token = "") {
  loading.value = true;
  try {
    const query = new URLSearchParams();
    if (token) query.set("token", token);
    if (route.query.channel) query.set("channel", route.query.channel);

    const res = await fetch(`/api/apps/${appId.value}/share?${query.toString()}`);
    const json = await res.json();

    if (res.status === 403 || json.code === 403) {
      needToken.value = true;
      appMeta.value = json.data || {};
      shareData.value = null;
      return;
    }

    if (json.code !== 0) {
      throw new Error(json.message || "获取应用信息失败");
    }

    needToken.value = false;
    shareData.value = json.data;
  } catch (err) {
    ElMessage.error(err.message || "加载失败");
  } finally {
    loading.value = false;
  }
}

async function verifyToken() {
  if (!inputToken.value.trim()) {
    return ElMessage.warning("请输入访问 Token");
  }
  verifying.value = true;
  await loadShareInfo(inputToken.value.trim());
  verifying.value = false;
}

function handleInstallClick() {
  if (!shareData.value || !shareData.value.version) return;

  if (isIos.value && shareData.value.version.iosPlistUrl) {
    // iOS Safari ITMS OTA
    const fullPlistUrl = window.location.origin + shareData.value.version.iosPlistUrl;
    const itmsUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(fullPlistUrl)}`;
    window.location.href = itmsUrl;
  } else if (shareData.value.version.downloadUrl) {
    const url = shareData.value.version.downloadUrl.startsWith("http")
      ? shareData.value.version.downloadUrl
      : window.location.origin + shareData.value.version.downloadUrl;
    window.location.href = url;
  }
}

function copyDownloadLink() {
  if (!shareData.value || !shareData.value.version) return;
  const link = isIos.value
    ? `${window.location.origin}${shareData.value.version.iosPlistUrl}`
    : (shareData.value.version.downloadUrl.startsWith("http")
        ? shareData.value.version.downloadUrl
        : `${window.location.origin}${shareData.value.version.downloadUrl}`);

  navigator.clipboard.writeText(link).then(() => {
    ElMessage.success("下载链接已复制到剪贴板");
  }).catch(() => {
    ElMessage.info("请长按复制链接");
  });
}

onMounted(() => {
  const initialToken = route.query.token || "";
  if (initialToken) inputToken.value = initialToken;
  loadShareInfo(initialToken);
});
</script>

<style scoped>
.share-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: var(--bg-body, #0f172a);
  background-image: radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.15) 0px, transparent 50%),
                    radial-gradient(at 100% 100%, rgba(168, 85, 247, 0.15) 0px, transparent 50%);
  position: relative;
}

.theme-bar {
  position: absolute;
  top: 16px;
  right: 16px;
}

.loading-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--primary, #6366f1);
}

.download-card, .auth-card, .empty-card {
  width: 100%;
  max-width: 480px;
  border-radius: 20px;
  padding: 32px 24px;
  background: var(--bg-card, rgba(30, 41, 59, 0.75));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
}

.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.platform-avatar {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2));
  border: 1px solid rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  flex-shrink: 0;
}

.app-info {
  flex: 1;
  min-width: 0;
}

.app-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.app-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary, #f8fafc);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-sub-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.version-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary, #f8fafc);
}

.version-code {
  font-size: 13px;
  color: var(--text-secondary, #94a3b8);
}

.meta-strip {
  display: flex;
  justify-content: space-around;
  padding: 12px 0;
  background: var(--bg-hover, rgba(255, 255, 255, 0.04));
  border-radius: 12px;
  margin-bottom: 24px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.meta-label {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

.meta-val {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #f8fafc);
}

.action-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.download-btn {
  height: 48px;
  font-size: 16px;
  font-weight: 600;
  border-radius: 12px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border: none;
  box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
}

.download-btn:hover {
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
}

.copy-btn {
  height: 40px;
  border-radius: 12px;
  font-size: 14px;
}

.qr-section {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 16px;
  background: var(--bg-hover, rgba(255, 255, 255, 0.03));
  border-radius: 14px;
  margin-bottom: 24px;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.06));
}

.qr-box {
  background: #ffffff;
  padding: 8px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.qr-tip {
  flex: 1;
}

.qr-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #f8fafc);
  margin-bottom: 4px;
}

.qr-sub {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  line-height: 1.5;
}

.notes-card {
  background: var(--bg-hover, rgba(255, 255, 255, 0.03));
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.notes-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #94a3b8);
  margin-bottom: 8px;
}

.notes-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary, #f8fafc);
  max-height: 250px;
  overflow-y: auto;
}

.sha-box {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  word-break: break-all;
}

.sha-text {
  font-family: monospace;
  background: rgba(0, 0, 0, 0.2);
  padding: 2px 4px;
  border-radius: 4px;
}

.auth-card, .empty-card {
  text-align: center;
  align-items: center;
}

.auth-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.auth-desc {
  font-size: 14px;
  color: var(--text-secondary, #94a3b8);
  margin-bottom: 24px;
  line-height: 1.5;
}

.auth-form {
  width: 100%;
}
</style>
