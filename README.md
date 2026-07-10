# Hotspot Radar MVP

Hotspot Radar 是一个轻量级热点监控工具，用来自动发现 AI、编程工具、大模型更新等方向的新动态，并通过网页实时展示。

当前版本是 MVP，优先保证可运行、可部署、可扩展。

## 快速启动

```powershell
cd C:\Users\Administrator\Documents\Codex\2026-07-10\new-chat-4\outputs\hotspot-radar-mvp
node server.js
```

打开浏览器访问：

```text
http://localhost:4873
```

热点信息页：

```text
http://localhost:4873/hotspots.html
```

## 已实现功能

- 添加、删除要监控的关键词。
- 为关键词设置监控范围，例如“AI 编程”“大模型”“开源项目”。
- 支持手动扫描和后台定时扫描。
- 支持浏览器通知权限流程。
- 使用 Server-Sent Events 实时推送新发现的热点。
- 支持多种信息来源：Google News、官方 RSS、Hacker News、GitHub、arXiv、DEV Community。
- 可以在页面中选择启用哪些信息来源。
- 热点信息页支持按时间区间筛选。
- 热点标题会尽量以中文展示。
- 每条热点显示相关性百分比、抓取时间和原文链接。
- 点击热点标题可以展开完整信息。
- 点击“AI 总结”可以生成中文总结。
- 自动清理过期热点，默认保留 24 小时，也可以在页面中修改保留时间。
- 内置基础真假识别逻辑，用来过滤疑似假冒官方发布、标题党或低可信内容。
- 内置本地演示信号，方便在网络受限时验证页面、通知、总结和数据流。

如果本地网络无法访问部分外部来源，可以先用“生成本地演示信号”验证完整流程。

## 公开只读模式

如果要把网站公开给别人访问，但不希望访客修改配置，可以使用公开只读模式。

启动命令示例：

```bash
PUBLIC_READONLY=1 ADMIN_TOKEN=replace-with-a-long-random-token PORT=4873 STATE_FILE=/var/lib/hotspot-radar/state.json npm start
```

公开访客可以：

- 打开 `/hotspots.html` 查看热点。
- 展开热点详情。
- 访问原始网站链接。
- 为当前页面中的热点生成中文 AI 总结。

公开访客不能：

- 添加或删除关键词。
- 修改信息来源。
- 修改热点保留时间。
- 手动触发扫描。
- 生成本地演示信号。

管理员入口：

```text
/index.html#adminToken=replace-with-a-long-random-token
```

管理员 Token 会保存在当前浏览器的本地存储中，并在页面加载后从地址栏移除。

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 服务监听端口 | `4873` |
| `STATE_FILE` | 数据文件路径 | `data/state.json` |
| `PUBLIC_READONLY` | 是否开启公开只读模式，设置为 `1` 开启 | 关闭 |
| `ADMIN_TOKEN` | 管理员 Token，公开只读模式下用于管理操作 | 空 |
| `QUIET` | 设置为 `1` 时减少启动日志 | 关闭 |

## 数据存储

当前 MVP 使用本地 JSON 文件保存数据，默认路径是：

```text
data/state.json
```

这个文件属于运行数据，不会提交到 GitHub。生产部署时建议通过 `STATE_FILE` 指定到持久化目录，例如：

```text
/var/lib/hotspot-radar/state.json
```

## 测试

```powershell
node --test
```

当前测试覆盖：

- 热点相关性和可信度分析。
- 多来源查询构造。
- 数据保留和时间筛选。
- 中文标题本地化。
- 中文 AI 总结。
- 服务端 API 冒烟测试。
- 公开只读模式权限保护。


