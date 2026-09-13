import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobQueue } from '@wx/queue';
import { JOB } from '@wx/shared';
import { queueDatabase } from '../../../../tests/helpers/queue-db';
import { JobRunnerService } from '../queue/job-runner.service';
import { SummaryService } from './summary.service';
import { DigestService } from './digest.service';
import { AccountsService } from '../../../api/src/accounts/accounts.service';

const external = vi.hoisted(() => ({ complete: vi.fn(), send: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: external.complete } }; } }));
vi.mock('@wx/email', async (original) => ({ ...await original<object>(), sendMail: external.send }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-13T00:30:00Z'));
  external.complete.mockReset().mockResolvedValue({ choices: [{ message: { content: '## 核心要点\n已抓取的新文章' } }] });
  external.send.mockReset().mockResolvedValue('message-id');
});
afterEach(() => vi.useRealTimers());

function fixture() {
  const { db: queueDb, rows } = queueDatabase();
  let summaryRow: any;
  const articles: any[] = [];
  const logs: any[] = [];
  const account = { id: 'account', name: '公众号' };
  const db: any = {
    ...queueDb,
    $transaction: async (callback: any) => callback(db),
    account: { findMany: async () => [account], findUnique: async () => account },
    summary: {
      findFirst: async ({ where }: any) => !summaryRow || (typeof where.status === 'string' && summaryRow.status !== where.status) ? null : summaryRow,
      create: async ({ data }: any) => (summaryRow = { id: 'summary', ...data }),
      update: async ({ data }: any) => Object.assign(summaryRow, data),
    },
    article: { findMany: async () => articles },
    sendLog: {
      findFirst: async ({ where }: any) => logs.find((log) => where.status.in.includes(log.status)
        && (where.date instanceof Date ? +where.date === +log.date : +log.date < +where.date.lt)) ?? null,
      create: async ({ data }: any) => { const row = { id: String(logs.length), ...data }; logs.push(row); return row; },
    },
  };
  const settings: any = { resolveAll: async () => ({
    llm: { apiKey: 'test', baseUrl: 'https://example.invalid', model: 'model', temperature: 0.3, maxInputCharsPerArticle: 8000 },
    smtp: {}, digest: { enabled: true, sendTime: '09:00', includeDigest: true, maxArticles: 20 },
  }) };
  const queue = new JobQueue(db, { retryDelayMs: 1000, pollIntervalMs: 10, logger: { log() {}, warn() {}, error() {} } });
  const notify: any = { alert: vi.fn(), recipients: async () => ['test@example.invalid'] };
  const config: any = { get: () => undefined };
  const summary = new SummaryService(db, settings, notify);
  const digest = new DigestService(db, queue as never, settings, notify, config);
  const runner = new JobRunnerService(db, queue as never, {} as never, summary, digest, notify, {} as never, settings, config);
  const addArticle = () => articles.push({ id: 'article', title: '新文章', contentText: '正文', publishTime: new Date('2026-09-13T00:00:00Z'), account, url: 'https://mp.weixin.qq.com/s/article' });
  return { db, rows, queue, runner, summary, digest, logs, addArticle, summaryRow: () => summaryRow };
}

describe('日报完整流程', () => {
  it('抓取失败重试期间，总结和兜底邮件等待；成功后使用同一窗口且定时发送不重复', async () => {
    const f = fixture();
    let attempts = 0;
    f.queue.work(JOB.FETCH_ALL, () => f.runner.fetchAll().then(() => {}));
    f.queue.work(JOB.FETCH_ACCOUNT, () => { if (++attempts === 1) throw new Error('temporary failure'); f.addArticle(); });
    f.queue.work(JOB.SUMMARIZE_DAY, (payload) => f.summary.run(payload as never).then(() => {}));
    f.queue.work(JOB.SEND_DIGEST, (payload) => f.digest.send(payload as never).then(() => {}));
    await f.queue.enqueue(JOB.FETCH_ALL);
    f.queue.start();
    try {
      await vi.advanceTimersByTimeAsync(1);
      await f.queue.enqueue(JOB.SEND_DIGEST, { scheduled: true }); // 模拟不带窗口的定时兜底。
      await vi.advanceTimersByTimeAsync(1);
      expect(external.complete).not.toHaveBeenCalled();
      expect(external.send).not.toHaveBeenCalled();
      expect(f.logs).toHaveLength(0); // 抓取未完成时不能记录「无新文章」。
      await vi.advanceTimersByTimeAsync(31_000);
      expect(external.complete).toHaveBeenCalledOnce();
      expect(external.send).toHaveBeenCalledOnce();
      expect(f.summaryRow()).toMatchObject({ status: 'done', articleCount: 1, windowTo: new Date('2026-09-13T00:30:00Z') });
      expect(f.logs[0]).toMatchObject({ status: 'success', windowFrom: f.summaryRow().windowFrom, windowTo: f.summaryRow().windowTo });
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(external.send).toHaveBeenCalledOnce();
    } finally { await f.queue.stop(); }
  });

  it('此前无文章时允许明确的人工补发，自动任务仍然去重', async () => {
    const f = fixture();
    await f.db.summary.create({ data: { date: new Date('2026-09-13T00:00:00Z'), scope: 'global', status: 'empty', windowFrom: new Date('2026-09-12T00:30:00Z'), windowTo: new Date('2026-09-13T00:30:00Z') } });
    await f.digest.send({ scheduled: true });
    expect(f.logs[0].status).toBe('skipped');
    f.addArticle();
    await f.db.summary.update({ data: { status: 'done', contentMd: '补录文章总结' } });
    await expect(f.digest.send({ force: true })).resolves.toMatchObject({ sent: true, articleCount: 1 });
    await f.digest.send({ scheduled: true });
    expect(external.send).toHaveBeenCalledOnce();
  });

  it('抓取最终失败时禁止发送，人工重试复用日报依赖的任务 ID', async () => {
    const f = fixture();
    await f.runner.fetchAll();
    const fetchJob = f.rows.find((row) => row.name === JOB.FETCH_ACCOUNT)!;
    fetchJob.status = 'failed';
    fetchJob.attempts = 3;
    fetchJob.singletonKey = null;
    await expect(f.digest.send({ scheduled: true })).rejects.toThrow('本批抓取尚未成功完成');
    expect(f.logs).toHaveLength(0);
    const accounts = new AccountsService(f.db, {} as never, f.queue as never);
    await accounts.triggerFetch('account');
    expect(fetchJob).toMatchObject({ status: 'pending', attempts: 0 });
    expect(f.summaryRow().fetchJobIds).toContain(fetchJob.id);
    expect(f.rows.filter((row) => row.name === JOB.FETCH_ACCOUNT)).toHaveLength(1);
  });
});
