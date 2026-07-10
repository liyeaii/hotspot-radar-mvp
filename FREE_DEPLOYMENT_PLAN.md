# Hotspot Radar MVP 免费公开部署方案

## 推荐结论

推荐方案：**Oracle Cloud Always Free 云主机 + Node.js + PM2 + Nginx + 公开只读模式**。

上线后不加访问密码，别人可以直接访问公网地址。公开访客只能查看热点；添加关键词、修改配置、手动扫描等管理操作需要管理员 Token。

这个项目当前需要：

- Node.js 常驻服务
- 后台定时扫描
- SSE 实时推送
- 本地 JSON 数据写入
- 静态页面和 API 同源访问

因此不建议把它部署到普通静态托管，也不建议优先用会休眠、文件不持久化的免费 Web Service。

## 免费平台对比

| 方案 | 是否推荐 | 原因 |
| --- | --- | --- |
| Oracle Cloud Always Free | 推荐 | 有免费 VM 和免费块存储，适合 Node 常驻和 `state.json` 持久化 |
| Google Cloud Always Free e2-micro | 可选 | 有免费 VM 和 30GB 标准持久磁盘，但只有 1GB 内存和较小出站流量额度 |
| Railway Free | 不推荐长期跑 | 免费额度较小，常驻 Node 服务大概率不够稳定覆盖整月 |
| Render Free | 不推荐 | 免费 Web Service 会休眠，且本地文件重启/休眠后丢失 |
| Koyeb Free | 不推荐 | 免费实例会 scale down，不能挂载持久化 Volume |
| Cloudflare Quick Tunnel | 只适合临时演示 | 不是真正部署，本机必须一直开着，URL 可能变化 |

## 方案 A：Oracle Cloud Always Free

### 适用场景

适合你现在这个 MVP：

- 希望 0 元长期运行
- 希望别人直接访问，不输入密码
- 希望数据保存在服务器上
- 可以接受自己维护一台 Linux 机器

### 建议规格

创建一台 Always Free 的 Arm 机器：

```text
Shape: VM.Standard.A1.Flex
OCPU: 1
Memory: 6GB
Image: Ubuntu 22.04 或 Ubuntu 24.04
Boot Volume: 默认 50GB
```

这对当前项目已经足够。Oracle 当前 Always Free A1 总额度可覆盖 2 OCPU / 12GB 内存范围内的小型实例。

### 开放端口

在 Oracle Cloud 安全列表或 Network Security Group 中开放：

```text
22/tcp    SSH
80/tcp    HTTP
443/tcp   HTTPS
```

如果暂时没有域名，可以先只开放 `80`，用：

```text
http://服务器公网IP
```

让别人访问。

注意：浏览器通知通常需要 HTTPS。只用公网 IP + HTTP 时，页面可访问，但通知权限可能不可用。

### 服务器部署步骤

进入服务器后：

```bash
sudo apt update
sudo apt install -y nginx git curl
```

安装 Node.js 20+，然后确认：

```bash
node -v
npm -v
```

准备目录：

```bash
sudo mkdir -p /opt/hotspot-radar
sudo mkdir -p /var/lib/hotspot-radar
sudo chown -R $USER:$USER /opt/hotspot-radar /var/lib/hotspot-radar
```

上传本地项目 `outputs/hotspot-radar-mvp` 到：

```text
/opt/hotspot-radar
```

在服务器上测试：

```bash
cd /opt/hotspot-radar
npm test
PUBLIC_READONLY=1 ADMIN_TOKEN=换成一串足够长的随机Token PORT=4873 STATE_FILE=/var/lib/hotspot-radar/state.json npm start
```

本机验证：

```bash
curl http://127.0.0.1:4873/api/health
```

### PM2 常驻

```bash
sudo npm install -g pm2
cd /opt/hotspot-radar
PUBLIC_READONLY=1 ADMIN_TOKEN=换成一串足够长的随机Token PORT=4873 STATE_FILE=/var/lib/hotspot-radar/state.json pm2 start server.js --name hotspot-radar --time
pm2 save
pm2 startup
```

执行 `pm2 startup` 输出的那条 `sudo` 命令，让服务器重启后自动恢复服务。

### Nginx 无密码公开访问

创建配置：

```bash
sudo nano /etc/nginx/sites-available/hotspot-radar
```

如果没有域名，先用公网 IP：

```nginx
server {
    listen 80 default_server;

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

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/hotspot-radar /etc/nginx/sites-enabled/hotspot-radar
sudo nginx -t
sudo systemctl reload nginx
```

访问：

```text
http://服务器公网IP
```

如果有域名，把 `server_name` 改成你的域名，然后用 Certbot 配 HTTPS。

### 管理员入口

公开访问地址：

```text
http://服务器公网IP/hotspots.html
```

管理员入口：

```text
http://服务器公网IP/index.html#adminToken=你的管理员Token
```

Token 会保存在管理员浏览器本地，并在页面加载后从地址栏移除。

### 不加密码的风险

当前版本已经支持公开只读模式。如果没有配置 `PUBLIC_READONLY=1` 和 `ADMIN_TOKEN`，完全公开后别人不仅能看热点，也能：

- 添加关键词
- 修改来源
- 修改保留时间
- 触发扫描
- 删除关键词

所以正式上线时必须使用上面的公开只读启动命令。

## 方案 B：Cloudflare Quick Tunnel 临时分享

这是最快的 0 元方案，不需要服务器、不需要域名、不需要访问密码。

适合：

- 临时发给朋友体验
- 临时验收
- 本机演示

步骤：

```powershell
cd C:\Users\Administrator\Documents\Codex\2026-07-10\new-chat-4\outputs\hotspot-radar-mvp
node server.js
```

另开一个终端：

```powershell
cloudflared tunnel --url http://localhost:4873
```

Cloudflare 会生成一个类似下面的地址：

```text
https://xxxx-xxxx.trycloudflare.com
```

把这个地址发给别人即可访问。

限制：

- 电脑必须一直开着
- `node server.js` 和 `cloudflared` 都不能关
- URL 可能变化
- 不适合正式长期运行
- SSE 实时通知可能不如直接部署稳定

## 最终建议

如果只是今天让别人看一下：用 **Cloudflare Quick Tunnel**。

如果要真的上线运行：用 **Oracle Cloud Always Free**。

如果要求“免费 + 长期运行 + 数据不丢 + 其他人直接访问 + 不要访问密码”，当前最可行的是：

```text
Oracle Cloud Always Free
  + Ubuntu
  + Node.js 20+
  + PM2
  + Nginx
  + PUBLIC_READONLY=1
  + ADMIN_TOKEN
  + 不启用 Basic Auth
```

## 上线验收清单

1. 访问 `http://公网IP/api/health` 返回 `ok: true`。
2. 访问首页正常。
3. 访问 `/hotspots.html` 正常。
4. 其他设备、其他网络可以打开页面。
5. 添加关键词成功。
6. 手动扫描成功。
7. 热点列表有数据。
8. 展开热点正常。
9. AI 总结返回中文。
10. 访客访问 `/index.html` 时管理按钮不可操作。
11. 访客直接调用 `POST /api/scan` 返回公开只读错误。
12. 管理员通过 `/index.html#adminToken=...` 可以添加关键词和触发扫描。
13. 重启服务器后服务自动恢复。
14. 重启服务器后 `state.json` 数据不丢。
