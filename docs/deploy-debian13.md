# Debian 13 原生部署教程（Node.js 24 LTS + Nginx 最新版 + acme.sh SSL）

本文档专为 **Debian 13 (Trixie)** 生产环境定制，采用原生部署（不使用 Docker）：
- **后端运行**：Node.js 24 LTS + PM2 进程守护
- **增量工具**：`bsdiff`
- **Web 服务**：Nginx.org 官方最新版（Mainline/Stable）
- **SSL 证书**：`acme.sh` 自动化申请与静默续签

---

## 目录
- [一、基础依赖与 Node.js 24 安装](#一基础依赖与-nodejs-24-安装)
- [二、安装官方最新版 Nginx](#二安装官方最新版-nginx)
- [三、部署后端与前端应用](#三部署后端与前端应用)
- [四、安装 acme.sh 并签发 SSL 证书](#四安装-acmesh-并签发-ssl-证书)
- [五、配置 Nginx 完整动静托管与反代](#五配置-nginx-完整动静托管与反代)
- [六、运维常用命令](#六运维常用命令)

---

## 一、基础依赖与 Node.js 24 安装

### 1. 更新系统并安装基础编译工具
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git bsdiff build-essential python3 ca-certificates gnupg lsb-release
```

### 2. 安装 Node.js 24 LTS 与 PM2
使用官方 NodeSource 源：
```bash
# 导入 NodeSource 24.x 源
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# 全局安装 PM2
sudo npm install -g pm2

# 验证版本
node -v   # 应输出 v24.x.x
npm -v    # 应输出 10.x.x 或 11.x.x
```

---

## 二、安装官方最新版 Nginx

默认 `apt install nginx` 安装的是 Debian 发行版仓库中锁定的旧版本。为了获取 HTTP/3、最新安全补丁与性能提升，直接配置 `nginx.org` 官方源：

### 1. 导入 Nginx 官方 GPG 密钥
```bash
curl -fsSL https://nginx.org/keys/nginx_signing.key | gpg --dearmor | sudo tee /usr/share/keyrings/nginx-archive-keyring.gpg >/dev/null

# 验证密钥
gpg --dry-run --quiet --no-keyring --import --import-options import-show /usr/share/keyrings/nginx-archive-keyring.gpg
```

### 2. 添加 Nginx 官方 APT 仓库
```bash
# 最新主线版 (Mainline) 推荐：
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/mainline/debian $(lsb_release -cs) nginx" | sudo tee /etc/apt/sources.list.d/nginx.list

# 设置官方源优先级高于 Debian 默认源
echo -e "Package: *\nPin: origin nginx.org\nPin: release o=nginx\nPin-Priority: 900\n" | sudo tee /etc/apt/preferences.d/99nginx
```
> 💡 若系统代号未被官方主线库同步，可将 `$(lsb_release -cs)` 临时替换为 `bookworm`。

### 3. 安装并启动 Nginx
```bash
sudo apt update
sudo apt install -y nginx

# 检查版本与运行状态
nginx -v
sudo systemctl enable nginx
sudo systemctl start nginx
```
> ⚠️ **注意**：Nginx 官方版配置目录为 `/etc/nginx/conf.d/*.conf`（而不是 Debian 打包版的 `sites-available` / `sites-enabled`）。

---

## 三、部署后端与前端应用

假设统一安装至 `/opt/app-release-hub`：

### 1. 拉取代码
```bash
cd /opt
sudo git clone <你的仓库地址>/app-release-hub.git
sudo chown -R $USER:$USER /opt/app-release-hub
cd /opt/app-release-hub
```

### 2. 配置与启动后端
```bash
cd /opt/app-release-hub/backend

# 生产模式只安装核心依赖（跳过测试库）
npm install --omit=dev

# 配置环境变量
cp .env.example .env
vim .env
```
修改 `.env` 核心项：
```ini
PORT=3000
HOST=127.0.0.1
NODE_ENV=production
ADMIN_API_KEY=your-secure-random-key-123456
DB_PATH=data/hub.db
FILES_DIR=data/files
DOWNLOAD_BASE_URL=
```

使用 PM2 启动并注册自启：
```bash
# 启动
pm2 start src/app.js --name "release-hub-backend"

# 保存并配置开机自启
pm2 save
pm2 startup
# 复制控制台输出的 sudo env PATH=... 命令执行即可
```

### 3. 构建前端管理界面
```bash
cd /opt/app-release-hub/web-admin
npm install
npm run build
# 产物生成在 /opt/app-release-hub/web-admin/dist
```

---

## 四、安装 acme.sh 并签发 SSL 证书

### 1. 安装 acme.sh
将 `your_email@example.com` 替换为你的常用邮箱（用于接收到期报警）：
```bash
curl https://get.acme.sh | sh -s email=your_email@example.com
source ~/.bashrc
~/.acme.sh/acme.sh --upgrade --auto-upgrade
```

### 2. 创建证书存放与验证目录
```bash
# 证书存储目录
sudo mkdir -p /etc/nginx/ssl

# ACME 验证路径
sudo mkdir -p /var/www/acme-challenge
sudo chmod -R 755 /var/www/acme-challenge
```

### 3. 配置 Nginx 临时 HTTP 验证站点
创建 `/etc/nginx/conf.d/app-release-hub.conf`：
```bash
sudo vim /etc/nginx/conf.d/app-release-hub.conf
```
写入初始 HTTP 验证配置（请替换 `release.yourcompany.com` 为你的真实域名）：
```nginx
server {
    listen 80;
    server_name release.yourcompany.com;

    # ACME 挑战验证通道
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme-challenge;
        default_type "text/plain";
        allow all;
    }

    location / {
        return 200 "Waiting for SSL certificate...";
    }
}
```
重载 Nginx：
```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4. 签发并安装证书
切换 CA 为 Let's Encrypt（可选，ZeroSSL 亦可）：
```bash
~/.acme.sh/acme.sh --set-default-ca --server letsencrypt

# 签发证书（webroot 模式）
~/.acme.sh/acme.sh --issue -d release.yourcompany.com -w /var/www/acme-challenge

# 安装证书到 /etc/nginx/ssl，并自动绑定 Nginx 重载命令
sudo ~/.acme.sh/acme.sh --install-cert -d release.yourcompany.com \
  --key-file       /etc/nginx/ssl/release.yourcompany.com.key \
  --fullchain-file /etc/nginx/ssl/release.yourcompany.com.cer \
  --reloadcmd     "systemctl reload nginx"
```

---

## 五、配置 Nginx 完整动静托管与反代

编辑 `/etc/nginx/conf.d/app-release-hub.conf`，将内容替换为完整的生产 HTTPS 配置：

```bash
sudo vim /etc/nginx/conf.d/app-release-hub.conf
```

```nginx
# 1. HTTP 自动重定向到 HTTPS（严格排除 ACME 挑战目录，避免续签重定向失败）
server {
    listen 80;
    listen [::]:80;
    server_name release.yourcompany.com;

    # 优先匹配并放行 ACME 验证请求（^~ 修饰符确保不再向下执行任何匹配或重定向）
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme-challenge;
        default_type "text/plain";
        allow all;
        try_files $uri =404;
    }

    # 其余所有 HTTP 流量 301 强制跳转至 HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

# 2. HTTPS 业务站点
server {
    listen 443 ssl http2;
    server_name release.yourcompany.com;

    # SSL 证书
    ssl_certificate     /etc/nginx/ssl/release.yourcompany.com.cer;
    ssl_certificate_key /etc/nginx/ssl/release.yourcompany.com.key;

    # SSL 安全优化
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # 前端静态页面根目录
    root /opt/app-release-hub/web-admin/dist;
    index index.html;

    # 1. 客户端更新检测接口：强行禁用缓存，避免版本延误
    location ~* ^/api/apps/[^/]+/version {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    # 2. 安装包与差分补丁：支持断点续传与大文件流式直通
    location ~* ^/api/apps/[^/]+/(releases|patches)/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_read_timeout 600s;
        client_max_body_size 2048M;
    }

    # 3. 后端 API 与管理后台
    location ~ ^/(api|admin|health)/? {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 4. Vue SPA 路由支持（防止刷新 404）
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

测试并重载 Nginx：
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 六、运维常用命令

### 1. 检查各服务状态
```bash
# 查看后端进程状态与实时日志
pm2 status
pm2 logs release-hub-backend

# 查看 Nginx 状态与错误日志
sudo systemctl status nginx
sudo tail -f /var/log/nginx/error.log
```

### 2. 证书自动续期检查
`acme.sh` 安装时已自动添加 Crontab 定时任务，每 60 天自动检查续期，并在成功后静默重启 Nginx。  
查看当前证书列表或测试强制续签：
```bash
# 查看已注册证书
~/.acme.sh/acme.sh --list

# 测试强制续签
~/.acme.sh/acme.sh --renew -d release.yourcompany.com --force
```

### 3. 代码更新部署
```bash
cd /opt/app-release-hub && git pull

# 更新后端
cd backend && npm install --omit=dev && pm2 restart release-hub-backend

# 更新前端（如有改动）
cd ../web-admin && npm install && npm run build
```
