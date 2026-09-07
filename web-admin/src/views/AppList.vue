<template>
  <div class="page">
    <div class="header">
      <div>
        <h2>🚀 App Release Hub</h2>
        <span class="sub">已注册 App</span>
      </div>
      <div style="display:flex;gap:8px">
        <el-button :loading="syncingAll" @click="doSyncAll">🔄 检查全部更新</el-button>
        <el-button type="primary" @click="showCreate = true">+ 注册新 App</el-button>
        <el-button @click="logout">退出</el-button>
      </div>
    </div>

    <el-row :gutter="16" v-loading="loading">
      <el-col v-if="apps.length === 0 && !loading" :span="24">
        <el-empty description="暂无 App，点击右上角注册第一个" />
      </el-col>
      <el-col v-for="app in apps" :key="app.appId" :xs="24" :sm="12" :md="8" :lg="6">
        <el-card class="app-card" shadow="hover" @click="$router.push(`/apps/${app.appId}`)">
          <div class="app-icon">{{ platformIcon(app.platform) }}</div>
          <div class="app-name">{{ app.name }}</div>
          <div class="app-id">
            <el-tag size="small" type="info">{{ app.appId }}</el-tag>
            <el-tag :type="app.autoSync ? 'success' : 'info'" size="small" style="margin-left:4px">
              {{ app.autoSync ? '定时同步' : '手动' }}
            </el-tag>
          </div>
          <div class="app-meta">
            <span>{{ app.platform }}</span>
            <span v-if="app.githubRepo" class="repo">{{ app.githubRepo }}</span>
            <div v-if="app.assetPattern" class="asset-pat" :title="`匹配正则: ${app.assetPattern}`">
              🔍 {{ app.assetPattern }}
            </div>
            <div v-if="app.lastSyncedAt" class="sync-time">
              最近检查: {{ formatTime(app.lastSyncedAt) }}
            </div>
            <div v-if="app.lastSyncError" class="sync-err" :title="app.lastSyncError">
              ⚠️ {{ app.lastSyncError }}
            </div>
          </div>
          <div class="app-footer">
            <el-button size="small" type="danger" plain @click.stop="confirmDelete(app)">删除</el-button>
            <el-button size="small" type="primary" plain @click.stop="$router.push(`/apps/${app.appId}`)">管理 →</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- Register App Dialog -->
    <el-dialog v-model="showCreate" title="注册新 App" width="480px" :close-on-click-modal="false">
      <el-form :model="form" label-width="120px" @submit.prevent="submitCreate">
        <el-form-item label="App ID" required>
          <el-input v-model="form.appId" placeholder="如 android-main（小写字母、数字、连字符）" />
        </el-form-item>
        <el-form-item label="显示名称" required>
          <el-input v-model="form.name" placeholder="如 TCM Android 主版本" />
        </el-form-item>
        <el-form-item label="平台">
          <el-select v-model="form.platform" style="width:100%">
            <el-option label="Android" value="android" />
            <el-option label="Windows" value="windows" />
            <el-option label="macOS" value="macos" />
            <el-option label="Linux" value="linux" />
            <el-option label="iOS" value="ios" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="匹配正则">
          <el-input v-model="form.assetPattern" placeholder="选填，如 .*-win-x64\.exe$ ，留空则智能推断" />
          <span class="hint">用于精准匹配对应平台安装包文件名</span>
        </el-form-item>
        <el-form-item label="GitHub Repo">
          <el-input v-model="form.githubRepo" placeholder="如 yourorg/your-repo" />
        </el-form-item>
        <el-form-item label="GitHub API URL">
          <el-input v-model="form.githubApiUrl" placeholder="https://api.github.com" />
        </el-form-item>
        <el-form-item label="自动同步">
          <el-switch v-model="form.autoSync" />
          <span class="hint">开启后每次有新 Release 可手动一键同步</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">注册</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { listApps, createApp, deleteApp, syncAllApps, clearApiKey } from "../api/appHub.js";

const router = useRouter();
const apps = ref([]);
const loading = ref(false);
const syncingAll = ref(false);
const showCreate = ref(false);
const creating = ref(false);
const form = ref({ appId: "", name: "", platform: "android", githubRepo: "", githubApiUrl: "https://api.github.com", autoSync: false, assetPattern: "" });

function platformIcon(p) {
  return { android: "🤖", windows: "🪟", macos: "🍎", linux: "🐧", ios: "📱" }[p] || "📦";
}

function formatTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
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
    const res = await listApps();
    apps.value = res.data || [];
  } catch { ElMessage.error("加载失败"); }
  finally { loading.value = false; }
}

async function submitCreate() {
  if (!form.value.appId || !form.value.name) return ElMessage.warning("App ID 和名称必填");
  creating.value = true;
  try {
    await createApp(form.value);
    ElMessage.success("注册成功");
    showCreate.value = false;
    form.value = { appId: "", name: "", platform: "android", githubRepo: "", githubApiUrl: "https://api.github.com", autoSync: false, assetPattern: "" };
    await load();
  } catch (e) { ElMessage.error(e?.message || "注册失败"); }
  finally { creating.value = false; }
}

async function confirmDelete(app) {
  await ElMessageBox.confirm(`确定删除 App "${app.name}" (${app.appId})？数据库记录将被删除，文件需手动清理。`, "警告", { type: "warning" });
  try {
    await deleteApp(app.appId);
    ElMessage.success("已删除");
    await load();
  } catch (e) { ElMessage.error(e?.message || "删除失败"); }
}

function logout() {
  clearApiKey();
  router.push("/login");
}

onMounted(load);
</script>

<style scoped>
.page { padding: 24px; max-width: 1200px; margin: 0 auto; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.header h2 { margin: 0; font-size: 22px; }
.sub { color: #999; font-size: 13px; }
.app-card { cursor: pointer; transition: transform .15s; }
.app-card:hover { transform: translateY(-2px); }
.app-icon { font-size: 32px; text-align: center; margin-bottom: 8px; }
.app-name { font-size: 16px; font-weight: 600; text-align: center; }
.app-id { text-align: center; margin: 6px 0; }
.app-meta { font-size: 12px; color: #999; text-align: center; }
.repo { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-footer { display: flex; justify-content: space-between; margin-top: 12px; }
.hint { font-size: 12px; color: #999; margin-left: 8px; }
.sync-time { font-size: 11px; color: #888; margin-top: 4px; }
.sync-err { font-size: 11px; color: #f56c6c; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-pat { font-size: 11px; color: #409eff; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; }
</style>
