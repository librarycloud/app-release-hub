<template>
  <div class="page">
    <!-- Top Breadcrumb Bar -->
    <div class="breadcrumb-bar">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item :to="{ path: '/' }">🏠 所有 App</el-breadcrumb-item>
        <el-breadcrumb-item :to="{ path: `/apps/${appId}` }">{{ appInfo?.name || appId }}</el-breadcrumb-item>
        <el-breadcrumb-item>活跃设备</el-breadcrumb-item>
      </el-breadcrumb>
      <ThemeToggle />
    </div>

    <!-- Toolbar -->
    <div class="toolbar modern-card">
      <div class="toolbar-header">
        <div class="app-identity">
          <div class="app-title-block">
            <div class="app-title-line">
              <h2 class="app-title-text">活跃设备管理</h2>
              <el-tag size="small" type="info" round>{{ appDevicesList.length }} 台设备</el-tag>
            </div>
          </div>
        </div>
        <div class="toolbar-actions">
          <el-button @click="loadDevices" :loading="loadingDevices">
            🔄 刷新列表
          </el-button>
        </div>
      </div>
    </div>

    <!-- Devices Table -->
    <div class="modern-card table-card" v-loading="loadingDevices">
      <el-table
        :data="appDevicesList"
        style="width: 100%"
        :max-height="tableHeight"
      >
        <el-table-column prop="deviceId" label="Device ID" width="220" show-overflow-tooltip />
        <el-table-column prop="deviceModel" label="机型" min-width="120">
          <template #default="{ row }">
            {{ row.deviceModel || '未知' }}
          </template>
        </el-table-column>
        <el-table-column prop="osVersion" label="系统版本" min-width="100">
          <template #default="{ row }">
            {{ row.osVersion || '未知' }}
          </template>
        </el-table-column>
        <el-table-column label="当前版本" width="120">
          <template #default="{ row }">
            <el-tag size="small" type="primary">{{ row.versionCode }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最后活跃时间" width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.lastSeenAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right" align="center">
          <template #default="{ row }">
            <el-button
              type="danger"
              size="small"
              text
              @click="handleDeleteDevice(row.deviceId)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无活跃设备记录" />
        </template>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import ThemeToggle from "../components/ThemeToggle.vue";
import { listApps, getAppDevices, deleteAppDevice } from "../api/appHub.js";

const route = useRoute();
const appId = route.params.appId;

const appInfo = ref(null);
const appDevicesList = ref([]);
const loadingDevices = ref(false);
const tableHeight = ref(window.innerHeight - 250);

function handleResize() {
  tableHeight.value = window.innerHeight - 250;
}

onMounted(async () => {
  window.addEventListener("resize", handleResize);
  loadAppInfo();
  loadDevices();
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
});

async function loadAppInfo() {
  try {
    const appsRes = await listApps();
    appInfo.value = (appsRes.data || []).find((a) => a.appId === appId) || null;
  } catch (e) {
    console.error("Failed to load app info", e);
  }
}

async function loadDevices() {
  loadingDevices.value = true;
  try {
    const res = await getAppDevices(appId);
    appDevicesList.value = res.data || [];
  } catch (e) {
    ElMessage.error(e?.message || "获取设备列表失败");
  } finally {
    loadingDevices.value = false;
  }
}

async function handleDeleteDevice(deviceId) {
  try {
    await ElMessageBox.confirm(`确定要删除设备 ${deviceId} 吗？\n删除后如果该设备再次请求，会被作为新设备重新记录。`, "提示", {
      confirmButtonText: "确定删除",
      cancelButtonText: "取消",
      type: "warning",
    });
    
    loadingDevices.value = true;
    await deleteAppDevice(appId, deviceId);
    ElMessage.success("删除成功");
    await loadDevices();
  } catch (e) {
    if (e !== "cancel") {
      ElMessage.error(e?.message || "删除失败");
    }
  } finally {
    loadingDevices.value = false;
  }
}

function formatDateTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "Z");
  if (isNaN(d.getTime())) return dateStr;
  
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
</script>

<style scoped>
.page {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.breadcrumb-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.modern-card {
  background: var(--app-surface);
  border: 1px solid var(--app-card-border);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
}

.toolbar {
  padding: 20px;
  margin-bottom: 20px;
}

.toolbar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.app-title-line {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-title-text {
  margin: 0;
  font-size: 20px;
  color: var(--app-text-main);
}

.table-card {
  padding: 20px;
}

@media (max-width: 768px) {
  .page {
    padding: 14px;
  }
  
  .toolbar-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
  
  .toolbar-actions {
    width: 100%;
  }
  
  .toolbar-actions .el-button {
    width: 100%;
  }
  
  .table-card {
    padding: 10px;
  }
}
</style>
