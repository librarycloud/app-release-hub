import { getApp } from "./storageAdapter.js";

async function sendJsonPost(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Webhook 请求失败: HTTP ${res.status}`);
  }
}

export async function sendWebhookNotification(appId, eventType, data) {
  const app = getApp(appId);
  if (!app || !app.webhook_url) return;

  const url = app.webhook_url;
  const type = app.webhook_type || "generic";
  const appName = app.name || appId;

  try {
    if (eventType === "release_synced") {
      const { versionName, versionCode, patchesCount, errorCount, size, releaseNotes, isManual } = data;
      const title = `🚀 ${appName} 新版本发布`;
      const sizeMB = (size / 1024 / 1024).toFixed(2) + " MB";
      const notes = (releaseNotes || []).join("\n- ") ? `- ${(releaseNotes || []).join("\n- ")}` : "无更新日志";
      const contentStr = `版本: ${versionName} (Build ${versionCode})\n大小: ${sizeMB}\n补丁: 成功 ${patchesCount} 个 / 失败 ${errorCount} 个\n来源: ${isManual ? "手动录入" : "GitHub 自动同步"}\n\n📝 更新日志:\n${notes}`;
      
      await pushMessage(url, type, title, contentStr);
    } else if (eventType === "sync_error") {
      const title = `⚠️ ${appName} 同步异常`;
      const contentStr = `发生时间: ${new Date().toLocaleString()}\n错误详情: ${data.error}`;
      await pushMessage(url, type, title, contentStr);
    } else if (eventType === "rollback") {
      const { versionName, versionCode } = data;
      const title = `⏪ ${appName} 版本回滚通知`;
      const contentStr = `系统已将当前生效版本紧急回滚至:\nv${versionName} (Build ${versionCode})\n回滚时间: ${new Date().toLocaleString()}`;
      await pushMessage(url, type, title, contentStr);
    } else if (eventType === "test") {
      await pushMessage(url, type, `✅ ${appName} Webhook 测试`, "这是一条测试消息，您的 Webhook 配置正常。");
    }
  } catch (err) {
    console.warn(`[notificationService] Webhook 通知发送失败 (${appId}):`, err.message);
  }
}

async function pushMessage(url, type, title, content) {
  switch (type) {
    case "feishu":
      await sendJsonPost(url, {
        msg_type: "post",
        content: {
          post: {
            zh_cn: {
              title: title,
              content: [
                [{ tag: "text", text: content }]
              ]
            }
          }
        }
      });
      break;
    case "dingtalk":
      await sendJsonPost(url, {
        msgtype: "markdown",
        markdown: {
          title: title,
          text: `### ${title}\n\n${content.replace(/\n/g, "\n\n")}`
        }
      });
      break;
    case "wecom":
      await sendJsonPost(url, {
        msgtype: "markdown",
        markdown: {
          content: `**${title}**\n\n${content}`
        }
      });
      break;
    case "generic":
    default:
      await sendJsonPost(url, { title, content });
      break;
  }
}
