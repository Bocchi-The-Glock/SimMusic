# 阿里云独立部署

这个版本把网页、API、数据库和图片一起放在 ECS。运行时不访问 Workers、D1、R2；保留原功能、权限和 100 KB 图片限制。SQLite 文件和图片放在 `/var/lib/simmusic`，升级程序不覆盖它。单进程运行，先用现有 2 核 2 GB 服务器测试；384 MB 是 JS 堆上限，不代表进程总内存。

## 1. 获取 Linux 发布包

代码推送 main 后，GitHub Actions 的 **Package SimMusic for Aliyun** 会生成 `simmusic-aliyun-linux` 附件，下载并解压得到 `simmusic-aliyun.tar.gz`。也可在 Linux、Node 22.13+ 环境运行 `npm ci` 和 `npm run build:aliyun`，打包 `dist/standalone`。Windows 本地包仅用于本地验证，服务器使用 Linux 构建包。

原 Cloudflare 发布工作流保留。新工作流只生成附件，不会连接或改动 ECS。服务器配置完成后才能继续接入自动更新。

## 2. CentOS 7 的前置检查

你当前是 CentOS 7.9、glibc 2.17、内核 3.10，有其他服务。不要重装系统，不要替换系统 glibc，不要直接安装要求新版 glibc 的官方 Node 二进制。

临时兼容路径是 Node.js 项目的 **unofficial-builds / linux-x64-glibc-217** 构建。它专为旧 glibc 环境编译，但属于实验性社区构建，不能保证在这台服务器上正常运行；下面的检查必须成功后才启动网站。长期建议把服务迁到受支持的新系统。

参考：https://github.com/nodejs/unofficial-builds 。在自己的电脑下载后上传服务器也可以。以下固定版本用于可重复验证，后续应跟随兼容的 Node 22 安全更新：

```bash
mkdir -p /opt/simmusic/runtime-download
cd /opt/simmusic/runtime-download
curl -fLO https://unofficial-builds.nodejs.org/download/release/v22.22.0/node-v22.22.0-linux-x64-glibc-217.tar.xz
curl -fLO https://unofficial-builds.nodejs.org/download/release/v22.22.0/SHASUMS256.txt
grep ' node-v22.22.0-linux-x64-glibc-217.tar.xz$' SHASUMS256.txt > selected.sha256
test -s selected.sha256 && sha256sum -c selected.sha256
```

校验成功再解压；若文件下载不到，不要跳过校验。安装到独立目录，不改系统 Node：

```bash
mkdir -p /opt/simmusic/node
tar -xJf node-v22.22.0-linux-x64-glibc-217.tar.xz -C /opt/simmusic/node --strip-components=1
```

## 3. 放入程序、测试运行环境

将发布包上传 `/opt/simmusic/simmusic-aliyun.tar.gz`。首次安装：

```bash
id simmusic || useradd --system --home-dir /var/lib/simmusic --shell /sbin/nologin simmusic
mkdir -p /opt/simmusic/releases/first /var/lib/simmusic
tar -xzf /opt/simmusic/simmusic-aliyun.tar.gz -C /opt/simmusic/releases/first
ln -s /opt/simmusic/releases/first /opt/simmusic/current
chown simmusic:simmusic /var/lib/simmusic
chmod 700 /var/lib/simmusic
bash /opt/simmusic/current/deploy/preflight.sh
```

若 `/opt/simmusic/current` 已存在，停止本步骤并检查，不覆盖已有安装。预检应输出 `Runtime preflight passed`，且 3100、8080 没被其他服务占用。若运行时有 GLIBC、指令集或内核错误，保留现有业务，不强行升级底层库；把错误提供给维护者再调整方案。

## 4. 空库启动或迁移数据（二选一）

**没有需要保留的数据：** 直接进入第 5 步。首次请求自动创建表，默认管理员和 Starry 规则不变。

**保留 Cloudflare 数据：** 先暂停原站用户写入（迁移窗口内需确保没有新注册、上传或编辑），但保留旧图片接口可读。在本地项目目录执行：

```bash
npm run db:backup
node scripts/import-cloudflare.mjs backups/实际导出文件.sql https://simmusic.simmc.workers.dev backups/aliyun-data
```

导出需要现有 Cloudflare 授权；本地访问原站需要可用网络。Node 22 通过代理下载图片时可以设置 `NODE_USE_ENV_PROXY=1`、`HTTPS_PROXY=http://127.0.0.1:26728`（代理只用于本次迁移，不是服务器运行要求；使用支持该变量的 Node 22.21+）。导入会对比数据库字段、检查外键和完整性、按数据库引用下载全部图片并检查类型与长度，保留用户、密码散列、收藏和作品。登录会话清空，换站后重新登录。

目的目录必须不存在；失败会留下 `IMPORT_INCOMPLETE`，程序拒绝启动该目录。成功有 `IMPORT_COMPLETE`。遇到失败使用新的目的目录重试，不覆盖数据库。迁移工具只处理本项目当前结构，不把任意 SQL 文件当作可信输入。

将成功目录内的 `simmusic.sqlite`、`images/`、`IMPORT_COMPLETE/` 上传到仍未启动的服务器 `/var/lib/simmusic/`，之后：

```bash
chown -R simmusic:simmusic /var/lib/simmusic
chmod 700 /var/lib/simmusic
```

确认迁移完成再开放新站写入，避免两边各自产生一份不同的数据。

## 5. 启动后台服务

```bash
cp /opt/simmusic/current/deploy/simmusic.service /etc/systemd/system/simmusic.service
systemctl daemon-reload
systemctl enable --now simmusic
systemctl status simmusic --no-pager
curl -f http://127.0.0.1:3100/api/state
```

接口应返回包含 Starry、genres 等字段的 JSON。报错查看 `journalctl -u simmusic -n 80 --no-pager`。不要给外网开放 3100：它仅监听回环，真实访客 IP 由 Nginx 覆盖传入，避免限流被伪造请求头绕过。

## 6. 接入现有 Nginx

你有宝塔面板，先用 `nginx -T` 确认实际加载目录。把 `deploy/nginx.conf` 作为**独立站点**加入该目录，不能替换全局 nginx.conf 或其他站点。宝塔也可创建反向代理到 `http://127.0.0.1:3100`，并按示例设置请求头。

```bash
nginx -t
# 只有检查成功，才执行：
nginx -s reload
```

示例用未占用的 8080 端口。阿里云安全组和系统防火墙放行 TCP 8080 后，测试 `http://121.40.158.251:8080`。先检查现有防火墙规则，勿重置规则或关闭防火墙。HTTP/IP 仅用于测试，正式账号登录应配置自己的域名和 HTTPS；配置 TLS 时保持示例中的 X-Forwarded-Proto，保证登录 Cookie 带 Secure。域名接入杭州服务器还需按阿里云的现行要求办理备案。

## 7. 验收、更新、备份与回退

验收：游客浏览及排班、注册登录、自己的乐曲/商店/Livehouse 增删改、四种图片上传、收藏、管理员权限；重启服务后确认数据和图片仍在。检查日志无异常后才停用旧站。原 Cloudflare 数据和桶不要立刻删除。

更新：下载新 Linux 包，解压到新的 `/opt/simmusic/releases/版本号`，停服务，将 `current` 链接切换到新目录后启动。`/var/lib/simmusic` 不动。先备份再升级；若发生数据库结构升级，旧程序回退需配合升级前的数据备份。

备份（短暂停止写入，默认位置与程序分离）：

```bash
bash /opt/simmusic/current/deploy/backup.sh
```

备份含数据库和图片，也含密码散列，勿提交 GitHub或放入网页目录。把备份定期下载到自己的电脑；磁盘只有约 5 GB 时不要无限保留同机备份。恢复前停止服务，将当前数据目录改名保留，再把备份解压到 `/var/lib/`，恢复所属用户后启动。

本次交付没有远程登录 ECS，因此真实 CentOS 环境、Nginx 和公网连接还需要按以上步骤验收；不能把本地构建通过等同于服务器已经上线。
