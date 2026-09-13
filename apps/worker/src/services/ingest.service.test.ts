import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IngestService } from './ingest.service';

const source = vi.hoisted(() => ({ fetchArticle: vi.fn(), fetchArticlesForAccount: vi.fn() }));
vi.mock('@wx/wechat', async (original) => ({ ...await original<object>(), ...source }));
beforeEach(() => vi.resetAllMocks());

describe('抓取失败后的恢复', () => {
  it('保留失败窗口、触发告警与重试，恢复后不重复已成功入库的文章', async () => {
    const oldSuccess = new Date('2026-09-10T00:30:00Z');
    const account: any = { id: 'account', name: '公众号', biz: 'biz', providerType: 'rss', lastSuccessAt: oldSuccess, status: 'active' };
    const articles: any[] = [];
    const logs: any[] = [];
    const db = {
      account: { findUnique: async () => ({ ...account }), update: async ({ data }: any) => Object.assign(account, data) },
      jobLog: { create: async ({ data }: any) => { const row = { id: String(logs.length), ...data }; logs.push(row); return row; }, update: async ({ where, data }: any) => Object.assign(logs[Number(where.id)], data) },
      article: {
        findUnique: async ({ where }: any) => articles.find((row) => row.urlHash === where.urlHash),
        create: async ({ data }: any) => { const row = { id: String(articles.length), ...data }; articles.push(row); return row; },
        update: async ({ where, data }: any) => Object.assign(articles[Number(where.id)], data),
      },
    };
    const candidates = [{ title: 'first', url: 'https://mp.weixin.qq.com/s/first' }, { title: 'second', url: 'https://mp.weixin.qq.com/s/second' }];
    source.fetchArticlesForAccount.mockResolvedValue(candidates);
    let broken = true;
    source.fetchArticle.mockImplementation(async (url) => {
      if (broken && url.endsWith('second')) throw new Error('network unavailable');
      return { parsed: { title: url, contentHtml: '<p>body</p>', contentText: 'body', images: [], wordCount: 1 } };
    });
    const notify = { alert: vi.fn() };
    const service = new IngestService(db as never, { resolveAll: async () => ({ fetch: { requestDelayMs: 0, lookbackDays: 3, dailyLimitPerAccount: 50 } }) } as never,
      { localizeImages: async () => ({ contentHtml: '<p>body</p>', files: [], failed: 0 }) } as never, notify as never);
    await expect(service.fetchAccount({ accountId: account.id })).rejects.toThrow('1 篇文章处理失败');
    expect(account.lastSuccessAt).toEqual(oldSuccess);
    expect(logs[0]).toMatchObject({ status: 'failed', newCount: 1 });
    expect(notify.alert).toHaveBeenCalledOnce();
    broken = false;
    await expect(service.fetchAccount({ accountId: account.id })).resolves.toMatchObject({ newCount: 1, skipped: 1, failed: 0 });
    expect(articles).toHaveLength(2);
    expect(account.lastSuccessAt.getTime()).toBeGreaterThan(oldSuccess.getTime());
    expect(logs[1].status).toBe('success');
  });
});
