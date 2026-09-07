# App Release Hub API 接口文档

## 基础说明

- **接口基准路径**：`http(s)://<your-domain-or-ip>:<port>`
- **管理接口鉴权**：请求头携带 `X-API-Key: <ADMIN_API_KEY>`
- **客户端接口**：完全公开，无需 Token，自带频率限制（默认 60 次/分钟/IP）

---

## 一、客户端公开接口

### 1. 检查版本与增量更新

- **方法**：`GET`
- **路径**：
  - 通用路径：`/api/apps/:appId/version`
  - 平台路径：`/api/apps/:appId/version/:platform`（例如 `/android`、`/windows`、`/macos` 等）
- **参数**：
  - `versionCode`（可选，数字）：客户端当前安装的版本号

#### 响应示例（命中增量更新）

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "hasUpdate": true,
    "updateType": "incremental",
    "versionCode": 162,
    "versionName": "1.2.62",
    "minVersionCode": 1,
    "forceUpdate": false,
    "releaseNotes": [
      "v1.2.62: 新增配方智能校对",
      "v1.2.62: 优化网络传输与离线缓存",
      "v1.2.61: 修复部分分享问题"
    ],
    "historyReleaseNotes": [
      {
        "versionCode": 162,
        "versionName": "1.2.62",
        "releaseNotes": ["新增配方智能校对", "优化网络传输与离线缓存"]
      },
      {
        "versionCode": 161,
        "versionName": "1.2.61",
        "releaseNotes": ["修复部分分享问题"]
      }
    ],
    "changelogUrl": "https://github.com/yourorg/your-repo/releases/tag/v1.2.62",
    "publishedAt": "2026-09-06",
    "downloadBaseUrl": "https://hub.example.com",
    "fromVersionCode": 158,
    "patchUrl": "/api/apps/android-main/patches/patch-v158-to-v162.patch",
    "patchSize": 1843200,
    "patchSha256": "3a4b5c6d...",
    "targetApkSha256": "9f8e7d6c...",
    "fallbackUrl": "/api/apps/android-main/releases/release-v162.apk",
    "fallbackSize": 52428800
  }
}
```

#### 响应示例（全量更新）

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "hasUpdate": true,
    "updateType": "full",
    "versionCode": 162,
    "versionName": "1.2.62",
    "minVersionCode": 1,
    "forceUpdate": false,
    "releaseNotes": ["优化性能"],
    "historyReleaseNotes": [
      {
        "versionCode": 162,
        "versionName": "1.2.62",
        "releaseNotes": ["优化性能"]
      }
    ],
    "changelogUrl": "https://github.com/yourorg/your-repo/releases/tag/v1.2.62",
    "publishedAt": "2026-09-06",
    "downloadBaseUrl": "https://hub.example.com",
    "downloadUrl": "/api/apps/android-main/releases/release-v162.apk",
    "sha256": "9f8e7d6c...",
    "size": 52428800
  }
}
```

---

### 2. 下载安装包（全量）

- **方法**：`GET`
- **路径**：`/api/apps/:appId/releases/:filename`
- **说明**：支持 `.apk`、`.exe`、`.msi`、`.dmg`、`.pkg`、`.appimage`、`.deb`、`.rpm`、`.ipa`、`.zip` 等格式。返回文件流，带 `Content-Disposition: attachment`。

---

### 3. 下载差分补丁包（增量）

- **方法**：`GET`
- **路径**：`/api/apps/:appId/patches/:filename`
- **说明**：二进制字节流 `application/octet-stream`。

---

## 二、管理后台接口（需携带 X-API-Key）

### 1. App 管理

#### 获取所有 App 列表
- `GET /admin/apps`
- 响应：返回所有已注册 App 数组，包含 `autoSync`、`autoSyncIntervalMinutes`、`assetPattern`、`lastSyncedAt`、`lastSyncError` 等字段。

#### 注册新 App
- `POST /admin/apps`
- 请求体：
  ```json
  {
    "appId": "android-main",
    "name": "TCM Android 主版",
    "platform": "android",
    "assetPattern": ".*\\.apk$",
    "githubRepo": "yourorg/your-repo",
    "githubApiUrl": "https://api.github.com",
    "autoSync": true,
    "autoSyncIntervalMinutes": 30
  }
  ```
- 字段说明：
  - `autoSync` (boolean): 是否开启后台自动定时检测。
  - `autoSyncIntervalMinutes` (number): 独立自动检测周期（单位：分钟，默认为 60，最低支持 5 分钟）。

#### 更新 App 配置
- `PATCH /admin/apps/:appId`
- 请求体：支持修改 `name`、`platform`、`githubRepo`、`githubApiUrl`、`assetPattern`、`autoSync`、`autoSyncIntervalMinutes` 等属性。

#### 删除 App
- `DELETE /admin/apps/:appId`

---

### 2. 发布与同步

#### 手动同步单个 App 最新 Release
- `POST /admin/apps/:appId/sync`
- 行为：拉取该 App 绑定的 GitHub Repo 的最新 Release，下载安装包，并为最近 3 个历史版本自动生成差分包。

#### 触发全部 App 自动同步
- `POST /admin/sync-all`
- 行为：立即运行一轮后台检测，自动同步所有开启了 `autoSync: true` 的 App。

#### 批量导入 GitHub 历史版本
- `POST /admin/apps/:appId/sync-history`
- 请求体：
  ```json
  {
    "limit": 20,
    "autoGeneratePatches": false
  }
  ```
- 说明：
  - 扫描指定 GitHub 仓库历史所有 Releases，拉取安装包与 `app-version.json` 元数据进行补录。
  - 自动跳过已存在的完整版本，自动识别 release body 中的更新说明（无 json 时亦可兼容）。
  - 智能重新计算系统全局最高版本，确保不会错误覆盖已有最新版本。
  - `autoGeneratePatches`: 可选，为 true 时在历史版本导入后自动向最新版本生成差分补丁。

---

### 3. 版本与更新策略管理

#### 手动补录旧版本（支持本地文件上传或外部 URL）
- `POST /admin/apps/:appId/versions`
- **模式 A：上传本地安装包（Multipart 表单）**
  - 请求头：`Content-Type: multipart/form-data`
  - 表单字段：
    - `versionCode` (数字, 必填): 如 10200
    - `versionName` (字符串, 必填): 如 "1.2.0"
    - `file` (文件): 本地安装包（.apk, .exe, .dmg 等）
    - `publishedAt` (日期, 选填): "YYYY-MM-DD"
    - `forceUpdate` (布尔, 选填): "true" / "false"
    - `minVersionCode` (数字, 选填): 默认 1
    - `releaseNotes` (换行分割字符串 或 JSON 数组, 选填)
    - `changelogUrl` (字符串, 选填)
- **模式 B：填写文件 URL / 本地路径（JSON 请求体）**
  - 请求头：`Content-Type: application/json`
  - 请求体：
    ```json
    {
      "versionCode": 10200,
      "versionName": "1.2.0",
      "publishedAt": "2024-05-01",
      "forceUpdate": false,
      "minVersionCode": 1,
      "releaseNotes": ["修复历史闪退问题", "优化网络连接"],
      "fileUrl": "https://cdn.example.com/apps/app-v1.2.0.apk",
      "sha256": "3a4b...",
      "size": 25165824
    }
    ```

#### 更新版本配置（强制更新 / 最低兼容版本 / 更新说明）
- `PATCH /admin/apps/:appId/versions/:versionCode`
- 请求体：
  ```json
  {
    "forceUpdate": true,
    "minVersionCode": 150,
    "versionName": "1.2.62",
    "releaseNotes": ["修复严重安全漏洞"]
  }
  ```
- 字段说明：
  - `forceUpdate` (boolean): 是否开启强制更新。开启后，低于此版本的客户端检测更新时均会标记 `forceUpdate: true`。
  - `minVersionCode` (number): 最低兼容版本号。客户端当前版本号低于此值时将触发强制更新。
  - `releaseNotes` (array): 在线修改该版本的更新说明列表。

#### 删除指定版本
- `DELETE /admin/apps/:appId/versions/:versionCode`
- 行为：
  - 从数据库中删除该版本记录。
  - 级联删除所有以该版本为来源（`from_version_code`）或目标（`target_version_code`）的差分补丁记录。
  - 清理服务器磁盘上的安装包文件及相关差分包文件。
  - 若删除的是最新版本（`is_latest`），系统自动将剩余版本中最高的版本重设为最新版本，并同步更新 `latest.{ext}`。

---

### 4. 差分补丁管理

#### 获取指定 App 的版本矩阵
- `GET /admin/apps/:appId/patches`
- 响应：按目标版本分组的补丁矩阵列表。

#### 手动生成单个差分包
- `POST /admin/apps/:appId/patches/generate`
- 请求体：
  ```json
  {
    "fromVersionCode": 155,
    "targetVersionCode": 162
  }
  ```

#### 一键补齐指定目标版本的所有历史差分包
- `POST /admin/apps/:appId/patches/generate-all`
- 请求体：
  ```json
  {
    "targetVersionCode": 162
  }
  ```

---

### 5. 请求与下载次数统计

#### 全局统计概览
- `GET /admin/stats/overview`
- 响应示例：
  ```json
  {
    "code": 0,
    "message": "ok",
    "data": {
      "totalApps": 3,
      "autoSyncApps": 2,
      "totalChecks": 1284,
      "totalDownloads": 432,
      "todayChecks": 86,
      "todayDownloads": 28,
      "todayFullDownloads": 12,
      "todayPatchDownloads": 16
    }
  }
  ```

#### 单 App 统计与近 7 天趋势
- `GET /admin/apps/:appId/stats`
- 响应示例：
  ```json
  {
    "code": 0,
    "message": "ok",
    "data": {
      "appId": "android-main",
      "totalChecks": 950,
      "totalDownloads": 320,
      "todayChecks": 64,
      "todayDownloads": 21,
      "totalFullDownloads": 110,
      "totalPatchDownloads": 210,
      "recentDays": [
        {
          "date": "2026-09-01",
          "check_count": 80,
          "full_download_count": 10,
          "patch_download_count": 22,
          "total_downloads": 32
        }
      ]
    }
  }
  ```

