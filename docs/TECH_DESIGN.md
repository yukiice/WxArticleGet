> 历史设计/评审记录：文中的独立 web、api、worker 和内置数据库部署已被单应用方案取代；当前部署方式与目录以 [README](../README.md) 为准。

# 技术方案

配套文档：`docs/REVIEW.md`（需求评审）、`docs/DATA_MODEL.md`（数据模型与接口草案）

## 1. 技术栈

| 层次 | 选型 | 说明 |
| --- | --- | --- |
| 包管理 / 构建 | pnpm workspaces + Turborepo | monorepo 统一依赖与任务编排 |
| 语言 | TypeScript（strict） | 前后端统一 |
| 前端 | Next.js 15 App Router + Tailwind CSS + shadcn/ui | 阅读端与管理后台同应用 |
| 前端数据层 | TanStack Query + react-hook-form + zod | zod schema 来自 `packages/shared` |
| 后端 | NestJS | 模块化 + ValidationPipe + schedule |
| ORM | Prisma | 迁移与 Prisma Studio |
| 数据库 | MySQL 8 | `datetime(3)` 存 UTC，数据库固定 `--default-time-zone=+00:00` |
| 队列 | 自建 `job_queue` 表（`packages/queue`） | 不引入 Redis，MySQL 环境直接可跑；支持延迟、去重、重试退避、超时回收、cron |
| 抓取 | undici/native fetch + cheerio + sanitize-html | 解析 `#js_content`，清洗正文 |
| AI | openai SDK -> DeepSeek | 模型 `deepseek-chat` |
| 邮件 | nodemailer + 手写 table 布局模板 | SMTP: smtp.163.com:465（SSL，授权码） |
| 抓取代码组织 | `packages/wechat` | 正文解析、Provider、POC 脚本 |
| 测试 | Vitest（单测） | 关键纯函数与解析逻辑优先覆盖 |

## 2. Monorepo 结构

```
.
├─ apps/
│  ├─ web/            Next.js：阅读端 + 管理后台（响应式 + PWA）
│  ├─ api/            NestJS REST API
│  └─ worker/         NestJS 无 HTTP 进程：调度与任务消费
├─ packages/
│  ├─ db/             Prisma schema / client / migrations
│  ├─ shared/         zod schema + DTO 类型 + 常量
│  ├─ email/          邮件模板（table 布局 HTML）与发送
│  └─ wechat/         公众号抓取、正文解析、Provider、POC 脚本
├─ docker-compose.yml
├─ pnpm-workspace.yaml
└─ turbo.json
```

约定：

- `packages/shared` 是前后端唯一的契约来源，API 出入参一律用其中的 zod schema 校验与推导类型
- `apps/worker` 通过 `NestFactory.createApplicationContext()` 启动，复用同一套业务模块，避免与 API 争抢资源

## 3. 系统架构

```
┌──────────────┐  HTTPS   ┌────────────────────┐  Prisma  ┌────────────┐
│  apps/web    │ ───────> │  apps/api (NestJS) │  Prisma  │   MySQL    │
│ Next.js+PWA  │          │  REST + 鉴权        │ ───────> │  job_queue │
└──────────────┘          └─────────┬──────────┘          └─────┬──────┘
                                    │ 写入任务行                 │ 轮询认领
                          ┌─────────▼──────────┐                │
                          │  apps/worker       │ ◄──────────────┘
                          │  抓取 / 清洗 / 总结 / 发信 │
                          └───┬──────────┬─────┘
                              │          │
                       DeepSeek API   163 SMTP (nodemailer + HTML 模板)
```

## 4. 模块设计

### 4.1 账号管理

- 入口同时接受「公众号名称」与「文章链接」，前端一个输入框，后端自动判别
- 名称搜索返回候选列表（头像 / 简介 / 最近标题），用户点选后落库绑定 `__biz`
- 搜索无结果时引导用户粘贴任意一篇该号文章链接，解析 `__biz` 后反查账号信息完成绑定
- 账号支持暂停 / 启用、手动触发抓取，列表页展示「最后成功抓取时间」与状态

### 4.2 抓取层（Provider 抽象）

```ts
interface ArticleSourceProvider {
  searchAccount(keyword: string): Promise<AccountCandidate[]>;
  resolveByArticleUrl(url: string): Promise<AccountCandidate>;   // 兜底路径，必须稳定
  fetchArticles(biz: string, since: Date): Promise<RawArticle[]>;
  fetchArticleContent(url: string): Promise<RawContent>;         // 已知 URL 抓正文
}
```

- Provider 类型与参数存 `accounts.providerType` / `accounts.providerConfig`，新增数据源不改业务代码
- 抓正文：`fetch` -> `cheerio` -> `#js_content` 正文 / `#activity-name` 标题 / `#js_name` 账号名 / `ct`、`create_time` 发布时间；图片地址从 `data-src` 取真实 URL
- 节流：同一账号请求串行 + 随机间隔（2-5s），失败指数退避（队列重试），设置单账号每日抓取上限
- 首次接入默认回溯 3 天，接口支持传入 `since` 覆盖

### 4.3 内容处理

- `sanitize-html` 白名单清洗：剔除 script / iframe / 公众号推广卡片 / 广告位
- 图片本地化：按 UA/Referer 下载公网图片到 `DATA_DIR/images/<articleId>/<hash>.<ext>`，正文 URL 重写为站内路径；封面保存在 `covers/`。每次跳转重新校验 IP，并把已校验的 DNS 结果固定到实际连接，禁止访问内网/保留地址；按文件签名和 MIME 校验 PNG/JPEG/GIF/WebP，限制 10 MB，扩展名不取自外部 URL。`/files` 仅开放这些图片路径并设置 nosniff / CSP，阻止旧 HTML/SVG 文件同源执行。
- 归一化：抽出纯文本（`contentText`）用于摘要与检索，保留清洗后的 `contentHtml` 用于渲染

### 4.4 AI 每日总结

- 任务：按统计区间聚合文章（正常为过去 24 小时，首尾相接不重不漏），生成一份 Markdown 总结
- 区间来源：`fetch-all` 按「上份已产出日报的 windowTo → 本次抓取开始时刻」计算，落库在 `summaries.windowFrom/windowTo`；发送成功或无文章时也记录 `send_logs.windowFrom/windowTo`，续接不依赖发信时刻。
- API、总结和发送共用 `@wx/db` 的 `resolveDigestWindow()`，优先复用已保存窗口。没有窗口时，自动链路用抓取开始时刻，手动/兜底用该日 24:00；起点接该日之前最近一次成功/无文章日报的统计截止点，无记录则回退 24 小时。
- 调用：openai SDK + `baseURL: https://api.deepseek.com`，模型 `deepseek-chat`
- prompt 模板版本化落库（`summaries.promptVer`），记录 token 消耗
- 区间内没有新文章时不调用模型，写一条 `status = empty` 的记录供后台与阅读端查看
- 超长文章先截断（保留首尾），失败由队列重试，最终失败则当日总结标记 failed 并在后台可见

### 4.5 邮件推送

- 默认内容：AI 摘要 + 文章清单（标题 + 站内链接 + 原文链接），不推全文
- 模板：手写 table 布局 HTML，不引入 React 运行时依赖，正文 < 102KB
- 发送：nodemailer，`smtp.163.com:465`，`from` 与登录账号一致
- 支持「测试发送」；每次发送写 `send_logs`，失败保留错误信息并告警
- 区间内 0 篇属于正常情况：不发邮件也不告警，只写一条 `status = skipped` 的发送记录
- 邮件正文显示统计区间（如「09-13 08:30 — 09-14 08:30」）；AI 总结尚未生成完时任务顺延重试（最多 5 次 × 60s），避免发出没有总结的日报

### 4.6 调度与任务

- 队列就是 MySQL 的 `job_queue` 表（`packages/queue`）：API 侧只写库入队，worker 侧每 3s 轮询认领并串行执行
- 语义对齐原 pg-boss 方案：延迟执行、`singletonKey` 唯一约束保证并发去重（完成/最终失败释放键）、失败按 2^n 退避重试（默认 3 次）、`running` 超时回收（默认 30 分钟）、历史任务自动清理（默认 7 天）
- worker 进程内注册 cron：`sync-catalog` 03:00 / `fetch-all` 08:30 / `summarize-day` 08:45（兜底）/ `send-digest` 邮件发送时间（默认 09:00）+ 30 分钟兜底；重启后按最新配置重新注册
- 任务链路：`fetch-all` 在同一事务中保存窗口、抓取任务 ID 和排期；`fetch-account` 内完成单篇处理，再由 `summarize-day` / `send-digest` 读取 `summaries.fetchJobIds` 等待本批抓取成功。等待不消耗失败重试次数，最终抓取失败时禁止产出不完整日报；手动重试失败账号保留原任务 ID，成功后可重新生成/发送。
- 抓取窗口：`fetchWindowStart()` 取「上次成功抓取时间 → 现在」，正常为 24 小时；上次成功更早则从该时间点补抓，上限 7 天；首次接入用 `FIRST_RUN_LOOKBACK_DAYS`
- 发送去重：自动 `send-digest` 发现当天已有 `success` / `skipped` 记录时跳过；后台「立即发送」显式设置人工补发标记，可在这两种状态之后重发，排队中的重复点击仍由 singletonKey 合并。
- 任务幂等：文章维度用 `urlHash` 作为 unique key；抓取任务可重复触发不产生脏数据
- 后台「立即抓取 / 立即生成总结 / 立即发送邮件」复用同一套任务
- 抓取失败、LLM 失败等真异常才会触发告警邮件

### 4.7 阅读端与管理后台

- 阅读端：文章流（按日 / 按账号）、详情页、搜索、已读标记、夜间模式、字号调节
- 管理后台：账号管理、任务与日志、AI 设置、邮件设置、系统设置
- 同一应用，通过路由与布局区分：阅读端沉浸式，管理后台 PC 左侧导航 / 移动端底部 Tab

### 4.8 移动端策略

- 响应式优先，其次 PWA（manifest + service worker），手机可添加到主屏
- PWA 安装需从系统浏览器进行，微信内置浏览器不支持
- 管理后台表格在移动端降级为卡片列表
- 图片懒加载 + 固定宽高比，列表页加载缩略图，详情页加载原图

## 5. 环境变量

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | MySQL 连接串，如 `mysql://wx:wx@localhost:3306/wx_article` |
| `MYSQL_*` | 容器初始化 MySQL 用的库名 / 账号 / 密码（compose 读取） |
| `QUEUE_POLL_MS` / `QUEUE_EXPIRE_MINUTES` / `QUEUE_RETRY_DELAY_MS` / `QUEUE_KEEP_DAYS` | 队列轮询间隔 / 超时回收 / 重试基础间隔 / 历史保留天数（均可选） |
| `APP_BASE_URL` | 公网域名，邮件内链必需 |
| `AUTH_SECRET` | 单用户会话签名 |
| `DATA_DIR` | 图片存储根目录；相对路径固定以仓库根目录为基准，API 与 worker 共用 |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `LLM_MODEL` | AI 总结配置 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | 163 SMTP，`SMTP_PASS` 为授权码 |
| `MAIL_TO` | 默认收件人 |
| 数据源凭据 | 自建 RSS 类服务的地址 / token（按 Provider 需要） |
| `WECHAT_SEARCH_ENDPOINT` | 可选，自建公众号搜索服务，用于按名称搜索 |
| `RSSHUB_BASE_URL` | 可选，RSSHub 实例地址，用于 rsshub 类型账号 |

## 6. 部署（概要）

- `docker-compose`：`web` + `api` + `worker` + `mysql`，反向代理与 HTTPS 由服务器侧统一处理
- 数据备份：`mysqldump` + 图片目录同步
- 外部 MySQL 时注意：库必须跑在 UTC（`--default-time-zone=+00:00`），并使用 `utf8mb4` 字符集
- 时区：容器与任务统一 `Asia/Shanghai`，库内时间存 UTC

## 7. MySQL 相关约定

- 时间字段统一 `@db.DateTime(3)`，Prisma 按 UTC 读写，数据库也必须是 UTC（`--default-time-zone=+00:00`），展示层再转 `Asia/Shanghai`
- 正文字段用 `@db.LongText`：MySQL 的 `TEXT` 上限 64KB，微信长文实测可超 130KB
- 参与唯一索引的 URL 一律额外存 sha256（`urlHash` / `originalUrlHash`），原始 URL 用 `@db.Text`：InnoDB 单列索引上限 3072 字节（utf8mb4 = 768 字符）
- 主键 / 外键统一 `@db.VarChar(32)`（cuid 25 字符），保证外键两端类型一致、索引更小
- 检索：表排序规则 `utf8mb4_unicode_ci`，`LIKE '%kw%'` 天然大小写不敏感，不需要 PG 的 `mode: 'insensitive'`；数据量大再上 ngram 全文索引
- `summaries` 全局记录 `accountId` 为 NULL，唯一索引不约束 NULL，写入采用「先查后改」保证幂等
- 队列表 `job_queue` 单表扛全部任务，状态机 `pending -> running -> done/failed`，见 4.6
