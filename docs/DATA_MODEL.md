# 数据模型与接口草案

配套文档：`docs/REVIEW.md`、`docs/TECH_DESIGN.md`

## 1. 表清单

| 表 | 说明 |
| --- | --- |
| `accounts` | 公众号账号与数据源配置 |
| `articles` | 文章主体（清洗后 HTML + 纯文本） |
| `article_images` | 图片原始地址与本地路径映射 |
| `summaries` | 每日 AI 总结 |
| `email_recipients` | 邮件收件人 |
| `send_logs` | 邮件发送日志 |
| `job_logs` | 抓取 / 清洗 / 总结 / 发信任务日志 |
| `settings` | 键值型系统配置（LLM、SMTP、开关） |
| `users` | 内部登录账号（无公开注册；`role` = super 总管理员 / admin 管理员 / member 只读成员） |
| `feed_catalog` | 免费公开 RSS 目录索引（名称 → feed 地址），支撑「输入名称添加」 |
| `job_queue` | 任务队列（替代 pg-boss）：延迟、去重、重试、超时回收、定时调度的唯一入口 |

去重与索引策略：

- 文章业务去重：`(biz, mid, idx)` 复合唯一索引
- 文章链接去重：`urlHash`（sha256 hex）唯一索引，规避超长 URL 索引
- 常用查询：`(accountId, publishTime)`、`publishTime` 建普通索引
- `summaries` 的全局记录 `accountId` 为 NULL，MySQL 唯一索引同样不约束 NULL，写入统一「先查询再更新/创建」
- 图片去重：`(articleId, originalUrlHash)` 唯一索引（MySQL 无法给 `TEXT` 建唯一索引）

## 2. Prisma / MySQL 约定

Schema 的唯一事实来源是 `packages/db/prisma/schema.prisma`，这里只记录必须遵守的约定：

| 场景 | 写法 | 原因 |
| --- | --- | --- |
| 主键 / 外键 | `String @db.VarChar(32)` | cuid 固定 25 字符；显式限长才能保证外键两端类型一致、索引更小 |
| 时间 | `DateTime @db.DateTime(3)` | MySQL 没有时区类型；Prisma 读写 `DATETIME` 一律按 UTC，数据库必须跑在 UTC |
| 日期 | `DateTime @db.Date` | 承载 `dateKey`（Asia/Shanghai 自然日） |
| 长正文 | `@db.LongText` | `TEXT` 上限 64KB，微信长文实测超 130KB |
| URL / 简介 / 错误信息 | `@db.Text` | 不参与索引，不设长度上限 |
| 参与唯一索引的 URL | 额外存 sha256（`urlHash` / `originalUrlHash`） | InnoDB 单列索引上限 3072 字节（utf8mb4 = 768 字符），长 URL 会撑爆索引 |
| JSON | `Json` | `providerConfig` / `settings.value` / `job_queue.payload` |
| 大小写不敏感检索 | 直接 `contains` | 表排序规则 `utf8mb4_unicode_ci`，`LIKE` 天然大小写不敏感 |

已知取舍：

- 图片原始地址超过 512 字符的场景会被 `TEXT` 兜住，但去重依赖的是 `originalUrlHash`，不受长度影响
- 时间一致性依赖数据库时区：自建 MySQL 若不在 UTC，`DEFAULT CURRENT_TIMESTAMP` 会与 Prisma 写入差一个时区（compose 里已固定 `--default-time-zone=+00:00`）

## 3. API 草案

鉴权：除登录外均需会话；响应统一 `{ code, data, message }`。

角色与权限：`super`（总管理员，由 `ADMIN_USERNAME` 指定，随服务启动自动保证）、`admin`（管理员）、`member`（只读成员）。
成员可用：文章列表/详情/已读标记、每日总结查看、公众号列表；管理后台全部接口、账号增删改、抓取触发、总结生成、邮件、设置、日志、统计均为管理员专属（服务端 `AdminGuard` 强制 403，前端按角色隐藏入口）。

### 3.1 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 单用户登录，写入 HttpOnly Cookie |
| POST | `/api/auth/logout` | 退出登录 |
| POST | `/api/auth/password` | 修改当前登录账号密码（校验旧密码） |
| GET | `/api/auth/me` | 获取当前会话状态（含 `role`） |
| GET | `/api/auth/users` | 账号列表（**仅管理员**） |
| POST | `/api/auth/users` | 添加内部账号，可指定 `role`：`admin` / `member`（**仅管理员**） |
| PATCH | `/api/auth/users/:id` | 调整账号角色（**仅管理员**；总管理员与当前登录账号不可修改） |
| DELETE | `/api/auth/users/:id` | 删除账号（**仅管理员**；总管理员与当前登录账号不可删除） |

### 3.2 账号

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/accounts/lookup` | 输入名称或文章链接，返回候选列表：优先匹配内置 RSS 目录，其次文章链接解析 |
| GET | `/api/accounts/catalog` | 目录收录数量与最近同步时间 |
| POST | `/api/accounts/catalog/sync` | 派发一次目录同步任务（异步） |
| GET | `/api/accounts` | 账号列表（含状态与最后成功时间） |
| POST | `/api/accounts` | 确认绑定，落库 |
| PATCH | `/api/accounts/:id` | 启停 / 修改数据源配置 |
| DELETE | `/api/accounts/:id` | 解绑 |
| POST | `/api/accounts/:id/fetch` | 手动触发抓取（可传 `since` 覆盖默认 3 天） |

### 3.3 文章

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/articles` | 查询参数：`date` / `accountId` / `q` / `isRead` / `page` / `pageSize` |
| GET | `/api/articles/:id` | 文章详情 |
| PATCH | `/api/articles/:id` | 已读标记 |
| POST | `/api/articles/import` | 手动导入文章链接（兜底能力） |

### 3.4 总结与邮件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/summaries?date=` | 查询每日总结 |
| POST | `/api/summaries/run` | 手动生成（可传 `date` 重新生成） |
| GET | `/api/email/recipients` | 收件人列表 |
| POST | `/api/email/recipients` | 新增收件人 |
| DELETE | `/api/email/recipients/:id` | 删除收件人 |
| POST | `/api/email/test` | 测试发送 |
| POST | `/api/email/send` | 手动触发当日发送 |

### 3.5 系统与日志

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/logs/jobs` | 任务日志（按类型 / 时间筛选） |
| GET | `/api/logs/sends` | 邮件发送日志 |
| GET | `/api/settings` | 读取系统配置（密钥类字段脱敏） |
| PUT | `/api/settings` | 更新配置 |
| GET | `/api/stats/overview` | 总量、今日新增、最近抓取状态 |

## 4. 任务定义（`job_queue`）

| 任务 | 触发 | 幂等依据 |
| --- | --- | --- |
| `fetch-all` | 每日 cron | 任务名 + 日期 key |
| `fetch-account` | `fetch-all` 派发 / 手动 | `accountId` + 窗口 |
| `process-article` | `fetch-account` 派发 | `urlHash` |
| `summarize-day` | 每日 cron / 手动 | `date` |
| `send-digest` | 每日 cron / 手动 | `date` + 收件人集合 |
| `sync-catalog` | 每日 03:00 cron / worker 启动时过期补跑 / 手动 | `source` 维度 + `lastSeenAt` |

失败策略：指数退避重试（默认 3 次，间隔 30s 起步），超限标记 failed 并保留错误信息；`running` 超过 30 分钟未结束视为进程崩溃，自动回收重跑；`done` / `failed` 记录默认保留 7 天。
