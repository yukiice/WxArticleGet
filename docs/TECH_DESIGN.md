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
| 数据库 | PostgreSQL 16 | 统一 `timestamptz` 存 UTC |
| 队列 | pg-boss | 复用 PG，自带 cron / 重试 / 退避 / 死信 |
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
│  apps/web    │ ───────> │  apps/api (NestJS) │ ───────> │ PostgreSQL │
│ Next.js+PWA  │          │  REST + 鉴权        │          │            │
└──────────────┘          └─────────┬──────────┘          └─────┬──────┘
                                    │ 入队 (pg-boss)             │ 任务表
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
- 节流：同一账号请求串行 + 随机间隔（2-5s），失败指数退避（pg-boss 重试），设置单账号每日抓取上限
- 首次接入默认回溯 3 天，接口支持传入 `since` 覆盖

### 4.3 内容处理

- `sanitize-html` 白名单清洗：剔除 script / iframe / 公众号推广卡片 / 广告位
- 图片本地化：按 UA/Referer 规则下载 `mmbiz.qpic.cn` 资源 -> `DATA_DIR/images/<hash>.<ext>`，正文 URL 重写为站内路径；同步生成列表页缩略图
- 归一化：抽出纯文本（`contentText`）用于摘要与检索，保留清洗后的 `contentHtml` 用于渲染

### 4.4 AI 每日总结

- 任务：按自然日（Asia/Shanghai）聚合当日新文章，生成一份 Markdown 总结
- 调用：openai SDK + `baseURL: https://api.deepseek.com`，模型 `deepseek-chat`
- prompt 模板版本化落库（`summaries.promptVer`），记录 token 消耗
- 超长文章先截断（保留首尾），失败由队列重试，最终失败则当日总结标记 failed 并在后台可见

### 4.5 邮件推送

- 默认内容：AI 摘要 + 文章清单（标题 + 站内链接 + 原文链接），不推全文
- 模板：手写 table 布局 HTML，不引入 React 运行时依赖，正文 < 102KB
- 发送：nodemailer，`smtp.163.com:465`，`from` 与登录账号一致
- 支持「测试发送」；每次发送写 `send_logs`，失败保留错误信息并告警
- 当日抓取为 0 篇时改为发送告警邮件，不推送空日报

### 4.6 调度与任务

- pg-boss 注册每日 cron：`fetch-all` -> 账号抓取 -> 单篇处理 -> 当日总结 -> 邮件发送
- 任务幂等：文章维度用 `urlHash` 作为 unique key；抓取任务可重复触发不产生脏数据
- 后台「立即抓取 / 立即生成总结 / 立即发送邮件」复用同一套任务
- 连续失败或当日抓取 0 篇 -> 触发告警邮件

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
| `DATABASE_URL` | PostgreSQL 连接串 |
| `APP_BASE_URL` | 公网域名，邮件内链必需 |
| `AUTH_SECRET` | 单用户会话签名 |
| `DATA_DIR` | 图片与附件存储根目录 |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `LLM_MODEL` | AI 总结配置 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | 163 SMTP，`SMTP_PASS` 为授权码 |
| `MAIL_TO` | 默认收件人 |
| 数据源凭据 | 自建 RSS 类服务的地址 / token（按 Provider 需要） |
| `WECHAT_SEARCH_ENDPOINT` | 可选，自建公众号搜索服务，用于按名称搜索 |
| `RSSHUB_BASE_URL` | 可选，RSSHub 实例地址，用于 rsshub 类型账号 |

## 6. 部署（概要）

- `docker-compose`：`web` + `api` + `worker` + `postgres`，反向代理与 HTTPS 由服务器侧统一处理
- 数据备份：`pg_dump` + 图片目录同步
- 时区：容器与任务统一 `Asia/Shanghai`，库内时间存 UTC

## 7. PostgreSQL 相关约定

- 时间字段统一 `@db.Timestamptz(3)`，库内存 UTC，展示层转换
- 正文字段直接用 `String`（映射 `text`，无长度限制）
- 检索先行方案：`ILIKE`；后续需要更强检索再加 `pg_trgm` + GIN 索引
- 长 URL 用 `urlHash`（sha256）建唯一索引，避免长索引与超长字符串键
- `summaries` 全局记录 `accountId` 为 NULL，唯一约束对 NULL 不生效，写入采用「先查后改」保证幂等
