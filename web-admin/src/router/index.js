import { createRouter, createWebHistory } from "vue-router";
import { getApiKey } from "../api/appHub.js";

const routes = [
  { path: "/login", component: () => import("../views/Login.vue"), meta: { public: true } },
  { path: "/", component: () => import("../views/AppList.vue") },
  { path: "/apps/:appId", component: () => import("../views/AppDetail.vue") },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  if (!to.meta.public && !getApiKey()) return "/login";
});

export default router;
