import {
  clientVersionController,
  serveReleaseController,
  servePatchController,
  electronUpdateController,
  iosManifestController,
  getShareInfoController,
} from "../controllers/appController.js";
import { config } from "../config.js";

export default async function publicRoutes(fastify) {
  const publicLimit = { rateLimit: { max: config.rateLimitPublic, timeWindow: "1 minute" } };
  const downloadLimit = { rateLimit: { max: config.rateLimitDownloads, timeWindow: "1 minute" } };

  // Public Share Page info
  fastify.get("/api/apps/:appId/share", { config: publicLimit }, getShareInfoController);

  // Client version check (supports token query via controller)
  fastify.get("/api/apps/:appId/version", { config: publicLimit }, clientVersionController);
  fastify.get("/api/apps/:appId/version/:platform", { config: publicLimit }, clientVersionController);

  // File serving
  fastify.get("/api/apps/:appId/releases/:filename", { config: downloadLimit }, serveReleaseController);
  fastify.get("/api/apps/:appId/patches/:filename", { config: downloadLimit }, servePatchController);

  // Ecosystem Support
  fastify.get("/api/apps/:appId/update/darwin/:currentVersion", { config: publicLimit }, electronUpdateController);
  fastify.get("/api/apps/:appId/install.plist", { config: publicLimit }, iosManifestController);
}
