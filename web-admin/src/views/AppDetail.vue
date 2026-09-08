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
          <span v-if="appInfo?.lastSyncedAt" class="sub" :title="`浏览器时区: ${browserTimeZone} (${timeZoneOffset})`">
            最近检查: {{ formatShortTime(appInfo.lastSyncedAt) }} <span class="tz-sub">({{ timeZoneOffset }})</span>
          </span>
          <el-tag
            size="small"
            type="info"
            effect="plain"
            style="cursor:pointer"
            title="点击修改差分就绪策略"
            @click="openEditDialog"
          >
            ⚙️ {{ formatPolicyLabel(appInfo?.patchReadinessPolicy) }}
          </el-tag>
          <el-tag
            size="small"
            :type="appInfo?.isPrivate ? 'danger' : 'info'"
            effect="plain"
            style="cursor:pointer"
            title="点击修改私有鉴权设置"
            @click="openEditDialog"
          >
            {{ appInfo?.isPrivate ? '🔒 私有鉴权保护' : '🌐 公开访问' }}
          </el-tag>
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
        <el-button @click="openSharePage">
          🔗 公开下载页
        </el-button>
        <el-button @click="openEditDialog">
          ⚙️ 配置
        </el-button>
        <el-button @click="openSyncHistoryDialog">
          <span class="btn-text-full">📥 批量导入历史</span>
          <span class="btn-text-short">📥 批量导入</span>
        </el-button>
        <el-button @click="openManualVersionDialog">
          <span class="btn-text-full">➕ 补录旧版本</span>
          <span class="btn-text-short">➕ 补录版本</span>
        </el-button>
        <el-button @click="openPreviewDialog">
          🔍 预览 Release
        </el-button>
        <el-button type="primary" :loading="syncing" @click="doSync">
          🔄 同步最新 Release
        </el-button>
      </div>
    </div>

    <!-- App Stats Overview Cards & 7-day trend -->
    <div class="app-stats-overview modern-card" v-if="appStats">
      <div class="stats-overview-grid">
        <div class="stat-mini-card">
          <div class="stat-mini-icon purple">📡</div>
          <div class="stat-mini-body">
            <div class="stat-mini-label">检查更新请求</div>
            <div class="stat-mini-val">{{ appStats.totalChecks || 0 }} <span class="stat-mini-unit">次</span></div>
            <div class="stat-mini-sub">今日 {{ appStats.todayChecks || 0 }} 次</div>
          </div>
        </div>
        <div class="stat-mini-card">
          <div class="stat-mini-icon amber">📥</div>
          <div class="stat-mini-body">
            <div class="stat-mini-label">累计下载总数</div>
            <div class="stat-mini-val">{{ appStats.totalDownloads || 0 }} <span class="stat-mini-unit">次</span></div>
            <div class="stat-mini-sub">今日 {{ appStats.todayDownloads || 0 }} 次</div>
          </div>
        </div>
        <div class="stat-mini-card">
          <div class="stat-mini-icon blue">📦</div>
          <div class="stat-mini-body">
            <div class="stat-mini-label">全量安装包下载</div>
            <div class="stat-mini-val">{{ appStats.totalFullDownloads || 0 }} <span class="stat-mini-unit">次</span></div>
            <div class="stat-mini-sub">完整安装包请求</div>
          </div>
        </div>
        <div class="stat-mini-card">
          <div class="stat-mini-icon green">⚡</div>
          <div class="stat-mini-body">
            <div class="stat-mini-label">差分补丁下载</div>
            <div class="stat-mini-val">{{ appStats.totalPatchDownloads || 0 }} <span class="stat-mini-unit">次</span></div>
            <div class="stat-mini-sub">增量补丁下载</div>
          </div>
        </div>
        <div class="stat-mini-card">
          <div class="stat-mini-icon cyan">📱</div>
          <div class="stat-mini-body">
            <div class="stat-mini-label">活跃设备 (UV)</div>
            <div class="stat-mini-val">{{ appStats.totalDevices || 0 }} <span class="stat-mini-unit">台</span></div>
            <div class="stat-mini-sub">今日活跃 {{ appStats.todayDevices || 0 }} 台</div>
          </div>
        </div>
      </div>

      <!-- 7-day activity trend -->
      <div class="stats-trend-section" v-if="appStats.recentDays && appStats.recentDays.length > 0">
        <div class="trend-header">
          <span class="trend-title">📊 近 7 天活动趋势</span>
          <div class="trend-legend">
            <span class="legend-item"><span class="legend-dot checks"></span>检查请求</span>
            <span class="legend-item"><span class="legend-dot downloads"></span>下载更新</span>
          </div>
        </div>
        <div class="trend-bars-container">
          <div v-for="d in appStats.recentDays" :key="d.date" class="trend-day-col">
            <div
              class="trend-bars-pair"
              :title="`${d.date}\n检查请求: ${d.check_count} 次\n下载次数: ${d.total_downloads} 次 (全量: ${d.full_download_count}, 差分: ${d.patch_download_count})`"
            >
              <div class="trend-bar-track">
                <div class="trend-bar-fill checks" :style="{ height: getBarHeight(d.check_count, maxTrendChecks) + '%' }"></div>
              </div>
              <div class="trend-bar-track">
                <div class="trend-bar-fill downloads" :style="{ height: getBarHeight(d.total_downloads, maxTrendDownloads) + '%' }"></div>
              </div>
            </div>
            <div class="trend-date">{{ formatDayMonth(d.date) }}</div>
          </div>
        </div>
      </div>

      <!-- Version Coverage Distribution -->
      <div class="stats-coverage-section" v-if="appStats.versionCoverage && appStats.versionCoverage.length > 0">
        <div class="coverage-header">
          <div class="coverage-title-wrap">
            <span class="coverage-title">📱 客户端版本覆盖率分布 (活跃设备占比)</span>
            <span class="coverage-subtitle">共统计到 {{ appStats.totalDevices || 0 }} 台活跃设备</span>
          </div>
        </div>

        <!-- Stacked progress bar -->
        <div class="coverage-stacked-bar">
          <div
            v-for="(item, idx) in appStats.versionCoverage"
            :key="item.versionCode"
            class="stacked-segment"
            :style="{ width: item.percentage + '%', backgroundColor: getCoverageColor(idx) }"
            :title="`v${item.versionName} (Build ${item.versionCode}): ${item.deviceCount} 台 (${item.percentage}%)`"
          ></div>
        </div>

        <!-- Details Grid -->
        <div class="coverage-grid">
          <div
            v-for="(item, idx) in appStats.versionCoverage"
            :key="item.versionCode"
            class="coverage-item"
          >
            <div class="coverage-item-top">
              <div class="coverage-item-dot" :style="{ backgroundColor: getCoverageColor(idx) }"></div>
              <span class="coverage-ver-name">v{{ item.versionName }}</span>
              <span class="coverage-ver-code">Build {{ item.versionCode }}</span>
              <el-tag v-if="item.isLatest" size="small" type="success" effect="dark" style="margin-left:4px">最新</el-tag>
            </div>
            <div class="coverage-item-bottom">
              <span class="coverage-count">{{ item.deviceCount }} 台设备</span>
              <span class="coverage-pct">{{ item.percentage }}%</span>
            </div>
            <el-progress
              :percentage="item.percentage"
              :show-text="false"
              :stroke-width="6"
              :color="getCoverageColor(idx)"
            />
          </div>
        </div>
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

      <!-- Version Branch Section Toolbar -->
      <div class="version-section-bar" v-if="versionGroups.length > 0">
        <div class="v-section-bar-left">
          <div class="branch-filter-tabs">
            <span class="branch-filter-label">分支过滤:</span>
            <button
              type="button"
              :class="['branch-pill-btn', { active: selectedBranchFilter === 'all' }]"
              @click="selectBranch('all')"
            >
              全部 ({{ versionGroups.length }})
            </button>
            <button
              v-for="b in allBranches"
              :key="b.branchKey"
              type="button"
              :class="['branch-pill-btn', { active: selectedBranchFilter === b.branchKey }]"
              @click="selectBranch(b.branchKey)"
            >
              {{ b.displayName }} ({{ b.versions.length }})
              <span v-if="b.hasLatest" class="pill-dot" title="当前最新主干"></span>
            </button>
          </div>
        </div>
        <div class="v-section-bar-right">
          <el-button-group size="small">
            <el-button @click="expandAllBranches">全部展开</el-button>
            <el-button @click="collapseAllBranches">全部折叠</el-button>
          </el-button-group>
        </div>
      </div>

      <!-- Version Groups nested inside Collapsible Branches -->
      <div class="branch-card" v-for="branch in displayBranches" :key="branch.branchKey">
        <div class="branch-header" @click="toggleBranch(branch.branchKey)">
          <div class="branch-header-left">
            <span class="branch-arrow" :class="{ 'is-open': openBranches.includes(branch.branchKey) }">
              ▶
            </span>
            <span class="branch-folder-icon">📁</span>
            <span class="branch-name">{{ branch.displayName }} 系列</span>
            <el-tag v-if="branch.hasLatest" type="success" size="small" effect="dark">
              当前主干 (最新)
            </el-tag>
            <el-tag type="info" size="small" round>
              {{ branch.versions.length }} 个版本
            </el-tag>
            <span class="branch-version-range" v-if="branch.versions.length > 1">
              v{{ branch.minVersionName }} ~ v{{ branch.maxVersionName }}
            </span>
          </div>
          <div class="branch-header-right" @click.stop>
            <span class="branch-downloads">
              📥 累计下载 <strong>{{ branch.totalDownloads }}</strong> 次
            </span>
            <el-button
              size="small"
              text
              type="primary"
              class="branch-toggle-btn"
              @click="toggleBranch(branch.branchKey)"
            >
              {{ openBranches.includes(branch.branchKey) ? '折叠 ▴' : '展开 ▾' }}
            </el-button>
          </div>
        </div>

        <el-collapse-transition>
          <div v-show="openBranches.includes(branch.branchKey)" class="branch-body">
            <el-collapse
              v-model="branchActiveVersion[branch.branchKey]"
              accordion
              class="version-collapse"
              @change="(val) => handleVersionCollapseChange(val)"
            >
              <el-collapse-item
                v-for="group in branch.versions"
                :key="group.versionCode"
                :name="String(group.versionCode)"
                :id="`version-item-${group.versionCode}`"
              >
          <template #title>
            <div class="group-title">
              <div class="group-title-main">
                <el-tag v-if="group.isLatest" type="success" size="small">最新</el-tag>
                <el-tag v-if="group.channel && group.channel !== 'stable'" type="info" size="small">{{ group.channel }}</el-tag>
                <el-tag v-if="group.rolloutPercentage !== undefined && group.rolloutPercentage < 100" type="warning" size="small">灰度 {{ group.rolloutPercentage }}%</el-tag>
                <el-tag v-if="group.forceUpdate" type="danger" size="small">强制更新</el-tag>
                <strong>{{ group.versionName }}</strong>
                <span class="vc"> (vc: {{ group.versionCode }})</span>
              </div>
              <div class="group-stats">
                <el-tag type="info" size="small">{{ formatSize(group.size) }}</el-tag>
                <el-tag type="primary" size="small">📥 {{ group.downloadCount || 0 }} 次下载</el-tag>
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
                <el-select
                  v-model="group.minVersionCode"
                  size="small"
                  class="min-ver-select"
                  placeholder="选择兼容版本"
                  :loading="updatingVersion[group.versionCode]"
                >
                  <el-option :value="1" label="不限 (兼容所有旧版本)" />
                  <el-option
                    v-if="isCustomMinVersion(group)"
                    :value="group.minVersionCode"
                    :label="`代码: ${group.minVersionCode} (历史指定)`"
                  />
                  <el-option
                    v-for="v in getEligibleMinVersions(group.versionCode)"
                    :key="v.versionCode"
                    :value="v.versionCode"
                    :label="`≥ v${v.versionName} (代码: ${v.versionCode})`"
                  />
                </el-select>
                <el-button
                  size="small"
                  type="primary"
                  plain
                  :loading="updatingVersion[group.versionCode]"
                  @click="handleSaveMinVersionCode(group)"
                >
                  保存
                </el-button>
                <el-tooltip content="低于此版本的旧客户端请求此更新时将被标记为强制更新" placement="top">
                  <span class="help-icon">ℹ️</span>
                </el-tooltip>
              </div>
              <div class="ctrl-item">
                <span class="ctrl-label">灰度比例:</span>
                <el-slider
                  v-model="group.rolloutPercentage"
                  :min="1"
                  :max="100"
                  style="width:90px;margin:0 8px;"
                />
                <span style="font-size:12px;color:#666;width:36px;">{{ group.rolloutPercentage ?? 100 }}%</span>
                <el-button
                  size="small"
                  type="primary"
                  plain
                  :loading="updatingVersion[group.versionCode]"
                  @click="handleSaveRollout(group)"
                >
                  保存
                </el-button>
                <el-tooltip content="基于设备 ID 哈希的阶段性灰度比例（1%~100%）" placement="top">
                  <span class="help-icon">ℹ️</span>
                </el-tooltip>
              </div>
              <div class="ctrl-item">
                <span class="ctrl-label">发布通道:</span>
                <el-select
                  v-model="group.channel"
                  size="small"
                  style="width:85px"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="通道"
                >
                  <el-option label="stable" value="stable" />
                  <el-option label="beta" value="beta" />
                  <el-option label="alpha" value="alpha" />
                  <el-option label="nightly" value="nightly" />
                </el-select>
                <el-button
                  size="small"
                  type="primary"
                  plain
                  :loading="updatingVersion[group.versionCode]"
                  @click="handleSaveChannel(group)"
                >
                  保存
                </el-button>
              </div>
            </div>

            <div class="version-action-btns">
              <el-button
                v-if="!group.isLatest"
                type="warning"
                size="small"
                plain
                :loading="rollingBackVersion[group.versionCode]"
                @click="handleRollbackVersion(group)"
              >
                ⏪ 回滚为此版本
              </el-button>
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
                  <span class="meta-size-badge">{{ formatSize(group.size) }}</span>
                </span>
              </div>
              <div class="meta-row">
                <span class="meta-label">发布日期</span>
                <span class="meta-val">{{ group.publishedAt || "—" }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">强制更新状态</span>
                <span class="meta-val">
                  <span :class="['meta-status-badge', group.forceUpdate ? 'danger' : 'normal']">
                    {{ group.forceUpdate ? '🚨 已开启（全员强制更新）' : '常规更新（未开启强制）' }}
                  </span>
                </span>
              </div>
              <div class="meta-row">
                <span class="meta-label">最低兼容版本</span>
                <span class="meta-val">
                  <code class="meta-vc-code">{{ formatMinVersionDisplay(group.minVersionCode) }}</code>
                </span>
              </div>
              <div class="meta-row">
                <span class="meta-label">全量包下载次数</span>
                <span class="meta-val">
                  <strong>{{ group.downloadCount || 0 }}</strong> 次
                </span>
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
              <div class="mobile-table-hint" v-if="isMobile && group.patches?.length > 0">
                👈 左右滑动查看完整差分表格 👉
              </div>
              <el-table
                :data="group.patches"
                size="small"
                style="width: 100%; min-width: 630px"
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
                <el-table-column label="下载次数" width="105" align="center">
                  <template #default="{ row }">
                    <el-tag type="info" size="small">📥 {{ row.downloadCount || 0 }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="生成时间" width="180">
                  <template #header>
                    <span>生成时间 <span class="tz-tag">{{ timeZoneOffset }}</span></span>
                  </template>
                  <template #default="{ row }">
                    <span :title="`浏览器时区: ${browserTimeZone} (${timeZoneOffset})`" class="time-cell">
                      {{ formatDateTime(row.createdAt) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="230" min-width="230">
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
                        :placement="isMobile ? 'top' : 'left'"
                        :width="isMobile ? 260 : 340"
                        trigger="click"
                      >
                        <template #reference>
                          <el-button size="small" class="action-btn notes-btn">
                            📋 叠加说明
                          </el-button>
                        </template>
                        <div class="popover-title">
                          从 {{ row.fromVersionName }} 升级将收到的合并更新说明：
                        </div>
                        <div class="popover-content">
                          <div class="popover-notes-wrap">
                            <div
                              v-for="(item, idx) in row.cumulativeReleaseNotes"
                              :key="idx"
                              :class="{
                                'popover-ver-tag': item.startsWith('【'),
                                'popover-empty-line': !item,
                                'popover-note-line': item && !item.startsWith('【')
                              }"
                            >
                              {{ item }}
                            </div>
                          </div>
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
        </el-collapse-transition>
      </div>
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
            <el-option label="UniApp 热更新包 (.wgt)" value="wgt" />
            <el-option label="React Native 离线包 (.zip)" value="rn" />
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
        <el-form-item label="差分就绪策略">
          <el-select v-model="editForm.patchReadinessPolicy" style="width:100%">
            <el-option label="隐藏下载链接 (默认推荐，差分生成完毕前不给下载地址)" value="hide_download_link" />
            <el-option label="完全静默等待 (差分包未生成前不提示有更新)" value="silent" />
            <el-option label="回退全量包 (差分未就绪时直接提供完整全量包)" value="fallback_full" />
          </el-select>
          <span class="hint">当发布新版本但差分包尚未生成完毕时，控制客户端检查更新时的表现</span>
        </el-form-item>
        
        <el-divider content-position="left">高级控制与运维</el-divider>

        <el-form-item label="鉴权保护" prop="isPrivate">
          <el-switch v-model="editForm.isPrivate" active-text="开启 (需要 Token 下载)" inactive-text="公开" />
        </el-form-item>
        <el-form-item label="Client Token" prop="clientToken" v-if="editForm.isPrivate">
          <el-input v-model="editForm.clientToken" placeholder="客户端请求时需携带 x-client-token 头或 token 查询参数" />
        </el-form-item>

        <el-form-item label="保留版本数" prop="maxRetainedVersions">
          <el-input-number v-model="editForm.maxRetainedVersions" :min="0" />
          <span style="font-size: 12px; color: #999; margin-left: 10px;">(0 表示不限制。超出数量的历史版本及其补丁将被自动清理)</span>
        </el-form-item>

        <el-form-item label="Webhook URL" prop="webhookUrl">
          <div style="display:flex;gap:10px;width:100%">
            <el-input v-model="editForm.webhookUrl" placeholder="如 https://open.feishu.cn/open-apis/bot/v2/hook/..." />
            <el-button @click="doTestWebhook" :disabled="!editForm.webhookUrl" :loading="testingWebhook">发送测试</el-button>
          </div>
        </el-form-item>
        <el-form-item label="Webhook 类型" prop="webhookType" v-if="editForm.webhookUrl">
          <el-radio-group v-model="editForm.webhookType">
            <el-radio-button label="generic">通用 JSON</el-radio-button>
            <el-radio-button label="feishu">飞书</el-radio-button>
            <el-radio-button label="dingtalk">钉钉</el-radio-button>
            <el-radio-button label="wecom">企微</el-radio-button>
          </el-radio-group>
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
              <el-select
                v-model="manualForm.minVersionCode"
                placeholder="选择最低兼容版本（默认不限）"
                style="width:100%"
              >
                <el-option :value="1" label="不限 (兼容所有旧版本)" />
                <el-option
                  v-for="v in versionGroups"
                  :key="v.versionCode"
                  :value="v.versionCode"
                  :label="`≥ v${v.versionName} (代码: ${v.versionCode})`"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="强制更新">
          <el-switch v-model="manualForm.forceUpdate" active-text="开启" inactive-text="关闭" />
          <span style="font-size:12px;color:#909399;margin-left:12px">开启后低于此版本的用户必须升级</span>
        </el-form-item>

        <el-form-item label="安装包提供方式">
          <el-radio-group v-model="manualPackageMode" :class="{ 'mobile-radio-group': isMobile }">
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

    <!-- Upload Patch Dialog -->
    <el-dialog v-model="uploadPatchVisible" title="手动上传差分包" width="500px">
      <el-form :model="uploadPatchForm" label-width="120px" ref="uploadPatchFormRef">
        <el-form-item label="目标版本" prop="targetVersionCode">
          <el-input v-model="uploadPatchForm.targetVersionCode" disabled />
        </el-form-item>
        <el-form-item label="前置版本" prop="fromVersionCode" :rules="[{required: true, message: '请选择或填写前置版本'}]">
          <el-input v-model="uploadPatchForm.fromVersionCode" placeholder="如 123" />
        </el-form-item>
        <el-form-item label="补丁文件" prop="file" :rules="[{required: true, message: '请选择 .patch 文件'}]">
          <el-upload
            class="upload-demo"
            action=""
            :auto-upload="false"
            :limit="1"
            :on-change="onPatchFileChange"
            :on-remove="onPatchFileRemove"
            accept=".patch"
          >
            <template #trigger>
              <el-button type="primary">选择文件</el-button>
            </template>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="uploadPatchVisible = false">取消</el-button>
        <el-button type="primary" :loading="uploadingPatch" @click="submitUploadPatch">上传并保存</el-button>
      </template>
    </el-dialog>

    <!-- GitHub Release Preview Dialog -->
    <el-dialog v-model="showPreviewDialog" title="🔍 GitHub Release 资产匹配预览" width="620px">
      <div v-loading="previewLoading" style="min-height: 160px;">
        <div v-if="previewError" style="padding: 12px 0;">
          <el-alert :title="previewError" type="error" show-icon :closable="false" />
        </div>
        <div v-else-if="previewData" class="preview-body">
          <div class="preview-item">
            <span class="preview-lbl">Release 标题:</span>
            <span class="preview-val">
              <strong>{{ previewData.release.name || previewData.release.tagName }}</strong>
              <el-tag size="small" type="info" style="margin-left: 8px">{{ previewData.release.tagName }}</el-tag>
            </span>
          </div>

          <div class="preview-item">
            <span class="preview-lbl">元数据清单:</span>
            <span class="preview-val">
              <span v-if="previewData.metaAsset" style="color: #67c23a">✅ 已找到 {{ previewData.metaAsset.name }}</span>
              <span v-else style="color: #e6a23c">⚠️ 未包含 app-version.json（将使用启发式推断）</span>
              <div v-if="previewData.metadata" style="margin-top: 4px; font-size: 13px; color: #666;">
                解析版本: v{{ previewData.metadata.versionName }} (Build {{ previewData.metadata.versionCode }})
              </div>
            </span>
          </div>

          <div class="preview-item">
            <span class="preview-lbl">安装包匹配:</span>
            <div class="preview-val">
              <div v-if="previewData.matchedBinaryAsset" style="color: #67c23a; font-weight: 600;">
                🎯 匹配成功: {{ previewData.matchedBinaryAsset.name }} ({{ formatSize(previewData.matchedBinaryAsset.size) }})
              </div>
              <div v-else style="color: #f56c6c; font-weight: 600;">
                ❌ 未匹配到符合平台 [{{ previewData.platform }}] 的安装包！
              </div>
            </div>
          </div>

          <div class="preview-item full">
            <span class="preview-lbl">Release 所有资产 ({{ previewData.allAssets.length }} 个):</span>
            <div class="preview-asset-tags">
              <el-tag
                v-for="a in previewData.allAssets"
                :key="a.name"
                size="small"
                :type="a.name === previewData.matchedBinaryAsset?.name ? 'success' : 'info'"
                style="margin: 3px;"
              >
                {{ a.name }} ({{ formatSize(a.size) }})
              </el-tag>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="showPreviewDialog = false">关闭</el-button>
        <el-button
          v-if="previewData?.isMatchSuccess"
          type="primary"
          :loading="syncing"
          @click="doSyncFromPreview"
        >
          确认无误，立即同步
        </el-button>
      </template>
    </el-dialog>

</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElNotification, ElMessageBox } from "element-plus";
import ThemeToggle from "../components/ThemeToggle.vue";
import {
  getBrowserTimeZone,
  getTimeZoneOffsetString,
  formatDateTime,
  formatShortTime,
} from "../utils/time.js";
import {
  listApps,
  updateApp,
  syncRelease,
  syncHistoryReleases,
  createVersion,
  getPatchMatrix,
  generateAllPatches,
  testWebhook,
  uploadPatch,
  generatePatch,
  updateVersion,
  deleteVersion,
  rollbackVersion,
  previewRelease,
  getAppStats,
} from "../api/appHub.js";

const route = useRoute();
const appId = route.params.appId;

const timeZoneOffset = getTimeZoneOffsetString();
const browserTimeZone = getBrowserTimeZone();

const isMobile = ref(false);
function handleResize() {
  isMobile.value = window.innerWidth < 768;
}
const descriptionsColumn = computed(() => (isMobile.value ? 1 : 2));

const appInfo = ref(null);
const appStats = ref(null);

const coverageColors = ["#6366f1", "#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316"];
function getCoverageColor(idx) {
  return coverageColors[idx % coverageColors.length];
}

const maxTrendChecks = computed(() => {
  if (!appStats.value?.recentDays?.length) return 10;
  const max = Math.max(...appStats.value.recentDays.map((d) => d.check_count || 0));
  return max > 0 ? max : 10;
});

const maxTrendDownloads = computed(() => {
  if (!appStats.value?.recentDays?.length) return 10;
  const max = Math.max(...appStats.value.recentDays.map((d) => d.total_downloads || 0));
  return max > 0 ? max : 10;
});

function getBarHeight(val, max) {
  if (!val || !max) return 4;
  return Math.max(8, Math.min(100, Math.round((val / max) * 100)));
}

function formatDayMonth(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  return dateStr;
}
const loading = ref(false);
const syncing = ref(false);
const versionGroups = ref([]);
const bsdiffAvailable = ref(true);
const openGroups = ref([]);
const selectedBranchFilter = ref("all");
const openBranches = ref([]);
const branchActiveVersion = ref({});

function extractBranchKey(versionName) {
  if (!versionName) return "其他";
  const str = String(versionName).trim();
  const matchTwo = str.match(/(?:^|[^\d])(\d+)\.(\d+)/);
  if (matchTwo) {
    return `${matchTwo[1]}.${matchTwo[2]}`;
  }
  const matchOne = str.match(/(?:^|[^\d])(\d+)(?:[^\d]|$)/);
  if (matchOne) {
    return `${matchOne[1]}.0`;
  }
  return "其他";
}

const allBranches = computed(() => {
  const map = new Map();
  for (const group of versionGroups.value) {
    const key = extractBranchKey(group.versionName);
    if (!map.has(key)) {
      map.set(key, {
        branchKey: key,
        displayName: key === "其他" ? "其他版本" : `v${key}.x`,
        hasLatest: false,
        totalDownloads: 0,
        versions: [],
      });
    }
    const b = map.get(key);
    b.versions.push(group);
    if (group.isLatest) b.hasLatest = true;
    b.totalDownloads += Number(group.downloadCount || 0);
  }
  return Array.from(map.values()).map((b) => {
    return {
      ...b,
      minVersionName: b.versions[b.versions.length - 1]?.versionName || "",
      maxVersionName: b.versions[0]?.versionName || "",
    };
  });
});

const displayBranches = computed(() => {
  if (selectedBranchFilter.value === "all") {
    return allBranches.value;
  }
  return allBranches.value.filter((b) => b.branchKey === selectedBranchFilter.value);
});

function toggleBranch(branchKey) {
  const idx = openBranches.value.indexOf(branchKey);
  if (idx > -1) {
    openBranches.value.splice(idx, 1);
  } else {
    openBranches.value.push(branchKey);
  }
}

function selectBranch(key) {
  selectedBranchFilter.value = key;
  if (key !== "all" && !openBranches.value.includes(key)) {
    openBranches.value.push(key);
  }
}

function expandAllBranches() {
  openBranches.value = allBranches.value.map((b) => b.branchKey);
}

function collapseAllBranches() {
  openBranches.value = [];
}

let scrollTimer = null;
let secondaryScrollTimer = null;

function handleVersionCollapseChange(activeCode) {
  if (!activeCode) return;
  scrollToVersion(activeCode);
}

function scrollToVersion(versionCode) {
  if (!versionCode) return;
  if (scrollTimer) clearTimeout(scrollTimer);
  if (secondaryScrollTimer) clearTimeout(secondaryScrollTimer);

  scrollTimer = setTimeout(() => {
    const el = document.getElementById(`version-item-${versionCode}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);

  secondaryScrollTimer = setTimeout(() => {
    const el = document.getElementById(`version-item-${versionCode}`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < 10 || rect.top > 120) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, 320);
}

const generatingAll = ref({});
const updatingVersion = ref({});
const deletingVersion = ref({});
const rollingBackVersion = ref({});
const showPreviewDialog = ref(false);
const previewLoading = ref(false);
const previewData = ref(null);
const previewError = ref("");
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
  patchReadinessPolicy: "hide_download_link",
  autoSync: false,
  isPrivate: false,
  clientToken: "",
  maxRetainedVersions: 0,
  webhookUrl: "",
  webhookType: "generic",
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

function formatPolicyLabel(policy) {
  if (policy === "silent") return "差分策略: 静默等待";
  if (policy === "fallback_full") return "差分策略: 回退全量包";
  return "差分策略: 隐藏下载链接";
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
    patchReadinessPolicy: appInfo.value.patchReadinessPolicy || "hide_download_link",
    autoSync: Boolean(appInfo.value.autoSync),
    autoSyncIntervalMinutes: currentMinutes,
    intervalPreset: isPreset ? currentMinutes : "custom",
    customIntervalMinutes: isPreset ? null : currentMinutes,
    isPrivate: Boolean(appInfo.value.isPrivate),
    clientToken: appInfo.value.clientToken || "",
    maxRetainedVersions: appInfo.value.maxRetainedVersions || 0,
    webhookUrl: appInfo.value.webhookUrl || "",
    webhookType: appInfo.value.webhookType || "generic",
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
      patchReadinessPolicy: editForm.value.patchReadinessPolicy,
      autoSync: editForm.value.autoSync,
      autoSyncIntervalMinutes: Number(editForm.value.autoSyncIntervalMinutes) || 60,
      isPrivate: Boolean(editForm.value.isPrivate),
      clientToken: editForm.value.clientToken,
      maxRetainedVersions: editForm.value.maxRetainedVersions,
      webhookUrl: editForm.value.webhookUrl,
      webhookType: editForm.value.webhookType,
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
  return formatShortTime(iso);
}

async function load() {
  loading.value = true;
  try {
    const [matrixRes, appsRes, statsRes] = await Promise.all([
      getPatchMatrix(appId),
      listApps(),
      getAppStats(appId).catch(() => ({ data: null })),
    ]);
    versionGroups.value = matrixRes.data?.versionGroups || [];
    bsdiffAvailable.value = matrixRes.data?.bsdiffAvailable ?? true;
    appInfo.value = (appsRes.data || []).find((a) => a.appId === appId) || null;
    appStats.value = statsRes?.data || null;

    // Auto-open the latest branch and its latest version if not set
    if (allBranches.value.length > 0 && openBranches.value.length === 0) {
      const mainBranch = allBranches.value.find((b) => b.hasLatest) || allBranches.value[0];
      openBranches.value = [mainBranch.branchKey];
      if (mainBranch.versions.length > 0) {
        branchActiveVersion.value[mainBranch.branchKey] = String(mainBranch.versions[0].versionCode);
      }
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

function getEligibleMinVersions(targetVersionCode) {
  return (versionGroups.value || [])
    .filter((v) => Number(v.versionCode) <= Number(targetVersionCode))
    .sort((a, b) => Number(b.versionCode) - Number(a.versionCode));
}

function isCustomMinVersion(group) {
  const code = Number(group.minVersionCode);
  if (!code || code <= 1) return false;
  const eligible = getEligibleMinVersions(group.versionCode);
  return !eligible.some((v) => Number(v.versionCode) === code);
}

function formatMinVersionDisplay(code) {
  const c = Number(code) || 1;
  if (c <= 1) return "不限 (兼容所有旧版本)";
  const found = (versionGroups.value || []).find((v) => Number(v.versionCode) === c);
  if (found) {
    return `≥ v${found.versionName} (代码: ${c})`;
  }
  return `≥ 代码: ${c}`;
}

async function handleSaveMinVersionCode(group) {
  const vCode = group.versionCode;
  updatingVersion.value[vCode] = true;
  try {
    await updateVersion(appId, vCode, { minVersionCode: group.minVersionCode });
    const label = formatMinVersionDisplay(group.minVersionCode);
    ElMessage.success(`v${group.versionName} 最低兼容版本已设为: ${label}`);
  } catch (e) {
    ElMessage.error(e?.message || "保存失败");
  } finally {
    updatingVersion.value[vCode] = false;
  }
}

async function handleSaveRollout(group) {
  const vCode = group.versionCode;
  updatingVersion.value[vCode] = true;
  try {
    await updateVersion(appId, vCode, { rolloutPercentage: group.rolloutPercentage });
    ElMessage.success(`v${group.versionName} 灰度比例已更新为: ${group.rolloutPercentage}%`);
  } catch (e) {
    ElMessage.error(e?.message || "保存失败");
  } finally {
    updatingVersion.value[vCode] = false;
  }
}

async function handleSaveChannel(group) {
  const vCode = group.versionCode;
  updatingVersion.value[vCode] = true;
  try {
    await updateVersion(appId, vCode, { channel: group.channel });
    ElMessage.success(`v${group.versionName} 发布通道已更新为: ${group.channel}`);
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
    branchActiveVersion.value = {};
    await load();
  } catch (e) {
    ElMessage.error(e?.message || "删除版本失败");
  } finally {
    deletingVersion.value[vCode] = false;
  }
}

function openSharePage() {
  const shareUrl = `/share/${appId}`;
  window.open(shareUrl, "_blank");
}

async function openPreviewDialog() {
  showPreviewDialog.value = true;
  previewLoading.value = true;
  previewError.value = "";
  previewData.value = null;
  try {
    const res = await previewRelease(appId);
    previewData.value = res.data;
  } catch (err) {
    previewError.value = err?.message || "预览 Release 失败";
  } finally {
    previewLoading.value = false;
  }
}

async function doSyncFromPreview() {
  showPreviewDialog.value = false;
  await doSync();
}

async function handleRollbackVersion(group) {
  const vCode = group.versionCode;
  try {
    await ElMessageBox.confirm(
      `确定要将版本 v${group.versionName} (vc: ${vCode}) 设为当前最新生效版本吗？\n回滚后，客户端检查更新将以该版本为准。`,
      "版本回滚确认",
      {
        confirmButtonText: "确定回滚",
        cancelButtonText: "取消",
        type: "warning",
      }
    );
  } catch {
    return;
  }

  rollingBackVersion.value[vCode] = true;
  try {
    await rollbackVersion(appId, vCode);
    ElMessage.success(`已成功回滚至版本 v${group.versionName}`);
    await load();
  } catch (e) {
    ElMessage.error(e?.message || "回滚失败");
  } finally {
    rollingBackVersion.value[vCode] = false;
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
  padding: 20px 16px;
  max-width: 1400px;
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

/* App Stats Overview Banner */
.app-stats-overview {
  background: var(--app-card-bg);
  border: 1px solid var(--app-card-border);
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 24px;
  box-shadow: var(--app-card-shadow);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stats-overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
}

.stat-mini-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-card-border);
  border-radius: 10px;
}

.stat-mini-icon {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.stat-mini-icon.purple { background: rgba(139, 92, 246, 0.12); }
.stat-mini-icon.amber  { background: rgba(245, 158, 11, 0.12); }
.stat-mini-icon.blue   { background: rgba(59, 130, 246, 0.12); }
.stat-mini-icon.green  { background: rgba(16, 185, 129, 0.12); }

.stat-mini-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.stat-mini-label {
  font-size: 11px;
  color: var(--app-text-muted);
  margin-bottom: 2px;
}

.stat-mini-val {
  font-size: 17px;
  font-weight: 700;
  color: var(--app-text-main);
  line-height: 1.2;
}

.stat-mini-unit {
  font-size: 11px;
  font-weight: normal;
  color: var(--app-text-muted);
}

.stat-mini-sub {
  font-size: 10.5px;
  color: var(--app-text-sub);
  margin-top: 2px;
}

/* 7-day Trend */
.stats-trend-section {
  padding-top: 14px;
  border-top: 1px solid var(--app-card-border);
}

.trend-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.trend-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-main);
}

.trend-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11px;
  color: var(--app-text-muted);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.legend-dot.checks { background: #8b5cf6; }
.legend-dot.downloads { background: #f59e0b; }

.trend-bars-container {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  height: 90px;
  padding: 0 4px;
}

.trend-day-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.trend-bars-pair {
  flex: 1;
  width: 100%;
  max-width: 44px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
}

.trend-bar-track {
  flex: 1;
  height: 100%;
  max-width: 16px;
  display: flex;
  align-items: flex-end;
  background: var(--app-surface-subtle);
  border-radius: 4px;
  overflow: hidden;
}

.trend-bar-fill {
  width: 100%;
  border-radius: 4px 4px 0 0;
  transition: height 0.3s ease;
}

.trend-bar-fill.checks {
  background: #8b5cf6;
}

.trend-bar-fill.downloads {
  background: #f59e0b;
}

.trend-date {
  font-size: 10px;
  color: var(--app-text-muted);
  margin-top: 6px;
  text-align: center;
  white-space: nowrap;
}

/* Version Section Bar (Branch Pills & Expand/Collapse) */
.version-section-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
  padding: 8px 12px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-card-border);
  border-radius: 10px;
}

.v-section-bar-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.branch-filter-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-muted);
  margin-right: 4px;
}

.branch-filter-tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.branch-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 20px;
  border: 1px solid var(--app-card-border);
  background: var(--app-card-bg);
  color: var(--app-text-main);
  cursor: pointer;
  transition: all 0.2s ease;
}

.branch-pill-btn:hover {
  border-color: #3b82f6;
  color: #3b82f6;
}

.branch-pill-btn.active {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #ffffff;
}

.pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
}

.branch-pill-btn.active .pill-dot {
  background: #ffffff;
}

/* Branch Card */
.branch-card {
  margin-bottom: 14px;
  border: 1px solid var(--app-card-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--app-card-bg);
  box-shadow: var(--app-card-shadow);
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}

.branch-card:hover {
  border-color: #93c5fd;
}

[data-theme="dark"] .branch-card:hover {
  border-color: #1e3a8a;
}

.branch-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--app-surface-subtle);
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid transparent;
  transition: background 0.2s ease;
}

.branch-header:hover {
  background: var(--app-card-border);
}

.branch-card.is-open .branch-header {
  border-bottom: 1px solid var(--app-card-border);
}

.branch-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.branch-arrow {
  font-size: 11px;
  color: var(--app-text-muted);
  transition: transform 0.2s ease;
  display: inline-block;
}

.branch-arrow.is-open {
  transform: rotate(90deg);
}

.branch-folder-icon {
  font-size: 16px;
}

.branch-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--app-text-main);
}

.branch-version-range {
  font-size: 12px;
  color: var(--app-text-muted);
  font-family: monospace;
}

.branch-header-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.branch-downloads {
  font-size: 12px;
  color: var(--app-text-muted);
}

.branch-downloads strong {
  color: var(--app-text-main);
}

.branch-body {
  padding: 10px 12px 12px 12px;
  background: var(--app-card-bg);
}

.branch-body .version-collapse {
  border-radius: 8px;
  box-shadow: none;
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
  scroll-margin-top: 24px;
}

:deep(.version-collapse .el-collapse-item:last-child) {
  border-bottom: none;
}

:deep(.version-collapse .el-collapse-item__header) {
  background: var(--app-card-bg);
  border-bottom: 1px solid transparent;
  padding: 14px 16px;
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
  padding: 12px 14px 4px 14px !important;
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
  color: var(--app-text-sub);
  font-size: 13px;
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
  font-size: 13px;
  color: var(--app-text-sub);
  white-space: nowrap;
}

/* Unified Sub-card Component for all sections */
.sub-card {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-card-border);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
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
  font-size: 15px;
  color: var(--app-text-main);
  display: flex;
  align-items: center;
  gap: 6px;
}

.sub-card-hint {
  font-size: 13px;
  color: var(--app-text-sub);
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
  font-size: 14px;
  flex-wrap: wrap;
}

.min-ver-select {
  width: 230px;
  max-width: 100%;
}

.ctrl-label {
  font-weight: 600;
  color: #1e293b;
  white-space: nowrap;
  font-size: 14px;
}

[data-theme="dark"] .ctrl-label {
  color: #cbd5e1;
}

.help-icon {
  cursor: pointer;
  color: var(--app-text-muted);
  font-size: 14px;
  user-select: none;
}

/* Section 2: Full Info Metadata Grid (High Contrast & High Legibility) */
.full-info {
  overflow: hidden;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px 24px;
  padding: 4px 0;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  min-width: 0;
}

.meta-row.full-width {
  grid-column: 1 / -1;
  align-items: flex-start;
}

.meta-label {
  width: 105px;
  flex-shrink: 0;
  color: #1e293b;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.2px;
}

[data-theme="dark"] .meta-label {
  color: #cbd5e1;
}

.meta-val {
  flex: 1;
  min-width: 0;
  color: var(--app-text-main);
  font-size: 14px;
  font-weight: 500;
  word-break: break-all;
  overflow-wrap: anywhere;
}

.meta-size-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  background: var(--app-card-bg);
  border: 1px solid var(--app-card-border);
  color: var(--app-text-main);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.meta-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.meta-status-badge.normal {
  background: var(--app-card-bg);
  border: 1px solid var(--app-card-border);
  color: var(--app-text-main);
}

.meta-status-badge.danger {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #dc2626;
  font-weight: 600;
}

[data-theme="dark"] .meta-status-badge.danger {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.45);
  color: #f87171;
}

.meta-vc-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-main);
  background: var(--app-card-bg);
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid var(--app-card-border);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.sha {
  font-size: 13px;
  word-break: break-all;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: #1e293b;
  font-weight: 500;
  background: var(--app-card-bg);
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--app-card-border);
  display: inline-block;
  line-height: 1.5;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

[data-theme="dark"] .sha {
  color: #e2e8f0;
}

.dl-link {
  color: #2563eb;
  font-size: 13px;
  font-weight: 500;
  word-break: break-all;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  display: inline-block;
  line-height: 1.5;
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color 0.15s ease;
}

.dl-link:hover {
  color: #1d4ed8;
}

[data-theme="dark"] .dl-link {
  color: #60a5fa;
}

[data-theme="dark"] .dl-link:hover {
  color: #93c5fd;
}

/* Section 3: Notes Section */
.notes-section {
  overflow: hidden;
}

.notes-list {
  margin: 6px 0 0 16px;
  padding: 0;
  font-size: 14px;
  line-height: 1.8;
  color: var(--app-text-main);
  font-weight: 450;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.empty-notes {
  font-size: 13px;
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
  font-size: 13px;
}

.tz-tag {
  font-size: 11px;
  font-weight: 600;
  color: #2563eb;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.25);
  border-radius: 4px;
  padding: 1px 5px;
  margin-left: 4px;
  letter-spacing: 0.2px;
  vertical-align: middle;
}

[data-theme="dark"] .tz-tag {
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.4);
}

.tz-sub {
  font-size: 11px;
  opacity: 0.85;
  margin-left: 2px;
  font-weight: 500;
}

.time-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  color: var(--app-text-main);
  white-space: nowrap;
}

/* Table Action Buttons - Single Row Display */
.table-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap !important;
  white-space: nowrap !important;
}

.action-btn {
  height: 28px !important;
  padding: 0 10px !important;
  border-radius: 6px !important;
  font-size: 12.5px !important;
  font-weight: 500 !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  white-space: nowrap !important;
  flex-shrink: 0 !important;
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

.popover-notes-wrap {
  display: flex;
  flex-direction: column;
}

.popover-ver-tag {
  font-weight: 700;
  color: var(--app-accent);
  font-size: 13px;
  margin-top: 8px;
  margin-bottom: 3px;
}

.popover-ver-tag:first-child {
  margin-top: 0;
}

.popover-empty-line {
  height: 6px;
}

.popover-note-line {
  font-size: 12px;
  color: var(--app-text-sub);
  line-height: 1.6;
  padding-left: 2px;
}

.missing-list {
  margin-top: 12px;
  font-size: 13px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.missing-label {
  color: #334155;
  font-weight: 600;
  font-size: 13px;
  margin-right: 4px;
  white-space: nowrap;
}

[data-theme="dark"] .missing-label {
  color: #cbd5e1;
}

.btn-text-short {
  display: none;
}

@media (max-width: 768px) {
  .page {
    padding: 12px 10px;
  }

  .breadcrumb-bar {
    margin-bottom: 12px;
  }

  .breadcrumb-bar :deep(.el-breadcrumb) {
    font-size: 13px;
    max-width: calc(100% - 50px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toolbar {
    padding: 12px 12px;
    gap: 12px;
  }

  .toolbar-info h2 {
    font-size: 18px;
  }

  .sub-row {
    font-size: 12px;
    gap: 6px;
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
    padding: 8px 10px;
    background: var(--app-surface-subtle);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .toolbar-actions .el-button {
    margin: 0 !important;
    width: 100%;
    font-size: 13px;
    padding: 0 8px;
  }

  .toolbar-actions .el-button--primary {
    grid-column: 1 / -1;
  }

  /* Stats overview & trend */
  .app-stats-overview {
    padding: 12px !important;
    gap: 12px !important;
  }

  .stats-overview-grid {
    grid-template-columns: repeat(2, 1fr) !important;
    gap: 8px !important;
  }

  .stat-mini-card {
    padding: 8px 10px !important;
    gap: 8px !important;
  }

  .stat-mini-icon {
    width: 32px !important;
    height: 32px !important;
    font-size: 15px !important;
    border-radius: 6px !important;
  }

  .stat-mini-label {
    font-size: 10px !important;
  }

  .stat-mini-val {
    font-size: 15px !important;
  }

  .stat-mini-unit {
    font-size: 10px !important;
  }

  .stat-mini-sub {
    font-size: 9.5px !important;
  }

  .stats-trend-section {
    padding-top: 10px !important;
  }

  .trend-header {
    margin-bottom: 8px !important;
  }

  .trend-title {
    font-size: 12px !important;
  }

  .trend-legend {
    gap: 8px !important;
    font-size: 10px !important;
  }

  .trend-bars-container {
    gap: 4px !important;
    height: 75px !important;
  }

  .trend-date {
    font-size: 9.5px !important;
  }

  /* Collapse & Group title */
  :deep(.version-collapse .el-collapse-item__header) {
    padding: 12px 10px !important;
    height: auto !important;
    line-height: 1.4 !important;
  }

  :deep(.version-collapse .el-collapse-item__content) {
    padding: 10px 8px 4px 8px !important;
  }

  .version-section-bar {
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 10px !important;
  }

  .branch-header {
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 8px !important;
  }

  .branch-header-right {
    width: 100% !important;
    justify-content: space-between !important;
  }

  .group-title {
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 6px !important;
    width: 100% !important;
    padding-right: 8px !important;
  }

  .group-title-main {
    font-size: 14px;
    gap: 4px;
  }

  .group-stats {
    gap: 4px !important;
    flex-wrap: wrap !important;
  }

  .group-stats :deep(.el-tag) {
    font-size: 11px !important;
    padding: 0 5px !important;
    height: 20px !important;
    line-height: 18px !important;
  }

  .date {
    font-size: 11px !important;
  }

  .sub-card {
    padding: 10px 10px;
    margin-bottom: 10px;
    border-radius: 8px;
  }

  .version-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .version-controls {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: 10px;
  }

  .ctrl-item {
    width: 100% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    flex-wrap: wrap !important;
    gap: 6px !important;
    font-size: 13px !important;
  }

  .min-ver-select {
    width: 100% !important;
  }

  .del-ver-btn {
    width: 100%;
    margin-top: 4px;
  }

  /* Meta grid: convert from 2-column to 1-column responsive layout on mobile */
  .meta-grid {
    grid-template-columns: 1fr !important;
    gap: 8px !important;
  }

  .meta-row {
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 3px !important;
  }

  .meta-label {
    width: auto !important;
    font-size: 12px !important;
    color: var(--app-text-muted) !important;
    font-weight: 500 !important;
  }

  .meta-val {
    width: 100% !important;
    font-size: 13px !important;
  }

  .sha {
    font-size: 11px !important;
    padding: 4px 8px !important;
    width: 100% !important;
    box-sizing: border-box !important;
  }

  .dl-link {
    font-size: 11.5px !important;
    width: 100% !important;
    box-sizing: border-box !important;
  }

  .mobile-radio-group {
    display: flex !important;
    flex-direction: column !important;
    width: 100% !important;
  }

  .mobile-radio-group :deep(.el-radio-button) {
    width: 100% !important;
  }

  .mobile-radio-group :deep(.el-radio-button__inner) {
    width: 100% !important;
    border-radius: 6px !important;
    margin-bottom: 4px !important;
    border-left: 1px solid var(--el-border-color) !important;
  }

  :deep(.patch-section .el-table) {
    font-size: 12px !important;
  }

  .action-btn {
    height: 26px !important;
    padding: 0 7px !important;
    font-size: 11.5px !important;
  }
}

@media (max-width: 600px) {
  .btn-text-full {
    display: none;
  }

  .btn-text-short {
    display: inline;
  }

  .toolbar-actions .el-button {
    font-size: 12px !important;
    padding: 0 4px !important;
  }
}

.preview-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 0;
}

.preview-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 8px;
  background: var(--bg-hover, rgba(255, 255, 255, 0.04));
}

.preview-lbl {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #94a3b8);
}

.preview-val {
  font-size: 14px;
}

.preview-asset-tags {
  display: flex;
  flex-wrap: wrap;
  max-height: 150px;
  overflow-y: auto;
}

.stats-coverage-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
}

.coverage-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.coverage-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #f8fafc);
}

.coverage-subtitle {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  margin-left: 10px;
}

.coverage-stacked-bar {
  display: flex;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  margin-bottom: 16px;
}

.stacked-segment {
  height: 100%;
  transition: width 0.3s ease;
}

.coverage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.coverage-item {
  background: var(--bg-hover, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.06));
  border-radius: 10px;
  padding: 10px 12px;
}

.coverage-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.coverage-item-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.coverage-ver-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #f8fafc);
}

.coverage-ver-code {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

.coverage-item-bottom {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  margin-bottom: 6px;
}

.coverage-pct {
  font-weight: 600;
  color: var(--text-primary, #f8fafc);
}
</style>

