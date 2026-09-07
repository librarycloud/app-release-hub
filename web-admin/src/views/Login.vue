<template>
  <div class="login-wrap">
    <!-- Top right theme toggle -->
    <div class="theme-bar">
      <ThemeToggle />
    </div>

    <!-- Ambient background glows -->
    <div class="glow-orb orb-1"></div>
    <div class="glow-orb orb-2"></div>

    <el-card class="login-card modern-card" shadow="always">
      <div class="login-header">
        <div class="logo-badge">
          <span class="logo-emoji">🚀</span>
        </div>
        <h1 class="login-title">App Release Hub</h1>
        <p class="subtitle">版本分发与差分更新控制中心</p>
      </div>

      <el-form @submit.prevent="submit" class="login-form">
        <el-form-item label="管理员 API Key">
          <el-input
            v-model="key"
            type="password"
            show-password
            size="large"
            placeholder="请输入 ADMIN_API_KEY"
            autofocus
            prefix-icon="Key"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button
          type="primary"
          size="large"
          class="submit-btn"
          native-type="submit"
          :loading="loading"
        >
          立即登录
        </el-button>
      </el-form>

      <div class="login-footer">
        <span>支持多平台安装包分发 · 增量 bsdiff 差分更新</span>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { setApiKey, listApps } from "../api/appHub.js";
import ThemeToggle from "../components/ThemeToggle.vue";

const key = ref("");
const loading = ref(false);
const router = useRouter();

async function submit() {
  if (!key.value.trim()) return ElMessage.warning("请输入 API Key");
  loading.value = true;
  setApiKey(key.value.trim());
  try {
    await listApps();
    router.push("/");
  } catch (err) {
    const errorMsg =
      err?.message ||
      err?.response?.data?.message ||
      (err?.code === "ERR_NETWORK" ? "无法连接后端服务器，请确认后端已启动且网络畅通" : "API Key 无效或验证失败");
    ElMessage.error(errorMsg);
    setApiKey("");
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--app-bg-gradient);
  overflow: hidden;
  padding: 20px;
  box-sizing: border-box;
}

.theme-bar {
  position: absolute;
  top: 24px;
  right: 24px;
  z-index: 10;
}

/* Ambient glow effects */
.glow-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  opacity: 0.5;
  transition: all 0.5s ease;
}

.orb-1 {
  width: 320px;
  height: 320px;
  top: 15%;
  left: 20%;
  background: radial-gradient(circle, rgba(59, 130, 246, 0.25) 0%, transparent 70%);
}

.orb-2 {
  width: 380px;
  height: 380px;
  bottom: 15%;
  right: 20%;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.2) 0%, transparent 70%);
}

.login-card {
  width: 100%;
  max-width: 420px;
  position: relative;
  z-index: 1;
  padding: 12px 6px;
  border-radius: 16px !important;
}

.login-header {
  text-align: center;
  margin-bottom: 24px;
}

.logo-badge {
  width: 60px;
  height: 60px;
  margin: 0 auto 14px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(99, 102, 241, 0.2) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(59, 130, 246, 0.2);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.12);
}

.logo-emoji {
  font-size: 28px;
}

.login-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--app-text-main);
  letter-spacing: -0.02em;
}

.subtitle {
  font-size: 13px;
  color: var(--app-text-sub);
  margin: 6px 0 0;
  font-weight: 400;
}

.login-form {
  margin-top: 10px;
}

.submit-btn {
  width: 100%;
  margin-top: 8px;
  font-weight: 600;
  letter-spacing: 0.05em;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border: none;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
  transition: all 0.2s ease;
}

.submit-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.4);
}

.login-footer {
  text-align: center;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--app-card-border);
  font-size: 11px;
  color: var(--app-text-muted);
}
</style>
