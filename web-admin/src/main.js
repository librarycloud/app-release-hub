import { createApp } from "vue";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "./styles/theme.css";
import {
  Sunny,
  Moon,
  Monitor,
  Key,
  Refresh,
  Plus,
  Search,
  Setting,
  Download,
  Delete,
  Warning,
  Check,
  ArrowRight,
} from "@element-plus/icons-vue";
import router from "./router/index.js";
import App from "./App.vue";
import { initTheme } from "./utils/useTheme.js";

initTheme();

const app = createApp(App);
app.use(ElementPlus);
app.use(router);

const icons = {
  Sunny,
  Moon,
  Monitor,
  Key,
  Refresh,
  Plus,
  Search,
  Setting,
  Download,
  Delete,
  Warning,
  Check,
  ArrowRight,
};

for (const [name, comp] of Object.entries(icons)) {
  app.component(name, comp);
}
app.mount("#app");
