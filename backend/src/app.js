import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { initSchema } from "./db/schema.js";
import { startAutoSyncScheduler } from "./services/autoSyncService.js";
import publicRoutes from "./routes/publicRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";

// Initialize database schema
initSchema();

const fastify = Fastify({
  logger: { level: config.nodeEnv === "production" ? "warn" : "info" },
  trustProxy: true,
});

// CORS
await fastify.register(cors, { origin: true });

// Rate limiting — applied globally; protects public download endpoints from abuse
await fastify.register(rateLimit, {
  max: 60,
  timeWindow: "1 minute",
  errorResponseBuilder: () => ({ code: 429, message: "请求过于频繁，请稍后再试" }),
});

// Routes
await fastify.register(publicRoutes);
await fastify.register(adminRoutes);

// Health check
fastify.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

// Global error handler
fastify.setErrorHandler((err, _request, reply) => {
  const status = err.statusCode || 500;
  fastify.log.error(err);
  reply.code(status).send({ code: status, message: err.message || "服务器内部错误" });
});

try {
  await fastify.listen({ port: config.port, host: config.host });
  console.log(`App Release Hub running on http://${config.host}:${config.port}`);
  startAutoSyncScheduler();
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
