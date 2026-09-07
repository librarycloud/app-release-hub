<template>
  <el-tooltip :content="isDark ? '切换为明亮模式' : '切换为暗色模式'" placement="bottom">
    <el-button
      class="theme-toggle-btn"
      circle
      :class="{ 'is-dark': isDark }"
      @click="toggleTheme"
    >
      <el-icon :size="16" class="theme-icon">
        <Sunny v-if="isDark" />
        <Moon v-else />
      </el-icon>
    </el-button>
  </el-tooltip>
</template>

<script setup>
import { useTheme } from "../utils/useTheme.js";

const { isDark, toggleTheme } = useTheme();
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
  transform: rotate(15deg) scale(1.08);
  border-color: var(--app-accent);
  color: var(--app-accent);
}

.theme-toggle-btn.is-dark {
  color: #fbbf24;
}

.theme-icon {
  transition: transform 0.3s ease;
}
</style>
