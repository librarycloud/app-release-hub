# App Release Hub

一个轻量、自托管的多 App 版本分发与增量更新中心。

- 📦 管理多个 App（Android / Windows / macOS）
- 🔄 对接任意 GitHub Release（公开或私有仓库）
- ⚡ 自动生成 bsdiff 差分补丁，大幅减少用户下载量
- 🛡️ 支持强制更新策略（一键开启/最低兼容版本控制）与历史版本删除管理
- 🗄️ SQLite 存储，零外部依赖
- 🖥️ Vue 3 管理后台

---

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env，至少设置 ADMIN_API_KEY
docker-compose up -d
```

访问 `http://localhost:8080` 打开管理后台。

### 方式二：本地开发

```bash
# 后端
cd backend
cp .env.example .env   # 编辑配置
npm install
npm run dev            # 启动在 :3000

# 前端（另开终端）
cd web-admin
npm install
npm run dev            # 启动在 :5173
```

---

## 系统要求

| 依赖 | 说明 |
|------|------|
| Node.js 20+ | 后端运行时 |
| bsdiff | 生成增量补丁（`apt install bsdiff` / `brew install bsdiff`） |
| Docker（可选） | 一键部署 |

---

## 配置说明

编辑 `backend/.env`：

| 变量 | 说明 |
|------|------|
| `ADMIN_API_KEY` | 管理后台鉴权 Key，自行设置一个随机字符串 |
| `DOWNLOAD_BASE_URL` | 可选，CDN 地址前缀，留空则用本服务器地址 |
| `GITHUB_TOKEN_<APPID>` | 私有仓库 Token，如 `GITHUB_TOKEN_ANDROID_MAIN` |

---

## 客户端集成

### 1. 检查更新接口

通用路由（所有平台客户端均可使用）：
```
GET /api/apps/{appId}/version?versionCode=158
```
平台专属路由（向后兼容）：
```
GET /api/apps/{appId}/version/{platform}?versionCode=158
```
（例如 `/api/apps/android-main/version/android` 或 `/api/apps/win-client/version/windows`）

响应示例（有增量包）：
```json
{
  "updateType": "incremental",
  "versionCode": 162,
  "versionName": "1.2.62",
  "patchUrl": "/api/apps/android-main/patches/patch-v158-to-v162.patch",
  "patchSize": 1843200,
  "patchSha256": "abc123...",
  "fallbackUrl": "/api/apps/android-main/releases/release-v162.apk",
  "fallbackSize": 52428800,
  "hasUpdate": true,
  "forceUpdate": false,
  "releaseNotes": ["修复若干问题", "性能优化"]
}
```

### 2. 客户端处理逻辑

- `updateType: "incremental"` → 下载 `patchUrl`，使用 bspatch 合成新安装包
- `updateType: "full"` → 下载 `downloadUrl` 全量包直接安装
- 合成前校验 `patchSha256`，合成后校验安装包完整性

---

## 多平台 Release 资产识别规范

同一 GitHub Release 包含多个平台文件时，系统支持以下 3 级精准识别策略：

1. **伴生元数据清单（推荐）**：
   在 Release 中上传对应平台的元数据 JSON，如 `app-version.android.json`、`app-version.windows.json`、`app-version.macos.json` 或 `app-version.json`。
   若清单中包含 `"fileName": "MyApp-Setup.exe"`，系统将精确锁定该文件。
2. **自定义正则匹配（`assetPattern`）**：
   在 App 管理界面中设置「安装包匹配正则」，例如：
   - Windows: `.*-win-x64\.exe$`
   - macOS (Apple Silicon): `.*-mac-arm64\.dmg$`
   - macOS (Intel): `.*-mac-x64\.dmg$`
   - Linux: `.*\.AppImage$`
3. **内置智能推断回退**：
   若未配置正则，系统根据 App 注册平台（`android` / `windows` / `macos` / `linux` / `ios`）智能比对标准安装包后缀与平台关键词，并自动过滤签名（`.sha256` / `.sig`）与中间构建文件（`-unaligned.apk`、`uninstall.exe`）。

---

## GitHub Actions 自动触发同步

在你的 App 仓库中添加 `.github/workflows/notify-release-hub.yml`，参见本仓库中的示例文件：
`.github/workflows/sync-trigger-example.yml`

---

## API 文档

详见 [docs/api.md](docs/api.md)。
