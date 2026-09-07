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
      <div class="toolbar-info">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
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
      <div class="toolbar-actions">
        <div class="auto-sync-box" v-if="appInfo">
          <span style="font-size:13px;color:#666">定时同步:</span>
          <el-switch v-model="appInfo.autoSync" @change="toggleAutoSync" />
          <el-tag
            v-if="appInfo.autoSync"
            size="small"
            type="success"
            effect="plain"
            style="cursor:pointer"
            title="点击修改定时同步周期"
            @click="openEditDialog"
          >
            {{ formatInterval(appInfo.autoSyncIntervalMinutes) }} ✏️
          </el-tag>
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
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:12px">
          <el-button type="primary" :loading="syncing" @click="doSync">🔄 同步最新 Release</el-button>
          <el-button @click="openSyncHistoryDialog">📥 批量导入 GitHub 历史</el-button>
          <el-button @click="openManualVersionDialog">➕ 手动补录旧版本</el-button>
        </div>
      </el-empty>

      <!-- Version groups -->
      <el-collapse v-model="openGroups" accordion class="version-collapse">
        <el-collapse-item
          v-for="group in versionGroups"
          :key="group.versionCode"
          :name="String(group.versionCode)"
        >
          <template #title>
            <div class="group-title">
              <div class="group-title-main">
                <el-tag v-if="group.isLatest" type="success" size="small">最新</el-tag>
                <el-tag v-if="group.forceUpdate" type="danger" size="small">强制更新</el-tag>
                <strong>{{ group.versionName }}</strong>
                <span class="vc"> (vc: {{ group.versionCode }})</span>
              </div>
              <div class="group-stats">
                <el-tag type="info" size="small">{{ formatSize(group.size) }}</el-tag>
                <el-tag
                  :type="group.coveredCount === group.eligibleCount ? 'success' : 'warning'"
                  size="small"
                >
                  差分 {{ group.coveredCount }}/{{ group.eligibleCount }}
                </el-tag>
                <span class="date">{{ group.publishedAt }}</span>
              </div>
            </div>
          </template>

          <!-- Version action & config toolbar -->
          <div class="version-toolbar sub-card">
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
              class="del-ver-btn"
              :loading="deletingVersion[group.versionCode]"
              @click="handleDeleteVersion(group)"
            >
              🗑️ 删除此版本
            </el-button>
          </div>

          <!-- Full download info -->
          <div class="full-info sub-card">
            <div class="sub-card-header">
              <span class="sub-card-title">📦 安装包元数据</span>
              <span class="sub-card-hint" v-if="group.publishedAt">发布于: {{ group.publishedAt }}</span>
            </div>
            <div class="meta-grid">
              <div class="meta-row">
                <span class="meta-label">完整包大小</span>
                <span class="meta-val">
                  <el-tag size="small" type="info">{{ formatSize(group.size) }}</el-tag>
                </span>
              </div>
              <div class="meta-row">
                <span class="meta-label">发布日期</span>
                <span class="meta-val">{{ group.publishedAt || "—" }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">强制更新状态</span>
                <span class="meta-val">
                  <el-tag :type="group.forceUpdate ? 'danger' : 'info'" size="small">
                    {{ group.forceUpdate ? '已开启（全员强制更新）' : '未开启（常规更新）' }}
                  </el-tag>
                </span>
              </div>
              <div class="meta-row">
                <span class="meta-label">最低兼容版本</span>
                <span class="meta-val">vc &ge; {{ group.minVersionCode || 1 }}</span>
              </div>
              <div class="meta-row full-width">
                <span class="meta-label">SHA-256</span>
                <span class="meta-val">
                  <code class="sha">{{ group.sha256 || "—" }}</code>
                </span>
              </div>
              <div class="meta-row full-width">
                <span class="meta-label">下载链接</span>
                <span class="meta-val">
                  <a :href="group.downloadUrl" target="_blank" class="dl-link">{{ group.downloadUrl }}</a>
                </span>
              </div>
            </div>
          </div>

          <!-- Release notes -->
          <div class="notes-section sub-card">
            <div class="sub-card-header">
              <span class="sub-card-title">📝 更新说明</span>
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
          <div class="patch-section sub-card">
            <div class="sub-card-header patch-header">
              <span class="sub-card-title">⚡ 增量差分补丁 (升级到此版本)</span>
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

            <div class="table-responsive">
              <el-table
                :data="group.patches"
                size="small"
                style="width: 100%; min-width: 580px"
                :empty-text="group.eligibleCount === 0 ? '无历史版本可升级' : '暂无差分包，点击上方按钮生成'"
              >
                <el-table-column label="从版本升级" prop="fromVersionName" width="120" />
                <el-table-column label="差分包大小" width="110">
                  <template #default="{ row }">{{ formatSize(row.patchSize) }}</template>
                </el-table-column>
                <el-table-column label="节省下载" min-width="140">
                  <template #default="{ row }">
                    <el-tag type="success" size="small">省 {{ formatSize(row.savedBytes) }} ({{ row.savedPercentage }}%)</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="生成时间" prop="createdAt" width="150" />
                <el-table-column label="操作" width="200">
                  <template #default="{ row }">
                    <div class="table-actions">
                      <el-button
                        size="small"
                        class="action-btn copy-btn"
                        @click="copyLink(row.patchUrl)"
                      >
                        🔗 复制链接
                      </el-button>
                      <el-popover
                        v-if="row.cumulativeReleaseNotes && row.cumulativeReleaseNotes.length > 0"
                        placement="left"
                        :width="340"
                        trigger="click"
                      >
                        <template #reference>
                          <el-button size="small" class="action-btn notes-btn">
                            📋 说明 ({{ row.cumulativeReleaseNotes.length }})
                          </el-button>
                        </template>
                        <div class="popover-title">
                          从 {{ row.fromVersionName }} 升级将收到的叠加说明 ({{ row.cumulativeReleaseNotes.length }} 条)：
                        </div>
                        <div class="popover-content">
                          <ul class="popover-list">
                            <li v-for="(item, idx) in row.cumulativeReleaseNotes" :key="idx">{{ item }}</li>
                          </ul>
                        </div>
                      </el-popover>
                    </div>
                  </template>
                </el-table-column>
              </el-table>
            </div>

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
      :width="isMobile ? '92%' : '560px'"
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
    <el-dialog
      v-model="showEditDialog"
      title="编辑 App 配置"
      :width="isMobile ? '92%' : '500px'"
      :close-on-click-modal="false"
    >
      <el-form
        :model="editForm"
        :label-width="isMobile ? 'auto' : '120px'"
        :label-position="isMobile ? 'top' : 'left'"
        @submit.prevent="submitEditApp"
      >
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
        <el-form-item v-if="editForm.autoSync" label="同步检测周期">
          <div style="display:flex;gap:10px;width:100%;flex-wrap:wrap">
            <el-select v-model="editForm.intervalPreset" style="width:160px" @change="onEditIntervalPresetChange">
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
              v-if="editForm.intervalPreset === 'custom'"
              v-model="editForm.autoSyncIntervalMinutes"
              :min="5"
              :max="10080"
              style="width:160px"
              placeholder="分钟数(≥5)"
            />
          </div>
          <span class="hint">系统按设定的时间周期在后台检测 GitHub 是否发布新 Release</span>
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
      :width="isMobile ? '92%' : '520px'"
      :close-on-click-modal="false"
    >
      <div style="margin-bottom:16px;font-size:13px;color:#606266;line-height:1.6">
        💡 系统将扫描并同步 <strong>{{ appInfo?.githubRepo || appId }}</strong> 历史 Releases，自动下载安装包与元数据，并安全维护版本序列（不会错误覆盖现有更高版本）。
      </div>
      <el-form :label-width="isMobile ? 'auto' : '130px'" :label-position="isMobile ? 'top' : 'left'">
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
      :width="isMobile ? '94%' : '600px'"
      :close-on-click-modal="false"
    >
      <el-form :label-width="isMobile ? 'auto' : '120px'" :label-position="isMobile ? 'top' : 'left'">
        <el-row :gutter="16">
          <el-col :xs="24" :sm="12">
            <el-form-item label="Version Code" required>
              <el-input-number
                v-model="manualForm.versionCode"
                :min="1"
                placeholder="如 10200"
                style="width:100%"
              />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="Version Name" required>
              <el-input v-model="manualForm.versionName" placeholder="如 1.2.0" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :xs="24" :sm="12">
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
          <el-col :xs="24" :sm="12">
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
            <el-col :xs="24" :sm="14">
              <el-form-item label="文件 SHA-256">
                <el-input v-model="manualForm.sha256" placeholder="选填，64位哈希" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="10">
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
import { ref, computed, onMounted, onUnmounted } from "vue";
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

const isMobile = ref(false);
function handleResize() {
  isMobile.value = window.innerWidth < 768;
}
const descriptionsColumn = computed(() => (isMobile.value ? 1 : 2));

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

function formatInterval(minutes) {
  const m = Number(minutes) || 60;
  if (m < 60) return `每 ${m} 分钟`;
  if (m % 60 === 0) return `每 ${m / 60} 小时`;
  return `每 ${(m / 60).toFixed(1)} 小时`;
}

function onEditIntervalPresetChange(val) {
  if (val !== "custom") {
    editForm.value.autoSyncIntervalMinutes = Number(val);
  }
}

function openEditDialog() {
  if (!appInfo.value) return;
  const currentMinutes = Number(appInfo.value.autoSyncIntervalMinutes) || 60;
  const presets = [15, 30, 60, 120, 360, 720, 1440];
  const isPreset = presets.includes(currentMinutes);

  editForm.value = {
    name: appInfo.value.name || "",
    platform: appInfo.value.platform || "android",
    githubRepo: appInfo.value.githubRepo || "",
    githubApiUrl: appInfo.value.githubApiUrl || "https://api.github.com",
    assetPattern: appInfo.value.assetPattern || "",
    autoSync: Boolean(appInfo.value.autoSync),
    autoSyncIntervalMinutes: currentMinutes,
    intervalPreset: isPreset ? currentMinutes : "custom",
  };
  showEditDialog.value = true;
}

async function submitEditApp() {
  if (!editForm.value.name) return ElMessage.warning("名称不能为空");
  savingApp.value = true;
  try {
    const payload = {
      name: editForm.value.name,
      platform: editForm.value.platform,
      githubRepo: editForm.value.githubRepo,
      githubApiUrl: editForm.value.githubApiUrl,
      assetPattern: editForm.value.assetPattern,
      autoSync: editForm.value.autoSync,
      autoSyncIntervalMinutes: Number(editForm.value.autoSyncIntervalMinutes) || 60,
    };
    await updateApp(appId, payload);
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
.page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  box-sizing: border-box;
  width: 100%;
}

.breadcrumb-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 10px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  padding: 20px;
  background: var(--app-card-bg);
  border: 1px solid var(--app-card-border);
  border-radius: 12px;
  box-shadow: var(--app-card-shadow);
  flex-wrap: wrap;
  gap: 16px;
}

.toolbar-info {
  flex: 1;
  min-width: 260px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.auto-sync-box {
  display: flex;
  align-items: center;
  gap: 6px;
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
  word-break: break-all;
}

.sub {
  font-size: 13px;
  color: #10b981;
}

.sub.warn {
  color: #f59e0b;
}

/* Version Collapse Container - Connected single card */
.version-collapse {
  border: 1px solid var(--app-card-border) !important;
  background: var(--app-card-bg) !important;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--app-card-shadow);
}

:deep(.version-collapse .el-collapse-item) {
  background: var(--app-card-bg);
  border-bottom: 1px solid var(--app-card-border);
  border-top: none;
  border-left: none;
  border-right: none;
  border-radius: 0 !important;
  box-shadow: none !important;
}

:deep(.version-collapse .el-collapse-item:last-child) {
  border-bottom: none;
}

:deep(.version-collapse .el-collapse-item__header) {
  background: var(--app-card-bg);
  border-bottom: 1px solid transparent;
  padding: 14px 20px;
  height: auto !important;
  min-height: 52px;
  line-height: 1.5 !important;
  transition: background 0.2s ease, border-color 0.2s ease;
}

:deep(.version-collapse .el-collapse-item:not(.is-active) .el-collapse-item__header:hover) {
  background: var(--app-surface-subtle);
}

:deep(.version-collapse .el-collapse-item.is-active .el-collapse-item__header) {
  border-bottom: 1px solid var(--app-card-border);
  background: var(--app-surface-subtle);
}

:deep(.version-collapse .el-collapse-item__wrap) {
  background: var(--app-card-bg);
  border-bottom: none;
}

:deep(.version-collapse .el-collapse-item__content) {
  padding: 18px 20px 8px 20px !important;
  background: var(--app-card-bg);
  box-sizing: border-box;
}

.group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.group-title-main {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.vc {
  color: var(--app-text-muted);
  font-size: 12px;
  margin-left: 2px;
  font-family: monospace;
}

.group-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.date {
  font-size: 12px;
  color: var(--app-text-muted);
  white-space: nowrap;
}

/* Unified Sub-card Component for all sections */
.sub-card {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-card-border);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 14px;
  box-sizing: border-box;
  width: 100%;
  transition: border-color 0.2s ease;
}

.sub-card:hover {
  border-color: rgba(59, 130, 246, 0.25);
}

.sub-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.sub-card-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--app-text-main);
  display: flex;
  align-items: center;
  gap: 6px;
}

.sub-card-hint {
  font-size: 12px;
  color: var(--app-text-muted);
}

/* Section 1: Version Controls Toolbar */
.version-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.version-controls {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.ctrl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  flex-wrap: wrap;
}

.ctrl-label {
  font-weight: 500;
  color: var(--app-text-sub);
  white-space: nowrap;
}

.help-icon {
  cursor: pointer;
  color: var(--app-text-muted);
  font-size: 14px;
  user-select: none;
}

/* Section 2: Full Info Metadata Grid (Clean, no nested table box) */
.full-info {
  overflow: hidden;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px 24px;
  padding: 2px 0;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  min-width: 0;
}

.meta-row.full-width {
  grid-column: 1 / -1;
  align-items: flex-start;
}

.meta-label {
  width: 96px;
  flex-shrink: 0;
  color: var(--app-text-muted);
  font-weight: 500;
  font-size: 13px;
}

.meta-val {
  flex: 1;
  min-width: 0;
  color: var(--app-text-main);
  word-break: break-all;
  overflow-wrap: anywhere;
}

.sha {
  font-size: 11px;
  word-break: break-all;
  overflow-wrap: anywhere;
  font-family: monospace;
  color: var(--app-text-muted);
  background: var(--app-card-bg);
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--app-card-border);
  display: inline-block;
  line-height: 1.4;
}

.dl-link {
  color: var(--app-accent);
  font-size: 12px;
  word-break: break-all;
  overflow-wrap: anywhere;
  font-family: monospace;
  display: inline-block;
  line-height: 1.4;
}

/* Section 3: Notes Section */
.notes-section {
  overflow: hidden;
}

.notes-list {
  margin: 6px 0 0 16px;
  padding: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--app-text-sub);
  word-break: break-word;
  overflow-wrap: anywhere;
}

.empty-notes {
  font-size: 12px;
  color: var(--app-text-muted);
  padding: 4px 0;
}

/* Section 4: Patch Section */
.patch-section {
  overflow: hidden;
  margin-top: 0;
}

.patch-header {
  margin-bottom: 12px;
}

.table-responsive {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 8px;
  border: 1px solid var(--app-card-border);
  background: var(--app-card-bg);
}

:deep(.patch-section .el-table) {
  --el-table-bg-color: var(--app-card-bg);
  --el-table-tr-bg-color: var(--app-card-bg);
  --el-table-header-bg-color: var(--app-surface-subtle);
  --el-table-border-color: var(--app-card-border);
}

/* Table Action Buttons */
.table-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.action-btn {
  height: 28px !important;
  padding: 0 10px !important;
  border-radius: 6px !important;
  font-size: 12px !important;
  font-weight: 500 !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
  cursor: pointer !important;
}

.action-btn.copy-btn {
  background: rgba(59, 130, 246, 0.08) !important;
  color: #2563eb !important;
  border: 1px solid rgba(59, 130, 246, 0.22) !important;
}

.action-btn.copy-btn:hover {
  background: rgba(59, 130, 246, 0.16) !important;
  color: #1d4ed8 !important;
  border-color: rgba(59, 130, 246, 0.45) !important;
  transform: translateY(-1px);
}

.action-btn.notes-btn {
  background: rgba(16, 185, 129, 0.08) !important;
  color: #059669 !important;
  border: 1px solid rgba(16, 185, 129, 0.22) !important;
}

.action-btn.notes-btn:hover {
  background: rgba(16, 185, 129, 0.16) !important;
  color: #047857 !important;
  border-color: rgba(16, 185, 129, 0.45) !important;
  transform: translateY(-1px);
}

[data-theme="dark"] .action-btn.copy-btn {
  background: rgba(59, 130, 246, 0.14) !important;
  color: #60a5fa !important;
  border: 1px solid rgba(59, 130, 246, 0.3) !important;
}

[data-theme="dark"] .action-btn.copy-btn:hover {
  background: rgba(59, 130, 246, 0.24) !important;
  color: #93c5fd !important;
  border-color: rgba(59, 130, 246, 0.5) !important;
}

[data-theme="dark"] .action-btn.notes-btn {
  background: rgba(16, 185, 129, 0.14) !important;
  color: #34d399 !important;
  border: 1px solid rgba(16, 185, 129, 0.3) !important;
}

[data-theme="dark"] .action-btn.notes-btn:hover {
  background: rgba(16, 185, 129, 0.24) !important;
  color: #6ee7b7 !important;
  border-color: rgba(16, 185, 129, 0.5) !important;
}

/* Popover Content */
.popover-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 8px;
  color: var(--app-text-main);
  line-height: 1.4;
}

.popover-content {
  max-height: 240px;
  overflow-y: auto;
}

.popover-list {
  margin: 0 0 0 16px;
  padding: 0;
  font-size: 12px;
  line-height: 1.8;
  color: var(--app-text-sub);
}

.missing-list {
  margin-top: 12px;
  font-size: 12px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.missing-label {
  color: var(--app-text-muted);
  margin-right: 4px;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .page {
    padding: 12px 10px;
  }

  .toolbar {
    padding: 14px 12px;
    gap: 14px;
  }

  :deep(.version-collapse .el-collapse-item__header) {
    padding: 12px 12px;
  }

  :deep(.version-collapse .el-collapse-item__content) {
    padding: 12px 10px 4px 10px !important;
  }

  .sub-card {
    padding: 12px 10px;
    margin-bottom: 10px;
    border-radius: 8px;
  }

  .toolbar-actions {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .toolbar-actions .auto-sync-box {
    grid-column: 1 / -1;
    margin-bottom: 4px;
  }

  .toolbar-actions .el-button {
    margin: 0 !important;
    width: 100%;
  }

  .toolbar-actions .el-button--primary {
    grid-column: 1 / -1;
  }

  .group-title {
    padding-right: 4px;
  }

  .version-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .version-controls {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: 12px;
  }

  .ctrl-item {
    width: 100%;
    justify-content: space-between;
  }

  .del-ver-btn {
    width: 100%;
    margin-top: 4px;
  }

  :deep(.full-info .el-descriptions__label) {
    width: 95px !important;
    max-width: 95px !important;
    font-size: 12px;
  }

  :deep(.full-info .el-descriptions__content) {
    font-size: 12px;
  }
}
</style>

