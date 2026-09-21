# 公众号文章聚合阅读器

抓取微信公众号文章，清洗排版后在网页阅读，生成每日 AI 总结，并把摘要与链接发送到邮箱。

**一个应用容器、一个端口、你现有的 MySQL 数据库。** 网页、API、定时任务在同一个 Node 进程里运行，没有独立 web/api/worker 服务，也不创建数据库容器。任务状态仍保存在 MySQL，失败重试和日报抓取依赖继续保留。

## Ubuntu Docker 部署

服务器需要 Git、Docker 和 Compose v2，以及可访问的 MySQL 8.0.13+ 数据库。应用不会替你创建数据库和数据库用户；先在现有 MySQL 中准备好空库或沿用原库，并授予该库的迁移权限。数据库全局时区可以保持 `+08:00`。本应用的时间字段按 UTC 存储，自动时间默认值使用 `UTC_TIMESTAMP(3)`，不依赖数据库时区；界面与定时计划默认使用北京时间。

首次部署：

```bash
git clone https://github.com/yukiice/WxArticleGet.git
cd WxArticleGet
cp .env.example .env
nano .env
bash deploy.sh
```

至少设置这几项（示例中的密码都需要替换）：

```dotenv
DATABASE_URL=mysql://用户名:数据库密码@host.docker.internal:3306/wx_article
AUTH_SECRET=至少32位随机字符串
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的登录密码
APP_BASE_URL=http://服务器IP:3000
PORT=3000
```

可用 `openssl rand -hex 32` 生成 `AUTH_SECRET`。数据库密码若含 `@`、`#`、`:` 等特殊字符，需要先做 URL 编码。数据库地址必须能从应用容器访问，不能填 `localhost`：

- 现有数据库容器已向宿主机映射端口：使用 `host.docker.internal:映射端口`，Compose 已配置 Linux 的宿主机网关映射。仅绑定宿主机 `127.0.0.1` 的端口无法经此地址访问，需要调整绑定或使用可达的内网地址。
- 数据库在别的服务器：使用其内网 IP 和端口。

部署后访问 `http://服务器IP:3000`，在云防火墙/安全组放行应用端口即可。只有 IP 时可正常登录使用；PWA 安装需要以后配置 HTTPS。AI 和邮件参数可在 `.env` 或管理后台填写。

以后每次更新（包括修改 `.env` 后重新部署）：

```bash
cd /www/WxArticleGet
bash deploy.sh
```

脚本会更新**当前分支的上游分支**，默认克隆后就是 `origin/main`，然后构建镜像、执行数据库迁移、更新应用容器并等待健康检查。脚本自身更新后会立即重载。构建和迁移成功前不会停止正在运行的应用；迁移或启动失败会报错，不会宣称更新成功。成功后的数据库迁移不会自动回滚，升级前请按现有方式备份数据库。

网络中断、错误数据库密码或本地代码冲突不能靠脚本保证成功。失败原因会显示在终端，处理后重复执行同一条命令即可。脚本不会强制覆盖本地代码，不会覆盖已有 `.env`，不会删除数据卷。Ubuntu 自带的 `flock` 会阻止同时执行两次部署。

## 国内构建

Dockerfile **不执行 apt-get update/install**。使用已包含 OpenSSL 的 `node:24-bookworm` 完整版基础镜像；首次下载比 slim 大，之后 Docker 复用缓存。

npm/pnpm 默认使用 `registry.npmmirror.com`，Prisma 引擎默认使用 npmmirror 的二进制镜像。依赖下载单独缓存，更新业务代码不会重新下载所有依赖。只导出应用及生产依赖到运行阶段。

这些配置可在 `.env` 覆盖：

```dotenv
NODE_IMAGE=node:24-bookworm
NPM_REGISTRY=https://registry.npmmirror.com
PRISMA_ENGINES_MIRROR=https://cdn.npmmirror.com/binaries/prisma
```

npm 镜像不负责加速 Docker Hub 或 GitHub。若卡在拉取 Node 镜像，请把 `NODE_IMAGE` 改为你可信的镜像仓库中对应的 Node 24 Debian bookworm 完整版镜像，或使用你服务器已配置的 Docker 镜像加速；若卡在 `git fetch`，需要解决服务器访问 GitHub 的网络。脚本不会替换成来路不明的公共代理。

## 旧版升级

PR 合并后，在现有仓库中先执行一次 `git pull --ff-only` 取得 `deploy.sh`，后续只需 `bash deploy.sh`。

1. 保留原 `.env`，确认 `DATABASE_URL` 指向现有数据库；旧版 `PORT=3001` 应改成 `3000`，并同步 `APP_BASE_URL`。
2. 执行 `bash deploy.sh`。脚本显式指定 Compose 文件，旧的 `COMPOSE_FILE=docker-compose.server.yml` 和遗留 override 文件不会再影响它。
3. 构建和迁移完成后，脚本停止同一个 Compose 项目的旧 `web/api/worker` 容器，启动新的 `app`；已有 MySQL 容器和 `appdata` 图片卷保留。沿用原目录及 Compose 项目名，才能找到这些旧容器和数据卷。

`MYSQL_*`、`API_INTERNAL_URL` 不再使用，可从旧 `.env` 删除。不会重置已有用户密码，`ADMIN_PASSWORD` 仅在首次创建管理员时生效。不要执行 `docker compose down -v`，它会删除数据卷。

升级时脚本会自动应用 UTC 时间默认值迁移，无需修改共享 MySQL 的时区。迁移只修改本项目表的默认值，不调整历史记录；若旧版已经在非 UTC 时区写入了自动时间，需要先核对受影响记录，不能把所有历史时间统一减 8 小时。

## 日常操作

```bash
docker compose -f docker-compose.yml logs -f app
docker compose -f docker-compose.yml restart app
docker compose -f docker-compose.yml ps
```

只有 3000 一个容器端口；以后配置反向代理时，所有路径统一转发到它。默认只运行一个应用实例，进程内的定时计划会随应用启动和关闭。

## 本地开发

```bash
corepack enable
pnpm install --frozen-lockfile
# 配置仓库根目录 .env，本地开发的 DATABASE_URL 可用本机可访问的数据库地址
pnpm db:generate
pnpm db:migrate
pnpm dev
```

访问 `http://localhost:3000`。前端支持热更新；服务端修改后重新编译并重启同一个应用进程。

```
apps/app/src       Next.js 页面、组件、样式
apps/app/server    API、鉴权、定时调度、抓取与日报服务
packages/db        Prisma 数据模型和迁移
packages/queue     MySQL 任务持久化、重试和 cron 调度
packages/shared    前后端共享类型和配置
packages/wechat    公众号抓取与正文解析
packages/email     邮件模板与发送
```

容器的图片目录为 `/data`，挂载原有 `appdata` 卷；本地 `DATA_DIR` 相对仓库根目录解析。Nest 和 Next 共享一个 HTTP 服务，API 和 `/files` 直接处理，其余请求由 Next 渲染，不需要反向代理或进程管理器。

## 数据源说明

微信没有开放「按名称查询公众号 / 拉取任意公众号历史文章」的接口，因此系统提供四条路径：

1. 内置 RSS 目录（推荐）：应用每日 03:00 自动同步两份免费公开清单（decemberpei 与 wechat2rss，合计约 700 个公众号）到 `feed_catalog` 表；在「管理 → 公众号」输入名称即可模糊匹配，命中后一键添加（`__biz` 由订阅源自动解析）。可在页面上点「立即同步」手动刷新目录。
2. 粘贴文章链接绑定（始终可用）：输入框粘贴该号任意一篇文章链接，即可解析 `__biz` 完成绑定；目录未收录时用这条。
3. RSS / RSSHub 订阅：自建一个公众号转 RSS 的服务，在账号数据源配置里填 `feedUrl`（或 `route` + `baseUrl`），系统按订阅列表自动发现新文章。
4. 手动导入文章链接：源站失效时在「管理 → 公众号 → 手动导入文章」粘贴链接补录。

免费方案下数据源偶发失效属于预期内，系统通过邮件告警、账号「最后成功抓取时间」与手动兜底入口降低影响。如需目录外的名称搜索，可自行配置 `WECHAT_SEARCH_ENDPOINT`（自建搜索服务）。

### 验证抓取是否可用（POC）

拿到任意一篇公众号文章链接后执行：

```bash
pnpm --filter @wx/wechat build
pnpm poc:article "粘贴一篇公众号文章链接" --download-images
```

会输出标题、公众号、发布时间、`biz/mid/idx`、图片数量，并把正文与图片写入 `data/poc/<id>/`，用于确认当前网络环境下正文与图片能否正常抓取。

## 定时任务

时区统一 `Asia/Shanghai`，可在 `.env` 调整：

| 任务 | 配置项 | 默认值 |
| --- | --- | --- |
| 抓取文章 | `FETCH_CRON` | 每天 08:30 |
| 生成 AI 总结（兜底） | `SUMMARY_CRON` | 每天 08:45 |
| 同步 RSS 目录 | `CATALOG_CRON` | 每天 03:00 |
| 发送日报邮件 | 管理后台「发送时间」 | 09:00（兜底 09:30） |

08:30 的 `fetch-all` 将统计窗口、账号抓取任务和日报排期一起落库。窗口从上份成功或无新文章日报的统计截止点接到本次抓取开始时刻，首次回退 24 小时。总结和邮件都等待本批抓取及重试成功后再执行；到发送时间仍未抓完时会顺延。`SUMMARY_CRON` 与 09:30 的发送兜底复用同一窗口和依赖，自动发送仍按日期去重。

抓取窗口：优先取最近 24 小时；上次完整抓取成功更早或日报窗口更早时向前补抓，最多回溯 7 天；首次接入用 `FIRST_RUN_LOOKBACK_DAYS`（默认 3 天）。单篇临时失败会使本次任务失败并重试，不会推进账号的成功时间；明确删除或撤回的文章按不可用跳过。

后台的「立即生成总结 / 立即发送邮件」优先沿用当日已保存的统计窗口；没有窗口时截止到该日 24:00，起点接之前日报的统计截止点（无记录则回退 24 小时）。「立即发送」支持在成功或无新文章后人工补发。如果抓取已最终失败，先对失败账号「立即抓取」，成功后再重新生成总结并发送。

修改「发送时间」后需要重启应用 才会重新注册计划：`docker compose -f docker-compose.yml restart app`。

## 运维提示

- 图片下载会校验每次重定向的公网 IP，并固定实际连接 IP；仅保存签名及 MIME 符合要求的 PNG / JPEG / GIF / WebP，单张最多 10 MB。失败时保留原始地址，日志中可见；重新执行 `process-article` 任务可重试。
- **图片全部本地化失败（`图片地址不能指向内网或保留地址`）**：多半是代理软件开了 fake-ip（TUN）模式，把 `mmbiz.qpic.cn` 等域名解析成了保留网段（典型是 `198.18.0.0/15`），被 SSRF 防护拦下。排查：`docker exec <app容器> getent hosts mmbiz.qpic.cn`，若返回 `198.18.x.x` 即命中。修复：在代理里把 `qpic.cn` / `weixin.qq.com` 加入 fake-ip 白名单（fake-ip-filter），或改用 redir-host 模式后重启代理与容器。正文抓取不受影响，因为它不走这层公网 IP 校验。
- 数据库由你自己管理，请用现有数据库的备份方式定期备份。脚本不会创建、停止或删除 MySQL 容器。
- 图片文件位于 `appdata` 卷，需一并备份。

## 质量检查

```bash
pnpm typecheck   # 全量类型检查
pnpm test        # 安全、队列、抓取/日报链路和正文解析测试（外部服务使用替身）
pnpm build       # 全量构建
```
