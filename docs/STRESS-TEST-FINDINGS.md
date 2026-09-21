# 压力测试与评审发现

> 记录 2026-09-21 全量评审 + 压力测试的结论。所有已验证项都附了复现方式或测试用例位置。

## 一、已修复并验证

| # | 问题 | 影响 | 修复 | 测试 |
|---|---|---|---|---|
| 1 | 微信风控空壳页（`no-content`）被算作任务失败 | 一篇坏文章让 fetch 重试 3 次后 failed，账号进 `error`、`lastSuccessAt` 不推进，连锁阻塞当天总结与日报 | [ingest.service.ts](../apps/worker/src/services/ingest.service.ts) 把 `no-content` 并入跳过类 | `ingest.service.test.ts` |
| 2 | sendMail 单次尝试，瞬时 TLS 断开即失败 | 163 邮箱偶发 `Connection closed unexpectedly`，日报发不出去 | [transport.ts](../packages/email/src/transport.ts) 瞬时错误自动重连重试（3 次，3s/6s 退避） | `packages/email/src/transport.test.ts` |
| 3 | 失败任务只能等次日 cron，无自动恢复 | 抓取失败后十几个小时不动，全靠人工点重试 | 新增 `retry-failed` 每小时续跑（24h 窗口、累计尝试 ≤ 6） | `digest-flow.test.ts` |
| 4 | `data:text/html` 链接逃过 sanitize | 点击正文链接可在新标签页执行任意 JS（XSS） | `allowedSchemesByTag.a` 收紧为 `http/https/mailto` | `tests/stress-parse.test.ts` |
| 5 | 生产环境 `AUTH_SECRET` 有内置默认值 | 忘配时等于没有签名校验 | 生产 + 默认值直接拒绝启动 | `auth.module.ts` |
| 6 | 登录接口无限流 | 可在线暴力破解 | 按 IP 5 分钟 5 次，429 拒绝 | `tests/rate-limit.test.ts` |

## 二、压测通过的边界

队列（`tests/stress-queue.test.ts`）：
- 500 个任务批量入队，按 batchSize=20 消化，全部 done
- 并发 200 次入队（100 个 singletonKey），每个 key 只保留 1 条
- `JobDeferredError` 不消耗重试额度
- 永久失败按指数退避到 maxAttempts 后释放 singletonKey
- running 中任务不被 reap
- prune 只清理已完成/失败，不动在途任务

正文解析（`tests/stress-parse.test.ts`）：
- 10,000 段 / 40 万字超大正文，sanitize + 纯文本转换 + 字数统计均正常
- script / onerror / javascript: / data:text/html / style url() / expression() / iframe / form 全部剔除
- 1000 张同 URL 图片去重为 1 条
- 空输入、截断 HTML 不抛错

API 层（`tests/api-stress.sh`，打本地容器）：
- 100 并发读（50 列表 + 30 统计 + 20 详情）全部 200
- 20 并发写同一文章无冲突
- 路径穿越、非图片扩展名、未登录访问、注入样式用户名、错误密码不泄密均正确拒绝

## 三、遗留待办（按优先级）

1. **`articles` 搜索无索引**：`q` 走 `contains` 扫 `contentText`(LongText)，数据量上来会慢。个人规模暂时够用。
2. **Dockerfile 无多阶段**：devDependencies（turbo/vitest/tsc）留在最终镜像，可加 `next standalone` 瘦身。
3. **限流为单实例内存实现**：多副本部署会失效，需换共享存储。
4. **RSS 源是第三方免费服务**（decemberpei.cyou），挂了会静默无候选，需靠告警邮件发现；建议评估自建 RSSHub。
5. **`LoginRateLimiter` 的 Map 无上限清理**：不同 IP 失败记录会累积（当前只在成功登录时删单条）。

## 四、复现方式

```bash
pnpm test                      # 87 个用例
bash tests/api-stress.sh       # API 并发 + 边界，注意会锁 IP 5 分钟
```
