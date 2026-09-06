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
} from "../controllers/appController.js";

const auth = { preHandler: [apiKeyAuth] };

export default async function adminRoutes(fastify) {
  // App registry
  fastify.get("/admin/apps", auth, listAppsController);
  fastify.post("/admin/apps", auth, createAppController);
  fastify.patch("/admin/apps/:appId", auth, updateAppController);
  fastify.delete("/admin/apps/:appId", auth, deleteAppController);

  // Release management
  fastify.post("/admin/apps/:appId/sync", auth, syncReleaseController);

  // Patch matrix and generation
  fastify.get("/admin/apps/:appId/patches", auth, patchMatrixController);
  fastify.post("/admin/apps/:appId/patches/generate", auth, generatePatchController);
  fastify.post("/admin/apps/:appId/patches/generate-all", auth, generateAllPatchesController);
}
