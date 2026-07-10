# Hotspot Radar MVP 上线部署方案

## 结论

推荐先采用 **单台 Linux VPS + Node.js 20+ + PM2 + Nginx + HTTPS + JSON 文件持久化备份 + 公开只读模式**。

当前项目是一个轻量 Node.js 服务：

- `server.js` 同时提供静态页面、API、SSE 实时事件和后台定时扫描。
- `package.json` 要求 Node.js `>=20`。
- 启动命令是 `npm start`，实际执行 `node server.js`。
- 数据默认写入 `data/state.json`，也支持通过 `STATE_FILE` 环境变量指定持久化文件。
- 服务端口默认 `4873`，也支持通过 `PORT` 环境变量指定。

这个形态不适合只部署到 GitHub Pages、Vercel 静态站点或普通 serverless，因为它需要常驻进程、定时任务、SSE 长连接和可写本地数据。

## 推荐架构

```text
用户浏览器
  |
  | HTTPS
  v
Nginx :443
  |
  | 反向代理
  v
Node.js app 127.0.0.1:4873
  |
  v
/var/lib/hotspot-radar/state.json
```

Nginx 负责域名、HTTPS、反向代理和可选访问密码；Node 服务只监听本机端口；热点数据保存在服务器持久目录。

## 上线前确认项

1. 域名：准备一个子域名，例如 `radar.example.com`。
2. 服务器：建议 Ubuntu 22.04/24.04，1 核 1G 起步即可，后续根据抓取频率扩容。
3. 地域：
   - 面向国内用户且服务器放中国大陆，需要先处理 ICP 备案。
   - 想快速上线，可以先选香港、新加坡、日本或美国节点。
4. 访问控制：
   - 如果希望别人无需密码访问，启动时使用 `PUBLIC_READONLY=1`。
   - 管理操作使用 `ADMIN_TOKEN` 保护。
   - 访客可以查看热点、展开详情、打开原文链接和生成当前页面内的 AI 总结。
5. 数据保留：
   - 上线前把 `retentionHours` 调到 24、72 或 168 小时。
   - 当前本地状态曾被设置为 1 小时，线上不建议这么短。

## 部署步骤

### 1. 准备服务器

开放端口：

- `22`：SSH
- `80`：HTTP，用于签发证书和跳转
- `443`：HTTPS

安装基础组件：

```bash
sudo apt update
sudo apt install -y nginx git curl
```

安装 Node.js 20+，确认版本：

```bash
node -v
npm -v
```

### 2. 上传项目

建议目录：

```bash
sudo mkdir -p /opt/hotspot-radar
sudo mkdir -p /var/lib/hotspot-radar
sudo chown -R $USER:$USER /opt/hotspot-radar /var/lib/hotspot-radar
```

把本地 `outputs/hotspot-radar-mvp` 上传到：

```text
/opt/hotspot-radar
```

进入项目目录后执行：

```bash
cd /opt/hotspot-radar
npm test
```

### 3. 设置生产环境变量

推荐生产数据文件放在 `/var/lib`，避免发版覆盖：

```bash
export NODE_ENV=production
export PUBLIC_READONLY=1
export ADMIN_TOKEN=replace-with-a-long-random-token
export PORT=4873
export STATE_FILE=/var/lib/hotspot-radar/state.json
```

首次验证：

```bash
cd /opt/hotspot-radar
NODE_ENV=production PUBLIC_READONLY=1 ADMIN_TOKEN=replace-with-a-long-random-token PORT=4873 STATE_FILE=/var/lib/hotspot-radar/state.json npm start
```

本机健康检查：

```bash
curl http://127.0.0.1:4873/api/health
```

确认返回 `{"ok":true,...}` 后停止前台进程，改用 PM2 托管。

### 4. 使用 PM2 保持服务常驻

```bash
sudo npm install -g pm2
cd /opt/hotspot-radar
NODE_ENV=production PUBLIC_READONLY=1 ADMIN_TOKEN=replace-with-a-long-random-token PORT=4873 STATE_FILE=/var/lib/hotspot-radar/state.json pm2 start server.js --name hotspot-radar --time
pm2 save
pm2 startup
```

`pm2 startup` 会输出一条需要 `sudo` 执行的命令，按它提示执行一次即可，让服务器重启后自动拉起服务。

常用命令：

```bash
pm2 status
pm2 logs hotspot-radar
pm2 restart hotspot-radar --update-env
```

### 5. 配置 Nginx 反向代理

创建配置：

```bash
sudo nano /etc/nginx/sites-available/hotspot-radar
```

示例配置：

```nginx
server {
    listen 80;
    server_name radar.example.com;

    location / {
        proxy_pass http://127.0.0.1:4873;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }
}
```

注意：`proxy_buffering off` 和较长的 `proxy_read_timeout` 是为了保证 `/events` 的 SSE 实时通知连接稳定。

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/hotspot-radar /etc/nginx/sites-enabled/hotspot-radar
sudo nginx -t
sudo systemctl reload nginx
```

### 6. 管理员入口

公开访问：

```text
https://radar.example.com/hotspots.html
```

管理员入口：

```text
https://radar.example.com/index.html#adminToken=replace-with-a-long-random-token
```

Token 会保存在管理员浏览器本地，并在页面加载后从地址栏移除。

### 7. 配置 HTTPS

```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/local/bin/certbot
sudo certbot --nginx -d radar.example.com
```

按提示完成后，访问：

```text
https://radar.example.com
```

### 8. 数据备份

数据文件：

```text
/var/lib/hotspot-radar/state.json
```

建议每天备份一次：

```bash
mkdir -p /var/backups/hotspot-radar
cp /var/lib/hotspot-radar/state.json /var/backups/hotspot-radar/state-$(date +%F-%H%M).json
```

可以后续加 cron 定时任务：

```bash
0 3 * * * cp /var/lib/hotspot-radar/state.json /var/backups/hotspot-radar/state-$(date +\%F-\%H\%M).json
```

## 验收清单

上线后逐项检查：

1. `https://radar.example.com/api/health` 返回 `ok: true`。
2. 首页能打开。
3. 热点页 `/hotspots.html` 能打开。
4. 添加关键词成功。
5. 手动扫描成功。
6. 热点信息能展示标题、相关性、抓取时间、来源链接。
7. 点击展开后能看到完整信息。
8. 点击 AI 总结后返回中文总结。
9. 修改保留时间后刷新仍生效。
10. 浏览器通知权限流程正常。
11. 访客访问管理页时按钮不可操作。
12. 访客直接调用 `POST /api/scan` 返回公开只读错误。
13. 管理员通过 `#adminToken=...` 可以添加关键词和触发扫描。
14. PM2 重启后数据不丢。
15. 服务器重启后服务自动恢复。

## 发版流程

每次更新前先备份数据：

```bash
cp /var/lib/hotspot-radar/state.json /var/backups/hotspot-radar/state-before-release-$(date +%F-%H%M).json
```

上传新代码到 `/opt/hotspot-radar`，然后：

```bash
cd /opt/hotspot-radar
npm test
pm2 restart hotspot-radar --update-env
curl http://127.0.0.1:4873/api/health
```

## 备选方案：PaaS 平台

如果不想维护服务器，也可以部署到 Render、Railway 或 Fly.io 这类支持 Node Web Service 和持久化卷的平台。

关键配置：

- Start command：`npm start`
- Node version：`>=20`
- `PORT`：使用平台自动注入的端口
- `STATE_FILE`：指向持久化卷，例如 `/data/state.json`
- 持久化卷挂载目录：`/data`

优点：

- 不需要自己维护 Nginx、PM2、HTTPS。
- 域名和证书通常更省心。

缺点：

- 必须确认持久化卷，否则 `state.json` 会在重部署后丢失。
- 免费或低价实例可能休眠，不适合第一时间监控。
- SSE、定时任务和出站抓取可能受到平台策略影响。

## 后续演进

MVP 上线后，如果用户变多，建议按这个顺序升级：

1. 增加登录系统或管理员权限。
2. 把 `state.json` 换成 SQLite。
3. 加扫描任务队列，避免多个关键词同时触发导致请求过多。
4. 加通知渠道：邮件、飞书、企业微信、Telegram。
5. 加外部 AI 总结服务和 API Key 管理。
6. 加 Dockerfile，让发版更标准。

## 参考资料

- Nginx 反向代理官方文档：https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy
- PM2 startup 官方文档：https://pm2.keymetrics.io/docs/usage/startup/
- Certbot Nginx 官方说明：https://certbot.eff.org/instructions
- Render Web Services 文档：https://render.com/docs/web-services
- Railway Volumes 文档：https://docs.railway.com/volumes
- Fly.io Volumes 文档：https://fly.io/docs/js/the-basics/volumes/
- 阿里云 ICP 备案说明：https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/icp-filing-application-overview
- 腾讯云 ICP 备案说明：https://cloud.tencent.com/document/product/243/19630
