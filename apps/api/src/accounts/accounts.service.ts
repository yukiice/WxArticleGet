import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ACCOUNT_STATUS, JOB, dateKey, type JobPayloads, type AccountCandidate, type AccountDto, type CreateAccountInput, type UpdateAccountInput } from '@wx/shared';
import { looksLikeUrl, lookupAccountCandidates, resolveAccountFromFeed, type ProviderContext } from '@wx/wechat';
import type { Account } from '@wx/db';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
  ) {}

  async providerContext(): Promise<ProviderContext> {
    const fetch = await this.settings.resolveFetch();
    return {
      searchEndpoint: fetch.searchEndpoint,
      rsshubBaseUrl: fetch.rsshubBaseUrl,
      requestDelayMs: fetch.requestDelayMs,
      fetchOptions: { timeoutMs: 20_000, retries: 2 },
    };
  }

  async list(): Promise<AccountDto[]> {
    const accounts = await this.prisma.account.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { articles: true } } },
    });
    return accounts.map((account) => toDto(account, account._count.articles));
  }

  async lookup(keyword: string): Promise<AccountCandidate[]> {
    const trimmed = keyword.trim();
    if (!trimmed) return [];

    if (!looksLikeUrl(trimmed)) {
      const catalogHits = await this.searchCatalog(trimmed);
      if (catalogHits.length > 0) return catalogHits;
    }

    return lookupAccountCandidates(trimmed, await this.providerContext());
  }

  /** 内置 RSS 目录：名称模糊匹配（decemberpei / wechat2rss 等免费清单） */
  private async searchCatalog(keyword: string): Promise<AccountCandidate[]> {
    const rows = await this.prisma.feedCatalogEntry.findMany({
      where: {
        // MySQL 的 *_ci 排序规则天然大小写不敏感
        OR: [{ name: { contains: keyword } }, { feedUrl: { contains: keyword } }],
      },
      take: 40,
    });
    if (rows.length === 0) return [];

    const lower = keyword.toLowerCase();
    const rank = (name: string): number => {
      const value = name.toLowerCase();
      if (value === lower) return 0;
      if (value.startsWith(lower)) return 1;
      if (value.includes(lower)) return 2;
      return 3;
    };

    return rows
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.length - b.name.length)
      .slice(0, 8)
      .map((row) => ({
        name: row.name,
        biz: row.biz ?? '',
        avatarUrl: row.avatarUrl ?? undefined,
        intro: row.intro ?? `RSS 目录（${row.source}）`,
        source: 'catalog',
        providerType: 'rss',
        providerConfig: { feedUrl: row.feedUrl },
      }));
  }

  async catalogStatus(): Promise<{ count: number; lastSyncedAt: string | null }> {
    const [count, latest] = await Promise.all([
      this.prisma.feedCatalogEntry.count(),
      this.prisma.feedCatalogEntry.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true } }),
    ]);
    return { count, lastSyncedAt: latest?.lastSeenAt.toISOString() ?? null };
  }

  async syncCatalog(): Promise<{ queued: boolean }> {
    await this.queue.enqueue(JOB.SYNC_CATALOG, {});
    return { queued: true };
  }

  async create(input: CreateAccountInput): Promise<AccountDto> {
    const providerConfig = (input.providerConfig ?? {}) as Record<string, unknown>;
    const feedUrl = typeof providerConfig.feedUrl === 'string' ? providerConfig.feedUrl : undefined;

    let biz = input.biz;
    if (!biz) {
      if (!feedUrl) {
        throw new BadRequestException('缺少公众号标识（__biz）：请粘贴该公众号任意一篇文章的链接来添加');
      }
      const resolved = await resolveAccountFromFeed(feedUrl, await this.providerContext());
      biz = resolved.biz;
      await this.prisma.feedCatalogEntry.updateMany({ where: { feedUrl }, data: { biz: resolved.biz } });
    }

    const existing = await this.prisma.account.findUnique({ where: { biz } });
    if (existing) throw new BadRequestException('该公众号已存在，无需重复添加');

    const account = await this.prisma.account.create({
      data: {
        name: input.name,
        biz,
        avatarUrl: input.avatarUrl ?? null,
        intro: input.intro ?? null,
        providerType: input.providerType,
        providerConfig: providerConfig as never,
        status: ACCOUNT_STATUS.active,
      },
    });

    if (input.initialFetch !== false) {
      await this.triggerFetch(account.id, input.sinceDays);
    }

    return toDto(account, 0);
  }

  async update(id: string, input: UpdateAccountInput): Promise<AccountDto> {
    await this.ensureExists(id);
    const account = await this.prisma.account.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.providerType ? { providerType: input.providerType } : {}),
        ...(input.providerConfig ? { providerConfig: input.providerConfig as never } : {}),
      },
      include: { _count: { select: { articles: true } } },
    });
    return toDto(account, account._count.articles);
  }

  async remove(id: string): Promise<{ ok: boolean }> {
    await this.ensureExists(id);
    await this.prisma.account.delete({ where: { id } });
    return { ok: true };
  }

  async triggerFetch(id: string, sinceDays?: number): Promise<{ queued: boolean }> {
    const account = await this.ensureExists(id);
    const summary = await this.prisma.summary.findFirst({
      where: { date: new Date(`${dateKey()}T00:00:00.000Z`), scope: 'global' },
      select: { fetchJobIds: true },
    });
    const ids = Array.isArray(summary?.fetchJobIds)
      ? summary.fetchJobIds.filter((value): value is string => typeof value === 'string')
      : [];
    if (ids.length > 0) {
      const failed = await this.prisma.jobQueue.findFirst({
        where: { id: { in: ids }, name: JOB.FETCH_ACCOUNT, status: 'failed', payload: { path: '$.accountId', equals: id } },
      });
      if (failed) {
        // 保留任务 ID，让日报对失败任务的依赖能在人工重试成功后解除。
        await this.prisma.jobQueue.updateMany({
          where: { id: failed.id, status: 'failed' },
          data: {
            status: 'pending',
            attempts: 0,
            startedAt: null,
            finishedAt: null,
            lastError: null,
            runAt: new Date(),
            payload: {
              ...(failed.payload as JobPayloads['fetch-account']),
              ...(sinceDays === undefined ? {} : { sinceDays }),
              manual: true,
            },
          },
        });
        return { queued: true };
      }
    }
    await this.queue.enqueue('fetch-account', {
      accountId: account.id,
      // 不传 sinceDays 时由 worker 取默认窗口（最近 24 小时 / 上次成功之后）
      sinceDays,
      manual: true,
    }, { singletonKey: `manual-fetch-${account.id}` });
    return { queued: true };
  }

  async ensureByBiz(candidate: AccountCandidate): Promise<Account> {
    const existing = await this.prisma.account.findUnique({ where: { biz: candidate.biz } });
    if (existing) return existing;

    return this.prisma.account.create({
      data: {
        name: candidate.name,
        biz: candidate.biz,
        avatarUrl: candidate.avatarUrl ?? null,
        intro: candidate.intro ?? null,
        providerType: candidate.providerType,
        providerConfig: (candidate.providerConfig ?? {}) as never,
      },
    });
  }

  private async ensureExists(id: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('账号不存在');
    return account;
  }
}

function toDto(account: Account, articleCount: number): AccountDto {
  return {
    id: account.id,
    name: account.name,
    biz: account.biz,
    avatarUrl: account.avatarUrl,
    intro: account.intro,
    providerType: account.providerType,
    providerConfig: (account.providerConfig as Record<string, unknown> | null) ?? null,
    status: account.status,
    lastFetchAt: account.lastFetchAt?.toISOString() ?? null,
    lastSuccessAt: account.lastSuccessAt?.toISOString() ?? null,
    articleCount,
    createdAt: account.createdAt.toISOString(),
  };
}
