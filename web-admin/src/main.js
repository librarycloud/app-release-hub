import { createApp } from "vue";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "./styles/theme.css";
import * as ElementPlusIconsVue from "@element-plus/icons-vue";
import router from "./router/index.js";
import App from "./App.vue";
import { initTheme } from "./utils/useTheme.js";

initTheme();

const app = createApp(App);
app.use(ElementPlus);
app.use(router);
for (const [name, comp] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, comp);
}
app.mount("#app");
