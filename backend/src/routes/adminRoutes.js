import { apiKeyAuth } from "../middlewares/apiKeyAuth.js";
import {
  listAppsController,
  createAppController,
  updateAppController,
  deleteAppController,
  syncReleaseController,
  patchMatrixController,
  generatePatchController,
  generateAllPatchesController,
  syncAllAppsController,
  updateVersionController,
  deleteVersionController,
  syncHistoryReleasesController,
  createVersionController,
  getGlobalStatsController,
  getAppStatsController,
  uploadPatchController,
  testWebhookController,
} from "../controllers/appController.js";

const auth = { preHandler: [apiKeyAuth], config: { rateLimit: false } };

export default async function adminRoutes(fastify) {
  // Statistics
  fastify.get("/admin/stats/overview", auth, getGlobalStatsController);
  fastify.get("/admin/apps/:appId/stats", auth, getAppStatsController);

  // App registry
  fastify.get("/admin/apps", auth, listAppsController);
  fastify.post("/admin/apps", auth, createAppController);
  fastify.patch("/admin/apps/:appId", auth, updateAppController);
  fastify.delete("/admin/apps/:appId", auth, deleteAppController);

  // Release management
  fastify.post("/admin/sync-all", auth, syncAllAppsController);
  fastify.post("/admin/apps/:appId/sync", auth, syncReleaseController);
  fastify.post("/admin/apps/:appId/sync-history", auth, syncHistoryReleasesController);

  // Version management
  fastify.post("/admin/apps/:appId/versions", auth, createVersionController);
  fastify.patch("/admin/apps/:appId/versions/:versionCode", auth, updateVersionController);
  fastify.delete("/admin/apps/:appId/versions/:versionCode", auth, deleteVersionController);

  // Patch matrix and generation
  fastify.get("/admin/apps/:appId/patches", auth, patchMatrixController);
  fastify.post("/admin/apps/:appId/patches/generate", auth, generatePatchController);
  fastify.post("/admin/apps/:appId/patches/generate-all", auth, generateAllPatchesController);
  fastify.post("/admin/apps/:appId/patches/upload", auth, uploadPatchController);

  // Webhooks
  fastify.post("/admin/apps/:appId/webhook/test", auth, testWebhookController);
}

