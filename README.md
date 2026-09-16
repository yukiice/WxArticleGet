# 公众号文章聚合阅读器

抓取指定微信公众号每天发布的文章，清洗排版后在网页端阅读，生成每日 AI 总结，并按设定时间把「摘要 + 链接」发送到邮箱。

技术栈：Node 24 · TypeScript monorepo（pnpm + Turborepo）· Next.js 15 · NestJS · Prisma · MySQL 8 · DeepSeek · nodemailer（163 SMTP）

任务队列用 MySQL 的 `job_queue` 表自建（`packages/queue`），不额外引入 Redis，方便在只允许 MySQL 的环境里部署。

## 目录结构

```
apps/web         Next.js：阅读端 + 管理后台（响应式 + PWA）
apps/api         NestJS：REST API、鉴权、静态图片服务
apps/worker      NestJS 无 HTTP 进程：定时调度与任务消费
packages/db      Prisma schema / client / migrations
packages/shared  zod schema、常量、配置解析（前后端共用）
packages/wechat  公众号抓取与正文解析（含 POC 脚本）
packages/email   邮件模板与发送
docs/            需求评审、技术方案、数据模型
```

## 本地开发

两种方式任选，配置都来自仓库根目录的 `.env`：

```bash
cp .env.example .env
# 至少先改 AUTH_SECRET、ADMIN_PASSWORD；DEEPSEEK_API_KEY / SMTP_* 可以后补
```

### 方式一：全部跑在 Docker 里（推荐，无需本地装 Node / MySQL）

```bash
docker compose up -d --build     # 首次构建镜像需要几分钟
docker compose logs -f api       # 观察启动日志
```

`migrate` 服务会自动建表，随后 api(3001) / worker / web(3000) 依次启动。
访问 http://localhost:3000 ，用 `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录。

- 改完代码后：`docker compose up -d --build`
- 只看某个服务日志：`docker compose logs -f worker`
- MySQL 通过 `docker-compose.override.yml` 暴露在 `127.0.0.1:3306`，方便用本机客户端直连；生产部署不想暴露端口时用 `docker compose -f docker-compose.yml up -d` 忽略该文件。
- MySQL 容器固定跑在 UTC（`--default-time-zone=+00:00`）：Prisma 读写 `DATETIME` 一律按 UTC 处理，数据库时区不是 UTC 会导致时间差 8 小时。

### 方式二：基础设施在 Docker，应用跑在宿主机（改代码热更新更快）

```bash
docker compose up -d mysql       # 只起数据库
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev                         # 先编译内部依赖，再启动 web(3000) / api(3001) / worker
```

访问 http://localhost:3000 ，使用 `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录。

首次启动 API 时会用 `ADMIN_USERNAME` + `ADMIN_PASSWORD` 自动创建账号，之后修改环境变量不会覆盖已有密码。

`DATA_DIR` 的相对路径统一以仓库根目录为基准；默认图片写入根目录 `data/`，API 与 worker 读取同一目录。

## 生产部署

```bash
cp .env.example .env       # 至少修改数据库密码、AUTH_SECRET、ADMIN_PASSWORD、SMTP_*、APP_BASE_URL
docker compose -f docker-compose.yml build
docker compose -f docker-compose.yml up -d   # 首次会先跑 migrate 服务建表，再启动 api / worker / web
```

服务器上不建议沿用仓库里的 `docker-compose.override.yml`（那是本地开发用的端口映射），显式指定 `-f docker-compose.yml` 即可忽略它。

反向代理建议：`/` 指向 `web:3000`；`/api` 与 `/files` 交给 web 容器即可（Next 已配置 rewrite 转发到 api），也可以直接指向 `api:3001`。

务必启用 HTTPS：PWA「添加到主屏」与 Cookie 安全都依赖它。

### 从旧版本升级

本次包含数据库迁移：会话版本、日报抓取依赖、发送日志统计窗口及队列唯一键。先停止旧 API / worker，再运行 `pnpm db:migrate` 并启动新版本；Docker 部署先停止旧应用服务，再构建新镜像并执行 `docker compose up -d`，由 `migrate` 服务执行迁移。不要让旧 worker 在迁移过程中继续写队列。

升级后需重新登录；之后修改密码或删除账号会立即使该账号的旧会话失效。迁移会从已有总结回填发送日志的统计窗口，并保留已有队列任务。

宿主机使用相对 `DATA_DIR` 时，请将旧 `apps/worker/data/` 下的 `images/`、`covers/` 合并到仓库根目录 `data/`，或改用指向原目录的绝对路径；Docker 的 `/data` 卷不受影响。静态文件服务只开放图片路径，旧 HTML / SVG 文件不会再对外提供。

## 数据源说明

微信没有开放「按名称查询公众号 / 拉取任意公众号历史文章」的接口，因此系统提供四条路径：

1. 内置 RSS 目录（推荐）：worker 每日 03:00 自动同步两份免费公开清单（decemberpei 与 wechat2rss，合计约 700 个公众号）到 `feed_catalog` 表；在「管理 → 公众号」输入名称即可模糊匹配，命中后一键添加（`__biz` 由订阅源自动解析）。可在页面上点「立即同步」手动刷新目录。
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

修改「发送时间」后需要重启 worker 才会重新注册计划：`docker compose restart worker`。

## 运维提示

- 图片下载会校验每次重定向的公网 IP，并固定实际连接 IP；仅保存签名及 MIME 符合要求的 PNG / JPEG / GIF / WebP，单张最多 10 MB。失败时保留原始地址，日志中可见；重新执行 `process-article` 任务可重试。
- **图片全部本地化失败（`图片地址不能指向内网或保留地址`）**：多半是代理软件开了 fake-ip（TUN）模式，把 `mmbiz.qpic.cn` 等域名解析成了保留网段（典型是 `198.18.0.0/15`），被 SSRF 防护拦下。排查：`docker exec <worker容器> getent hosts mmbiz.qpic.cn`，若返回 `198.18.x.x` 即命中。修复：在代理里把 `qpic.cn` / `weixin.qq.com` 加入 fake-ip 白名单（fake-ip-filter），或改用 redir-host 模式后重启代理与容器。正文抓取不受影响，因为它不走这层公网 IP 校验。
- 数据库备份：`docker compose exec mysql mysqldump -uwx -pwx --single-transaction --default-character-set=utf8mb4 wx_article | gzip > backup.sql.gz`
- 图片文件位于 `appdata` 卷，需一并备份。

## 质量检查

```bash
pnpm typecheck   # 全量类型检查
pnpm test        # 安全、队列、抓取/日报链路和正文解析测试（外部服务使用替身）
pnpm build       # 全量构建
```
