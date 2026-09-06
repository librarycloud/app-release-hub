import {
  clientVersionController,
  serveReleaseController,
  servePatchController,
} from "../controllers/appController.js";

export default async function publicRoutes(fastify) {
  // Client version check — no auth required
  fastify.get("/api/apps/:appId/version/android", clientVersionController);

  // File serving — no auth, but path-validated and rate-limited at app level
  fastify.get("/api/apps/:appId/releases/:filename", serveReleaseController);
  fastify.get("/api/apps/:appId/patches/:filename", servePatchController);
}
