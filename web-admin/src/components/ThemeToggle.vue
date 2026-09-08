<template>
  <el-dropdown trigger="click" @command="handleCommand">
    <el-tooltip :content="tooltipText" placement="bottom" :show-after="400">
      <el-button
        class="theme-toggle-btn"
        circle
        :class="{ 'is-dark': isDark, 'is-system': themeMode === 'system' }"
      >
        <el-icon :size="16" class="theme-icon">
          <Monitor v-if="themeMode === 'system'" />
          <Moon v-else-if="themeMode === 'dark'" />
          <Sunny v-else />
        </el-icon>
      </el-button>
    </el-tooltip>
    <template #dropdown>
      <el-dropdown-menu class="theme-dropdown-menu">
        <el-dropdown-item command="light" :class="{ 'is-active': themeMode === 'light' }">
          <div class="theme-menu-item">
            <el-icon :size="15"><Sunny /></el-icon>
            <span class="theme-menu-label">浅色模式</span>
            <el-icon v-if="themeMode === 'light'" class="theme-check-icon"><Check /></el-icon>
          </div>
        </el-dropdown-item>
        <el-dropdown-item command="dark" :class="{ 'is-active': themeMode === 'dark' }">
          <div class="theme-menu-item">
            <el-icon :size="15"><Moon /></el-icon>
            <span class="theme-menu-label">暗色模式</span>
            <el-icon v-if="themeMode === 'dark'" class="theme-check-icon"><Check /></el-icon>
          </div>
        </el-dropdown-item>
        <el-dropdown-item command="system" divided :class="{ 'is-active': themeMode === 'system' }">
          <div class="theme-menu-item">
            <el-icon :size="15"><Monitor /></el-icon>
            <span class="theme-menu-label">跟随系统</span>
            <span class="theme-menu-hint">({{ systemPrefersDark ? '深色' : '浅色' }})</span>
            <el-icon v-if="themeMode === 'system'" class="theme-check-icon"><Check /></el-icon>
          </div>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
import { computed } from "vue";
import { Sunny, Moon, Monitor, Check } from "@element-plus/icons-vue";
import { useTheme } from "../utils/useTheme.js";

const { themeMode, isDark, systemPrefersDark, setTheme } = useTheme();

const tooltipText = computed(() => {
  if (themeMode.value === "system") {
    return `主题: 跟随系统 (${systemPrefersDark.value ? "深色" : "浅色"})`;
  }
  return themeMode.value === "dark" ? "主题: 暗色模式" : "主题: 浅色模式";
});

function handleCommand(mode) {
  setTheme(mode);
}
</script>

<style scoped>
.theme-toggle-btn {
  border: 1px solid var(--app-card-border);
  background: var(--app-card-bg);
  color: var(--app-text-main);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.theme-toggle-btn:hover {
  transform: scale(1.08);
  border-color: var(--app-accent);
  color: var(--app-accent);
}

.theme-toggle-btn.is-dark {
  color: #fbbf24;
}

.theme-toggle-btn.is-system {
  color: #3b82f6;
}

[data-theme="dark"] .theme-toggle-btn.is-system {
  color: #60a5fa;
}

.theme-icon {
  transition: transform 0.3s ease;
}

.theme-dropdown-menu {
  min-width: 155px;
  padding: 6px 0;
}

.theme-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 2px 4px;
}

.theme-menu-label {
  font-size: 13px;
  flex: 1;
}

.theme-menu-hint {
  font-size: 11px;
  color: var(--app-text-muted, #94a3b8);
  margin-left: auto;
  margin-right: 6px;
}

.theme-check-icon {
  font-size: 13px;
  color: var(--app-accent, #3b82f6);
  font-weight: bold;
}

:deep(.el-dropdown-menu__item.is-active) {
  color: var(--app-accent, #3b82f6);
  background-color: var(--app-surface-subtle, rgba(59, 130, 246, 0.08));
  font-weight: 600;
}
</style>
