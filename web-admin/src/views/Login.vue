<template>
  <div class="login-wrap">
    <el-card class="login-card" shadow="always">
      <template #header>
        <div class="login-title">
          <span>🚀 App Release Hub</span>
          <p class="subtitle">管理后台</p>
        </div>
      </template>
      <el-form @submit.prevent="submit">
        <el-form-item label="Admin API Key">
          <el-input
            v-model="key"
            type="password"
            show-password
            placeholder="输入 ADMIN_API_KEY"
            autofocus
          />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="loading" style="width:100%">
          登录
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { setApiKey, listApps } from "../api/appHub.js";

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
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f2f5;
}
.login-card { width: 380px; }
.login-title { text-align: center; font-size: 18px; font-weight: 600; }
.subtitle { font-size: 13px; color: #999; margin: 4px 0 0; font-weight: 400; }
</style>
