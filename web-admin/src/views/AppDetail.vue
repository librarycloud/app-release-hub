<template>
  <div class="page">
    <!-- Breadcrumb -->
    <el-breadcrumb separator="/" style="margin-bottom:16px">
      <el-breadcrumb-item :to="{ path: '/' }">所有 App</el-breadcrumb-item>
      <el-breadcrumb-item>{{ appId }}</el-breadcrumb-item>
    </el-breadcrumb>

    <!-- Toolbar -->
    <div class="toolbar">
      <div>
        <h2 style="margin:0">{{ appId }}</h2>
        <span class="sub" v-if="bsdiffAvailable">✅ bsdiff 可用</span>
        <span class="sub warn" v-else>⚠️ bsdiff 未安装，无法生成差分包</span>
      </div>
      <el-button type="primary" :loading="syncing" @click="doSync">
        🔄 同步 GitHub 最新 Release
      </el-button>
    </div>

    <div v-loading="loading">
      <el-empty v-if="versionGroups.length === 0" description="暂无版本记录，请先同步 GitHub Release" />

      <!-- Version groups -->
      <el-collapse v-model="openGroups" accordion>
        <el-collapse-item
          v-for="group in versionGroups"
          :key="group.versionCode"
          :name="String(group.versionCode)"
        >
          <template #title>
            <div class="group-title">
              <span>
                <el-tag v-if="group.isLatest" type="success" size="small" style="margin-right:6px">最新</el-tag>
                <strong>{{ group.versionName }}</strong>
                <span class="vc"> (vc: {{ group.versionCode }})</span>
              </span>
              <span class="group-stats">
                <el-tag type="info" size="small">{{ formatSize(group.size) }}</el-tag>
                <el-tag
                  :type="group.coveredCount === group.eligibleCount ? 'success' : 'warning'"
                  size="small"
                >
                  差分 {{ group.coveredCount }}/{{ group.eligibleCount }}
                </el-tag>
                <span class="date">{{ group.publishedAt }}</span>
              </span>
            </div>
          </template>

          <!-- Full download info -->
          <div class="full-info">
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="完整包大小">{{ formatSize(group.size) }}</el-descriptions-item>
              <el-descriptions-item label="发布日期">{{ group.publishedAt || "—" }}</el-descriptions-item>
              <el-descriptions-item label="SHA-256" :span="2">
                <code class="sha">{{ group.sha256 || "—" }}</code>
              </el-descriptions-item>
              <el-descriptions-item label="下载链接" :span="2">
                <a :href="group.downloadUrl" target="_blank" class="dl-link">{{ group.downloadUrl }}</a>
              </el-descriptions-item>
            </el-descriptions>
          </div>

          <!-- Release notes -->
          <div v-if="group.releaseNotes?.length" class="notes">
            <strong>更新说明：</strong>
            <ul>
              <li v-for="note in group.releaseNotes" :key="note">{{ note }}</li>
            </ul>
          </div>

          <!-- Patch table -->
          <div class="patch-section">
            <div class="patch-header">
              <strong>增量补丁 (升级到此版本)</strong>
              <el-button
                v-if="group.missingCount > 0"
                size="small"
                type="warning"
                :loading="generatingAll[group.versionCode]"
                @click="generateAll(group.versionCode)"
              >
                ⚡ 补齐全部 {{ group.missingCount }} 个缺失差分
              </el-button>
            </div>

            <el-table
              :data="group.patches"
              size="small"
              :empty-text="group.eligibleCount === 0 ? '无历史版本可升级' : '暂无差分包，点击上方按钮生成'"
            >
              <el-table-column label="从版本升级" prop="fromVersionName" width="140" />
              <el-table-column label="差分包大小">
                <template #default="{ row }">{{ formatSize(row.patchSize) }}</template>
              </el-table-column>
              <el-table-column label="节省下载">
                <template #default="{ row }">
                  <el-tag type="success" size="small">省 {{ formatSize(row.savedBytes) }} ({{ row.savedPercentage }}%)</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="生成时间" prop="createdAt" width="170" />
              <el-table-column label="操作" width="150">
                <template #default="{ row }">
                  <el-button size="small" @click="copyLink(row.patchUrl)">复制链接</el-button>
                </template>
              </el-table-column>
            </el-table>

            <!-- Missing versions list -->
            <div v-if="group.missingVersions?.length" class="missing-list">
              <span class="missing-label">缺失来源版本：</span>
              <el-tag
                v-for="mv in group.missingVersions"
                :key="mv.versionCode"
                size="small"
                type="danger"
                style="margin:2px;cursor:pointer"
                @click="generateOne(group.versionCode, mv.versionCode)"
              >
                {{ mv.versionName }} →
              </el-tag>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElNotification } from "element-plus";
import { syncRelease, getPatchMatrix, generateAllPatches, generatePatch } from "../api/appHub.js";

const route = useRoute();
const appId = route.params.appId;

const loading = ref(false);
const syncing = ref(false);
const versionGroups = ref([]);
const bsdiffAvailable = ref(true);
const openGroups = ref([]);
const generatingAll = ref({});

function formatSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function load() {
  loading.value = true;
  try {
    const res = await getPatchMatrix(appId);
    versionGroups.value = res.data?.versionGroups || [];
    bsdiffAvailable.value = res.data?.bsdiffAvailable ?? true;
    // Auto-open the latest version group
    if (versionGroups.value.length > 0) {
      openGroups.value = [String(versionGroups.value[0].versionCode)];
    }
  } catch (e) { ElMessage.error(e?.message || "加载失败"); }
  finally { loading.value = false; }
}

async function doSync() {
  syncing.value = true;
  try {
    const res = await syncRelease(appId);
    ElNotification({ title: "同步成功", message: `v${res.data?.versionName} 已同步，生成了 ${res.data?.patchesGenerated?.length || 0} 个差分包`, type: "success" });
    await load();
  } catch (e) { ElMessage.error(e?.message || "同步失败"); }
  finally { syncing.value = false; }
}

async function generateAll(targetVersionCode) {
  generatingAll.value[targetVersionCode] = true;
  try {
    const res = await generateAllPatches(appId, { targetVersionCode });
    ElMessage.success(`已生成 ${res.data?.generatedCount} 个差分包`);
    await load();
  } catch (e) { ElMessage.error(e?.message || "生成失败"); }
  finally { generatingAll.value[targetVersionCode] = false; }
}

async function generateOne(targetVersionCode, fromVersionCode) {
  try {
    await generatePatch(appId, { fromVersionCode, targetVersionCode });
    ElMessage.success(`差分包已生成 v${fromVersionCode} → v${targetVersionCode}`);
    await load();
  } catch (e) { ElMessage.error(e?.message || "生成失败"); }
}

function copyLink(url) {
  const full = url.startsWith("http") ? url : `${location.origin}${url}`;
  navigator.clipboard.writeText(full);
  ElMessage.success("已复制到剪贴板");
}

onMounted(load);
</script>

<style scoped>
.page { padding: 24px; max-width: 1100px; margin: 0 auto; }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.sub { font-size: 13px; color: #67c23a; }
.sub.warn { color: #e6a23c; }
.group-title { display: flex; align-items: center; justify-content: space-between; width: 100%; padding-right: 12px; }
.vc { color: #999; font-size: 12px; margin-left: 4px; }
.group-stats { display: flex; align-items: center; gap: 6px; }
.date { font-size: 12px; color: #aaa; }
.full-info { margin-bottom: 16px; }
.sha { font-size: 11px; word-break: break-all; }
.dl-link { color: #409eff; font-size: 12px; word-break: break-all; }
.notes ul { margin: 4px 0 0 16px; padding: 0; font-size: 13px; }
.patch-section { margin-top: 12px; }
.patch-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.missing-list { margin-top: 8px; font-size: 12px; }
.missing-label { color: #999; margin-right: 4px; }
</style>
