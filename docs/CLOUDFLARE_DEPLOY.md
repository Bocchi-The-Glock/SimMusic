# 部署 SimMusic

代码保存在 GitHub 私有仓库 `SimMusic`；Cloudflare Workers 托管网页和接口，D1 保存业务数据，R2 保存图片。GitHub Actions 在 `main` 分支收到推送后自动构建、迁移数据库并发布。

## 1. 准备本地项目

安装 Node.js 22（至少 22.13）和 Git，在 VS Code 中打开此项目文件夹。使用“发布到 GitHub”创建名为 `SimMusic` 的 **Private** 仓库，默认分支设为 `main`。

在项目终端运行：

```powershell
npm ci
npx wrangler login
npx wrangler whoami
```

登录时在浏览器中授权自己的 Cloudflare 账号。本地授权完成后通常无需重复登录；GitHub Actions 使用后面配置的独立 API Token。

## 2. 创建数据库和图片桶

首次部署时运行一次。如果账号中已有为本项目准备的资源，直接使用它们，不要重复创建。

```powershell
npx wrangler d1 create simmusic-db
npx wrangler r2 bucket create simmusic-images
```

记录 Cloudflare 的 **Account ID**、返回的 **D1 Database ID** 和 R2 桶名。R2 使用 **Standard** 存储，保持桶私有；图片由网站接口读取，无需开放桶的公开网址。

在同一个 PowerShell 窗口填入实际值：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = "你的 Account ID"
$env:CLOUDFLARE_DATABASE_ID = "你的 D1 Database ID"
$env:CLOUDFLARE_R2_BUCKET = "simmusic-images"
npm run cf:configure
```

`cf:configure` 从根目录 `wrangler.jsonc` 和环境变量生成被 Git 忽略的 `wrangler.production.json` 实际配置。数据库绑定名必须是 `DB`，图片桶绑定名必须是 `BUCKET`，迁移目录为 `drizzle`。修改桶名时，本地环境变量和 GitHub 配置也要一起修改。

## 3. 首次手动部署

```powershell
npm run build
npm run db:migrate:remote
npm run deploy
```

构建成功后才执行后两步。迁移命令只应用尚未执行的 SQL；不要每次手动重复执行全部建表文件。发布使用构建生成的配置，完成后终端会显示网站地址。

打开新地址检查浏览、登录、创建乐曲及上传图片。仅完成构建不代表已经发布。

## 4. 配置 GitHub 自动部署

在 Cloudflare 创建专用于此仓库的 API Token，限定到该项目所在账号，授予发布 Worker、操作 D1 和绑定 R2 所需权限。可从“编辑 Cloudflare Workers”模板开始，补充 D1、Workers R2 Storage 权限；不要使用 Global API Key。Token 只填写到 GitHub 的 Secrets，不放进代码、普通变量或聊天。

进入 GitHub 仓库 **Settings → Secrets and variables → Actions**，添加：

| 位置 | 名称 | 内容 |
| --- | --- | --- |
| Secrets | `CLOUDFLARE_API_TOKEN` | 上述 Cloudflare API Token |
| Secrets | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| Variables | `CLOUDFLARE_DATABASE_ID` | 本项目的 D1 Database ID |
| Variables | `CLOUDFLARE_R2_BUCKET` | R2 桶名；不设置时默认 `simmusic-images` |

推送项目中的 `.github/workflows/` 工作流文件。流程使用 Node.js 22，依次安装依赖、检查、生成配置、构建、应用 D1 迁移和部署。配置完成后，可在仓库 **Actions** 中手动运行部署工作流，或推送一个新提交到 `main`。

查看对应运行记录，确认部署步骤成功并打开输出的网址。不需要再配置另一套 Cloudflare Git 自动构建，以免同一次推送重复部署。官方说明见 [Cloudflare GitHub Actions 部署文档](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)。

## 5. 日常更新

在本地修改后先检查，再提交和推送：

```powershell
npm run build
git add .
git commit -m "更新网站"
git push origin main
```

**保存文件不会发布；推送到 `main` 才会自动部署。** 也可以在 VS Code 中完成“暂存 → 提交 → 推送”。推送后在 GitHub Actions 查看结果，失败时先查看失败步骤的日志，修复后重新推送。

数据库结构变更需要生成新的 `drizzle/*.sql` 并一同提交；不要修改已经在线执行过的旧迁移。应用迁移的行为见 [D1 Wrangler 命令文档](https://developers.cloudflare.com/d1/wrangler-commands/)。

## 旧站数据与费用

现有托管网站继续保留。上传源码不会自动迁移旧站用户、音乐、排班、收藏或图片；新 D1 是独立数据库。迁移需另行导出原 D1 和 R2 的 `covers/` 对象，并保持图片对象键与数据库记录对应。

图片仍会压缩到 100 KB 以内。R2 Standard 有免费额度，但本项目没有按月费用硬停机制，不能保证绝对零收费。查看 [R2 官方计费规则](https://developers.cloudflare.com/r2/pricing/)，并在自己的账号中关注用量；不要为了部署切换到不需要的付费 Workers 套餐。
