import {
  clientVersionController,
  serveReleaseController,
  servePatchController,
} from "../controllers/appController.js";

export default async function publicRoutes(fastify) {
  // Client version check — no auth required (supports universal & platform-specific)
  fastify.get("/api/apps/:appId/version", clientVersionController);
  fastify.get("/api/apps/:appId/version/:platform", clientVersionController);

  // File serving — no auth, but path-validated and rate-limited at app level
  fastify.get("/api/apps/:appId/releases/:filename", serveReleaseController);
  fastify.get("/api/apps/:appId/patches/:filename", servePatchController);
}
