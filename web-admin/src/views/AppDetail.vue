<template>
  <div class="page">
    <!-- Top Breadcrumb Bar -->
    <div class="breadcrumb-bar">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item :to="{ path: '/' }">🏠 所有 App</el-breadcrumb-item>
        <el-breadcrumb-item>{{ appInfo?.name || appId }}</el-breadcrumb-item>
      </el-breadcrumb>
      <ThemeToggle />
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
      <div>
        <div style="display:flex;align-items:center;gap:10px">
          <h2 style="margin:0">{{ appInfo?.name || appId }}</h2>
          <el-tag size="small" type="info">{{ appId }}</el-tag>
          <el-tag size="small">{{ appInfo?.platform || 'android' }}</el-tag>
        </div>
        <div class="sub-row">
          <span v-if="appInfo?.githubRepo" class="repo-link">
            📦 {{ appInfo.githubRepo }}
          </span>
          <span v-if="appInfo?.assetPattern" class="sub" style="color:#409eff">
            🔍 匹配正则: <code>{{ appInfo.assetPattern }}</code>
          </span>
          <span class="sub" v-if="bsdiffAvailable">✅ bsdiff 可用</span>
          <span class="sub warn" v-else>⚠️ bsdiff 未安装，无法生成差分包</span>
          <span v-if="appInfo?.lastSyncedAt" class="sub">
            最近检查: {{ formatTime(appInfo.lastSyncedAt) }}
          </span>
          <span v-if="appInfo?.lastSyncError" class="sub warn">
            ⚠️ {{ appInfo.lastSyncError }}
          </span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px" v-if="appInfo">
          <span style="font-size:13px;color:#666">定时同步:</span>
          <el-switch v-model="appInfo.autoSync" @change="toggleAutoSync" />
        </div>
        <el-button @click="openEditDialog">
          ⚙️ 配置
        </el-button>
        <el-button @click="openSyncHistoryDialog">
          📥 批量导入历史
        </el-button>
        <el-button @click="openManualVersionDialog">
          ➕ 补录旧版本
        </el-button>
        <el-button type="primary" :loading="syncing" @click="doSync">
          🔄 同步最新 Release
        </el-button>
      </div>
    </div>

    <div v-loading="loading">
      <el-empty v-if="versionGroups.length === 0" description="暂无版本记录">
        <div style="display:flex;gap:12px;justify-content:center;margin-top:12px">
          <el-button type="primary" :loading="syncing" @click="doSync">🔄 同步最新 Release</el-button>
          <el-button @click="openSyncHistoryDialog">📥 批量导入 GitHub 历史</el-button>
          <el-button @click="openManualVersionDialog">➕ 手动补录旧版本</el-button>
        </div>
      </el-empty>

      <!-- Version groups -->
      <el-collapse v-model="openGroups" accordion>
        <el-collapse-item
          v-for="group in versionGroups"
          :key="group.versionCode"
          :name="String(group.versionCode)"
        >
          <template #title>
            <div class="group-title">
              <span style="display:flex;align-items:center;gap:6px">
                <el-tag v-if="group.isLatest" type="success" size="small">最新</el-tag>
                <el-tag v-if="group.forceUpdate" type="danger" size="small">强制更新</el-tag>
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

          <!-- Version action & config toolbar -->
          <div class="version-toolbar">
            <div class="version-controls">
              <div class="ctrl-item">
                <span class="ctrl-label">强制更新:</span>
                <el-switch
                  v-model="group.forceUpdate"
                  :loading="updatingVersion[group.versionCode]"
                  active-text="开启"
                  inactive-text="关闭"
                  @change="(val) => handleToggleForceUpdate(group, val)"
                />
              </div>
              <div class="ctrl-item">
                <span class="ctrl-label">最低兼容版本:</span>
                <el-input-number
                  v-model="group.minVersionCode"
                  :min="1"
                  :max="group.versionCode"
                  size="small"
                  style="width:110px"
                />
                <el-button
                  size="small"
                  type="primary"
                  plain
                  :loading="updatingVersion[group.versionCode]"
                  @click="handleSaveMinVersionCode(group)"
                >
                  保存
                </el-button>
                <el-tooltip content="低于此 versionCode 的旧客户端请求此更新时将被标记为强制更新" placement="top">
                  <span class="help-icon">ℹ️</span>
                </el-tooltip>
              </div>
            </div>

            <el-button
              type="danger"
              size="small"
              plain
              :loading="deletingVersion[group.versionCode]"
              @click="handleDeleteVersion(group)"
            >
              🗑️ 删除此版本
            </el-button>
          </div>

          <!-- Full download info -->
          <div class="full-info">
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="完整包大小">{{ formatSize(group.size) }}</el-descriptions-item>
              <el-descriptions-item label="发布日期">{{ group.publishedAt || "—" }}</el-descriptions-item>
              <el-descriptions-item label="强制更新状态">
                <el-tag :type="group.forceUpdate ? 'danger' : 'info'" size="small">
                  {{ group.forceUpdate ? '已开启（所有用户强制更新）' : '未开启（常规更新）' }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="最低兼容版本">
                <span>vc &ge; {{ group.minVersionCode || 1 }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="SHA-256" :span="2">
                <code class="sha">{{ group.sha256 || "—" }}</code>
              </el-descriptions-item>
              <el-descriptions-item label="下载链接" :span="2">
                <a :href="group.downloadUrl" target="_blank" class="dl-link">{{ group.downloadUrl }}</a>
              </el-descriptions-item>
            </el-descriptions>
          </div>

          <!-- Release notes -->
          <div class="notes-section">
            <div class="notes-header">
              <span class="notes-title">📝 更新说明</span>
              <el-button size="small" type="primary" link @click="openEditNotes(group)">
                ✏️ 编辑更新说明
              </el-button>
            </div>
            <ul v-if="group.releaseNotes?.length" class="notes-list">
              <li v-for="note in group.releaseNotes" :key="note">{{ note }}</li>
            </ul>
            <div v-else class="empty-notes">
              暂无更新说明，点击上方“编辑更新说明”添加
            </div>
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
              <el-table-column label="从版本升级" prop="fromVersionName" width="130" />
              <el-table-column label="差分包大小">
                <template #default="{ row }">{{ formatSize(row.patchSize) }}</template>
              </el-table-column>
              <el-table-column label="节省下载">
                <template #default="{ row }">
                  <el-tag type="success" size="small">省 {{ formatSize(row.savedBytes) }} ({{ row.savedPercentage }}%)</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="生成时间" prop="createdAt" width="160" />
              <el-table-column label="操作" width="190">
                <template #default="{ row }">
                  <div style="display:flex;align-items:center;gap:6px">
                    <el-button size="small" @click="copyLink(row.patchUrl)">复制链接</el-button>
                    <el-popover
                      v-if="row.cumulativeReleaseNotes && row.cumulativeReleaseNotes.length > 0"
                      placement="left"
                      :width="360"
                      trigger="click"
                    >
                      <template #reference>
                        <el-button size="small" type="info" plain>说明叠加</el-button>
                      </template>
                      <div style="font-weight:600;margin-bottom:8px;font-size:13px">
                        从 {{ row.fromVersionName }} 升级将收到的叠加说明 ({{ row.cumulativeReleaseNotes.length }} 条)：
                      </div>
                      <div style="max-height:240px;overflow-y:auto">
                        <ul style="margin:0;padding-left:16px;font-size:12px;line-height:1.7;color:#333">
                          <li v-for="(item, idx) in row.cumulativeReleaseNotes" :key="idx">{{ item }}</li>
                        </ul>
                      </div>
                    </el-popover>
                  </div>
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

    <!-- Edit Release Notes Dialog -->
    <el-dialog
      v-model="showEditNotesDialog"
      :title="`编辑更新说明 - ${currentEditGroup?.versionName} (vc: ${currentEditGroup?.versionCode})`"
      width="560px"
      :close-on-click-modal="false"
    >
      <div style="margin-bottom:12px;font-size:13px;color:#606266">
        💡 每行输入一条更新说明，空行将被自动忽略。用户跨版本升级时，系统将按版本自动叠加合并。
      </div>
      <el-input
        v-model="editNotesContent"
        type="textarea"
        :rows="8"
        placeholder="例如：
优化网络连接速度
修复部分机型闪退
新增中药智能配方校对"
      />
      <template #footer>
        <el-button @click="showEditNotesDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingNotes" @click="saveReleaseNotes">
          保存更新说明
        </el-button>
      </template>
    </el-dialog>

    <!-- Edit App Config Dialog -->
    <el-dialog v-model="showEditDialog" title="编辑 App 配置" width="500px" :close-on-click-modal="false">
      <el-form :model="editForm" label-width="120px" @submit.prevent="submitEditApp">
        <el-form-item label="显示名称" required>
          <el-input v-model="editForm.name" placeholder="如 TCM Android 主版本" />
        </el-form-item>
        <el-form-item label="平台">
          <el-select v-model="editForm.platform" style="width:100%">
            <el-option label="Android" value="android" />
            <el-option label="Windows" value="windows" />
            <el-option label="macOS" value="macos" />
            <el-option label="Linux" value="linux" />
            <el-option label="iOS" value="ios" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="匹配正则">
          <el-input v-model="editForm.assetPattern" placeholder="选填，如 .*-win-x64\.exe$ ，留空则智能推断" />
          <span class="hint">用于精准匹配对应平台安装包文件名</span>
        </el-form-item>
        <el-form-item label="GitHub Repo">
          <el-input v-model="editForm.githubRepo" placeholder="如 yourorg/your-repo" />
        </el-form-item>
        <el-form-item label="GitHub API URL">
          <el-input v-model="editForm.githubApiUrl" placeholder="https://api.github.com" />
        </el-form-item>
        <el-form-item label="自动同步">
          <el-switch v-model="editForm.autoSync" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingApp" @click="submitEditApp">保存配置</el-button>
      </template>
    </el-dialog>

    <!-- Sync Historical Releases Dialog -->
    <el-dialog
      v-model="showSyncHistoryDialog"
      title="批量导入 GitHub 历史版本"
      width="520px"
      :close-on-click-modal="false"
    >
      <div style="margin-bottom:16px;font-size:13px;color:#606266;line-height:1.6">
        💡 系统将扫描并同步 <strong>{{ appInfo?.githubRepo || appId }}</strong> 历史 Releases，自动下载安装包与元数据，并安全维护版本序列（不会错误覆盖现有更高版本）。
      </div>
      <el-form label-width="130px">
        <el-form-item label="扫描数量上限">
          <el-input-number v-model="syncHistoryForm.limit" :min="1" :max="100" style="width:160px" />
          <span style="font-size:12px;color:#909399;margin-left:10px">最近 1~100 个 Release</span>
        </el-form-item>
        <el-form-item label="自动生成差分">
          <el-switch v-model="syncHistoryForm.autoGeneratePatches" active-text="开启" inactive-text="关闭" />
          <span style="font-size:12px;color:#909399;margin-left:10px">导入后自动生成向最新版的差分包</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSyncHistoryDialog = false">取消</el-button>
        <el-button type="primary" :loading="syncingHistory" @click="submitSyncHistory">
          开始批量导入
        </el-button>
      </template>
    </el-dialog>

    <!-- Manual Version Backfill Dialog -->
    <el-dialog
      v-model="showManualVersionDialog"
      title="手动补录历史版本"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form label-width="120px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="Version Code" required>
              <el-input-number
                v-model="manualForm.versionCode"
                :min="1"
                placeholder="如 10200"
                style="width:100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="Version Name" required>
              <el-input v-model="manualForm.versionName" placeholder="如 1.2.0" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="发布日期">
              <el-date-picker
                v-model="manualForm.publishedAt"
                type="date"
                placeholder="选择发布日期"
                value-format="YYYY-MM-DD"
                style="width:100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="最低兼容版本">
              <el-input-number
                v-model="manualForm.minVersionCode"
                :min="1"
                placeholder="默认 1"
                style="width:100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="强制更新">
          <el-switch v-model="manualForm.forceUpdate" active-text="开启" inactive-text="关闭" />
          <span style="font-size:12px;color:#909399;margin-left:12px">开启后低于此版本的用户必须升级</span>
        </el-form-item>

        <el-form-item label="安装包提供方式">
          <el-radio-group v-model="manualPackageMode">
            <el-radio-button label="file">本地上传安装包</el-radio-button>
            <el-radio-button label="url">填写下载 URL / 留空探测</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item v-if="manualPackageMode === 'file'" label="安装包文件">
          <el-upload
            ref="manualUploadRef"
            :auto-upload="false"
            :limit="1"
            :on-change="handleFileChange"
            :on-remove="() => { manualFile = null; }"
            drag
            style="width:100%"
          >
            <div class="el-upload__text">将安装包拖到此处，或 <em>点击选取文件</em></div>
            <template #tip>
              <div class="el-upload__tip">支持 APK、AAB、EXE、DMG、ZIP 等格式，系统将自动计算 SHA-256 与文件大小</div>
            </template>
          </el-upload>
        </el-form-item>

        <template v-else>
          <el-form-item label="文件 URL / 路径">
            <el-input v-model="manualForm.fileUrl" placeholder="如 https://example.com/app-v1.2.0.apk 或留空自动寻找已存在文件" />
          </el-form-item>
          <el-row :gutter="16">
            <el-col :span="14">
              <el-form-item label="文件 SHA-256">
                <el-input v-model="manualForm.sha256" placeholder="选填，64位哈希" />
              </el-form-item>
            </el-col>
            <el-col :span="10">
              <el-form-item label="大小 (字节)">
                <el-input-number v-model="manualForm.size" :min="0" placeholder="选填" style="width:100%" />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <el-form-item label="更新说明">
          <el-input
            v-model="manualForm.releaseNotes"
            type="textarea"
            :rows="4"
            placeholder="每行输入一条说明，例如：&#10;修复历史版本闪退问题&#10;新增数据同步支持"
          />
        </el-form-item>

        <el-form-item label="Changelog 链接">
          <el-input v-model="manualForm.changelogUrl" placeholder="选填，如 https://github.com/.../compare/..." />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showManualVersionDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingManualVersion" @click="submitManualVersion">
          确认补录
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElNotification, ElMessageBox } from "element-plus";
import ThemeToggle from "../components/ThemeToggle.vue";
import {
  listApps,
  updateApp,
  syncRelease,
  syncHistoryReleases,
  createVersion,
  getPatchMatrix,
  generateAllPatches,
  generatePatch,
  updateVersion,
  deleteVersion,
} from "../api/appHub.js";

const route = useRoute();
const appId = route.params.appId;

const appInfo = ref(null);
const loading = ref(false);
const syncing = ref(false);
const versionGroups = ref([]);
const bsdiffAvailable = ref(true);
const openGroups = ref([]);
const generatingAll = ref({});
const updatingVersion = ref({});
const deletingVersion = ref({});
const showEditNotesDialog = ref(false);
const currentEditGroup = ref(null);
const editNotesContent = ref("");
const savingNotes = ref(false);

const showEditDialog = ref(false);
const savingApp = ref(false);
const editForm = ref({
  name: "",
  platform: "android",
  githubRepo: "",
  githubApiUrl: "https://api.github.com",
  assetPattern: "",
  autoSync: false,
});

// Sync history dialog
const showSyncHistoryDialog = ref(false);
const syncingHistory = ref(false);
const syncHistoryForm = ref({
  limit: 20,
  autoGeneratePatches: false,
});

// Manual version dialog
const showManualVersionDialog = ref(false);
const savingManualVersion = ref(false);
const manualPackageMode = ref("file"); // "file" | "url"
const manualUploadRef = ref(null);
const manualFile = ref(null);
const manualForm = ref({
  versionCode: null,
  versionName: "",
  publishedAt: new Date().toISOString().slice(0, 10),
  forceUpdate: false,
  minVersionCode: 1,
  fileUrl: "",
  sha256: "",
  size: null,
  releaseNotes: "",
  changelogUrl: "",
});

function openEditDialog() {
  if (!appInfo.value) return;
  editForm.value = {
    name: appInfo.value.name || "",
    platform: appInfo.value.platform || "android",
    githubRepo: appInfo.value.githubRepo || "",
    githubApiUrl: appInfo.value.githubApiUrl || "https://api.github.com",
    assetPattern: appInfo.value.assetPattern || "",
    autoSync: Boolean(appInfo.value.autoSync),
  };
  showEditDialog.value = true;
}

async function submitEditApp() {
  if (!editForm.value.name) return ElMessage.warning("名称不能为空");
  savingApp.value = true;
  try {
    await updateApp(appId, editForm.value);
    ElMessage.success("App 配置已更新");
    showEditDialog.value = false;
    await load();
  } catch (err) {
    ElMessage.error(err?.message || "更新失败");
  } finally {
    savingApp.value = false;
  }
}

function formatSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
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

async function load() {
  loading.value = true;
  try {
    const [matrixRes, appsRes] = await Promise.all([
      getPatchMatrix(appId),
      listApps(),
    ]);
    versionGroups.value = matrixRes.data?.versionGroups || [];
    bsdiffAvailable.value = matrixRes.data?.bsdiffAvailable ?? true;
    appInfo.value = (appsRes.data || []).find((a) => a.appId === appId) || null;

    // Auto-open the latest version group
    if (versionGroups.value.length > 0 && openGroups.value.length === 0) {
      openGroups.value = [String(versionGroups.value[0].versionCode)];
    }
  } catch (e) { ElMessage.error(e?.message || "加载失败"); }
  finally { loading.value = false; }
}

async function toggleAutoSync(val) {
  try {
    await updateApp(appId, { autoSync: val });
    ElMessage.success(val ? "已开启定时自动检测" : "已关闭定时自动检测");
  } catch (e) {
    ElMessage.error(e?.message || "更新设置失败");
    if (appInfo.value) appInfo.value.autoSync = !val;
  }
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

async function handleToggleForceUpdate(group, val) {
  const vCode = group.versionCode;
  updatingVersion.value[vCode] = true;
  try {
    await updateVersion(appId, vCode, { forceUpdate: val });
    ElMessage.success(val ? `v${group.versionName} 已设为强制更新` : `v${group.versionName} 已设为常规更新`);
  } catch (e) {
    ElMessage.error(e?.message || "更新设置失败");
    group.forceUpdate = !val;
  } finally {
    updatingVersion.value[vCode] = false;
  }
}

async function handleSaveMinVersionCode(group) {
  const vCode = group.versionCode;
  updatingVersion.value[vCode] = true;
  try {
    await updateVersion(appId, vCode, { minVersionCode: group.minVersionCode });
    ElMessage.success(`v${group.versionName} 最低兼容版本已设为 ${group.minVersionCode}`);
  } catch (e) {
    ElMessage.error(e?.message || "保存失败");
  } finally {
    updatingVersion.value[vCode] = false;
  }
}

async function handleDeleteVersion(group) {
  const vCode = group.versionCode;
  try {
    await ElMessageBox.confirm(
      `确定要删除版本 v${group.versionName} (vc: ${vCode}) 吗？\n该操作将同时清理安装包及关联的全部差分包，且不可撤回！`,
      "删除版本确认",
      {
        confirmButtonText: "确定删除",
        cancelButtonText: "取消",
        type: "warning",
        confirmButtonClass: "el-button--danger",
      }
    );
  } catch {
    return;
  }

  deletingVersion.value[vCode] = true;
  try {
    await deleteVersion(appId, vCode);
    ElMessage.success(`版本 v${group.versionName} (vc: ${vCode}) 已成功删除`);
    openGroups.value = [];
    await load();
  } catch (e) {
    ElMessage.error(e?.message || "删除版本失败");
  } finally {
    deletingVersion.value[vCode] = false;
  }
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

function openEditNotes(group) {
  currentEditGroup.value = group;
  editNotesContent.value = Array.isArray(group.releaseNotes) ? group.releaseNotes.join("\n") : "";
  showEditNotesDialog.value = true;
}

async function saveReleaseNotes() {
  if (!currentEditGroup.value) return;
  savingNotes.value = true;
  const vCode = currentEditGroup.value.versionCode;
  const list = editNotesContent.value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  try {
    const res = await updateVersion(appId, vCode, { releaseNotes: list });
    ElMessage.success("更新说明已成功保存");
    currentEditGroup.value.releaseNotes = res.data?.releaseNotes || list;
    showEditNotesDialog.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e?.message || "保存失败");
  } finally {
    savingNotes.value = false;
  }
}

function openSyncHistoryDialog() {
  syncHistoryForm.value = {
    limit: 20,
    autoGeneratePatches: false,
  };
  showSyncHistoryDialog.value = true;
}

async function submitSyncHistory() {
  syncingHistory.value = true;
  try {
    const res = await syncHistoryReleases(appId, syncHistoryForm.value);
    const d = res.data || {};
    ElNotification({
      title: "历史版本同步完成",
      message: `扫描 ${d.totalScanned || 0} 个 Release，成功导入 ${d.importedCount || 0} 个版本，跳过 ${d.skippedCount || 0} 个${d.patchesGenerated ? `，自动生成 ${d.patchesGenerated} 个补丁` : ""}`,
      type: "success",
      duration: 6000,
    });
    showSyncHistoryDialog.value = false;
    await load();
  } catch (err) {
    ElMessage.error(err?.message || "同步历史版本失败");
  } finally {
    syncingHistory.value = false;
  }
}

function openManualVersionDialog() {
  manualFile.value = null;
  manualPackageMode.value = "file";
  manualForm.value = {
    versionCode: null,
    versionName: "",
    publishedAt: new Date().toISOString().slice(0, 10),
    forceUpdate: false,
    minVersionCode: 1,
    fileUrl: "",
    sha256: "",
    size: null,
    releaseNotes: "",
    changelogUrl: "",
  };
  if (manualUploadRef.value) {
    manualUploadRef.value.clearFiles();
  }
  showManualVersionDialog.value = true;
}

function handleFileChange(uploadFile) {
  manualFile.value = uploadFile.raw;
}

async function submitManualVersion() {
  if (!manualForm.value.versionCode || manualForm.value.versionCode < 1) {
    return ElMessage.warning("请填写正确的 versionCode (正整数)");
  }
  if (!manualForm.value.versionName) {
    return ElMessage.warning("请填写 versionName");
  }

  savingManualVersion.value = true;
  try {
    if (manualPackageMode.value === "file" && manualFile.value) {
      const fd = new FormData();
      fd.append("file", manualFile.value);
      fd.append("versionCode", manualForm.value.versionCode);
      fd.append("versionName", manualForm.value.versionName);
      if (manualForm.value.publishedAt) fd.append("publishedAt", manualForm.value.publishedAt);
      fd.append("forceUpdate", manualForm.value.forceUpdate);
      if (manualForm.value.minVersionCode) fd.append("minVersionCode", manualForm.value.minVersionCode);
      if (manualForm.value.changelogUrl) fd.append("changelogUrl", manualForm.value.changelogUrl);
      if (manualForm.value.releaseNotes) fd.append("releaseNotes", manualForm.value.releaseNotes);
      await createVersion(appId, fd, true);
    } else {
      await createVersion(appId, {
        versionCode: Number(manualForm.value.versionCode),
        versionName: manualForm.value.versionName,
        publishedAt: manualForm.value.publishedAt,
        forceUpdate: manualForm.value.forceUpdate,
        minVersionCode: Number(manualForm.value.minVersionCode) || 1,
        changelogUrl: manualForm.value.changelogUrl,
        releaseNotes: manualForm.value.releaseNotes,
        fileUrl: manualForm.value.fileUrl,
        sha256: manualForm.value.sha256,
        size: manualForm.value.size ? Number(manualForm.value.size) : undefined,
      }, false);
    }

    ElMessage.success(`版本 v${manualForm.value.versionName} 补录成功！`);
    showManualVersionDialog.value = false;
    await load();
  } catch (err) {
    ElMessage.error(err?.message || "补录版本失败");
  } finally {
    savingManualVersion.value = false;
  }
}

function copyLink(url) {
  const full = url.startsWith("http") ? url : `${location.origin}${url}`;
  navigator.clipboard.writeText(full);
  ElMessage.success("已复制到剪贴板");
}

onMounted(load);
</script>

<style scoped>
.page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.breadcrumb-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding: 20px;
  background: var(--app-card-bg);
  border: 1px solid var(--app-card-border);
  border-radius: 12px;
  box-shadow: var(--app-card-shadow);
  flex-wrap: wrap;
  gap: 16px;
}

.sub-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.repo-link {
  font-size: 13px;
  color: var(--app-accent);
  font-family: monospace;
}

.sub {
  font-size: 13px;
  color: #10b981;
}

.sub.warn {
  color: #f59e0b;
}

.group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 14px;
}

.vc {
  color: var(--app-text-muted);
  font-size: 12px;
  margin-left: 6px;
  font-family: monospace;
}

.group-stats {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date {
  font-size: 12px;
  color: var(--app-text-muted);
}

.version-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--app-surface-subtle);
  border-radius: 8px;
  border: 1px solid var(--app-card-border);
  flex-wrap: wrap;
  gap: 12px;
}

.version-controls {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.ctrl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.ctrl-label {
  font-weight: 500;
  color: var(--app-text-sub);
}

.help-icon {
  cursor: pointer;
  color: var(--app-text-muted);
  font-size: 14px;
  user-select: none;
}

.full-info {
  margin-bottom: 16px;
}

.sha {
  font-size: 11px;
  word-break: break-all;
  font-family: monospace;
  color: var(--app-text-muted);
}

.dl-link {
  color: var(--app-accent);
  font-size: 12px;
  word-break: break-all;
  font-family: monospace;
}

.notes-section {
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--app-surface-subtle);
  border-radius: 8px;
  border: 1px solid var(--app-card-border);
}

.notes-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.notes-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--app-text-main);
}

.notes-list {
  margin: 6px 0 0 16px;
  padding: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--app-text-sub);
}

.empty-notes {
  font-size: 12px;
  color: var(--app-text-muted);
  padding: 4px 0;
}

.patch-section {
  margin-top: 16px;
}

.patch-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.missing-list {
  margin-top: 10px;
  font-size: 12px;
}

.missing-label {
  color: var(--app-text-muted);
  margin-right: 6px;
}
</style>

