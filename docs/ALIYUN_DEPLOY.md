# SimMusic 当前部署

2026-11-15 已完成实机部署与公网验证。

- 前端：https://simmc-music.github.io/
- 前端仓库：https://github.com/simmc-music/simmc-music.github.io
- 前端本地目录：`C:\Users\25621\Desktop\摸鱼\mc\SimMusic-Frontend`
- 后端 API：https://121.40.158.251:1145/api/state
- 后端源代码：https://github.com/Bocchi-The-Glock/SimMusic
- 后端本地目录：`C:\Users\25621\Desktop\摸鱼\mc\SimMusic`

## 架构

GitHub Pages 提供静态前端；阿里云 CentOS 7.9 上运行 Node 22.22.0 的 glibc 2.17 兼容构建、SQLite 和本地图片存储。运行时不依赖 Cloudflare。公网 1145 是 HTTPS 入口，应用内部仅监听 127.0.0.1:3100。80 端口保留给 ACME 证书验证，其余请求跳转前端。

Nginx 使用独立配置 `/opt/simmusic/nginx.conf`，没有改动宝塔原有站点。数据库及图片放在 `/var/lib/simmusic`，程序放在 `/opt/simmusic/releases`，`/opt/simmusic/current` 指向当前版本。当前程序版本 940e521。

只有 `https://simmc-music.github.io` 被允许跨域调用。前端用 sessionStorage 保存短期会话令牌，刷新可保留登录，关闭标签页后需重新登录；后端只存令牌散列。退出登录立即撤销令牌。不依赖浏览器第三方 Cookie。

## 修改前端

在 SimMusic-Frontend 中修改，提交并推送 main，即触发官方 Pages 工作流，自动构建和上线。无需额外部署密钥。不要在旧的后端仓库里修改前端后期待自动同步到新仓库。

## 修改后端

在 SimMusic 中修改，提交并推送 main，`Package SimMusic for Aliyun` 自动生成 Linux 发布包。服务器当前采用手动安装已验证发布包；没有设置跨仓库写入密钥或自动远程 SSH 凭据。原 Cloudflare 自动发布仍保留为备用版本。

更新前执行备份；将新包解压到 `/opt/simmusic/releases/新版本`，设置 root 所有权，停服务后切换 current 链接，再启动 simmusic。不要覆盖 `/var/lib/simmusic`，也不要把数据库、证书私钥、服务器密码提交 GitHub。数据库发生结构迁移时，回退程序需配合升级前的数据备份。

## 服务管理

```bash
systemctl status simmusic simmusic-proxy --no-pager
journalctl -u simmusic -n 50 --no-pager
systemctl restart simmusic
curl -f https://121.40.158.251:1145/api/state
```

`simmusic` 与 `simmusic-proxy` 已设为开机启动。代理采用 Wants 依赖，重启后端不会意外永久关闭代理。现有服务未重装，系统 glibc 未修改。

## HTTPS 与续期

使用 Let's Encrypt 的 IP 短期证书，已配置每 3 天续期、每天检查两次。私钥在 `/opt/simmusic/tls/key.pem`，仅留在服务器。证书任务：

```bash
systemctl list-timers simmusic-cert.timer
journalctl -u simmusic-cert.service -n 30 --no-pager
systemctl start simmusic-cert.service
```

保留公网 TCP 80 和 1145；关闭 80 会影响后续证书验证。续期失败应及时检查日志，不能仅因安装当天 HTTPS 正常就忽视后续续期。官方客户端脚本保存在 `/opt/simmusic/acme.sh`，账户配置位于 `/opt/simmusic/acme-state`。

## 备份与数据

```bash
bash /opt/simmusic/current/deploy/backup.sh
```

此命令短暂停止后端，将数据库和图片一起备份到 `/var/backups/simmusic`，然后自动启动后端。备份流程已实测。把备份定期下载到自己的电脑，不要无限保留同机副本。

已备份并导入本次 Cloudflare 数据库；当时没有新增用户、乐曲、商店、排班或图片，默认 Starry 正常保留。测试账号、作品和图片已清理。迁移工具仍可使用 `npm run db:backup` 和 `scripts/import-cloudflare.mjs`；两个站点同时开放写入不会自动同步数据。

## 已验证

- CentOS 7 实机 Node、SQLite、加密预检。
- 前端直连 HTTP 200，后端 1145 HTTPS 证书通过校验。
- CORS 预检、登录、退出失效、拒绝非授权来源。
- 排班、收藏、头像/乐曲/Livehouse/商店四类图片上传与读取。
- 备份后服务恢复、开机启动、证书定时任务运行。

旧独立整站安装流程归档在 ALIYUN_STANDALONE_SETUP.md；当前以本文件和已部署配置为准。
