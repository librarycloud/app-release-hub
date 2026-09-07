import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/admin": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("element-plus")) {
              return "element-plus";
            }
            if (id.includes("vue") || id.includes("vue-router")) {
              return "vue-core";
            }
            if (id.includes("axios")) {
              return "vendor-utils";
            }
          }
        },
      },
    },
  },
});
