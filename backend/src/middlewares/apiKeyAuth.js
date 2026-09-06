import { config } from "../config.js";

export async function apiKeyAuth(request, reply) {
  const key = request.headers["x-api-key"] || "";
  if (!config.adminApiKey || key !== config.adminApiKey) {
    return reply.code(401).send({ code: 401, message: "需要有效的 X-API-Key" });
  }
}
