import { config } from "../config.js";

export async function apiKeyAuth(request, reply) {
  const key = request.headers["x-api-key"] || "";
  if (!config.adminApiKey) {
    return reply.code(500).send({
      code: 500,
      message: "服务器未配置 ADMIN_API_KEY 环境变量，请在 .env 中设置",
    });
  }
  if (key !== config.adminApiKey) {
    return reply.code(401).send({ code: 401, message: "API Key 错误，验证失败" });
  }
}
