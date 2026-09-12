import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  hashUrl,
  lookupAccountCandidates,
} from '@wx/wechat';
import {
  dateKey as toDateKey,
  dayRange,
  type ArticleDetailDto,
  type ArticleListItemDto,
  type ArticleQuery,
  type ImportArticleInput,
  type Paginated,
} from '@wx/shared';
import type { Prisma } from '@wx/db';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { AccountsService } from '../accounts/accounts.service';

type ArticleWithAccount = Prisma.ArticleGetPayload<{ include: { account: true } }>;

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly queue: QueueService,
  ) {}

  async list(query: ArticleQuery): Promise<Paginated<ArticleListItemDto>> {
    const where: Prisma.ArticleWhereInput = {};

    if (query.date) {
      const { start, end } = dayRange(query.date);
      where.publishTime = { gte: start, lt: end };
    }
    if (query.accountId) where.accountId = query.accountId;
    if (query.isRead) where.isRead = query.isRead === 'true';
    if (query.q) {
      // MySQL 默认排序规则（utf8mb4_unicode_ci / utf8mb4_0900_ai_ci）本就大小写不敏感，
      // 不需要 PG 的 mode: 'insensitive'
      where.OR = [{ title: { contains: query.q } }, { contentText: { contains: query.q } }];
    }

    const [total, items] = await Promise.all([
      this.prisma.article.count({ where }),
      this.prisma.article.findMany({
        where,
        orderBy: [{ publishTime: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { account: true },
      }),
    ]);

    return {
      items: items.map(toListItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(id: string): Promise<ArticleDetailDto> {
    const article = await this.prisma.article.findUnique({ where: { id }, include: { account: true } });
    if (!article) throw new NotFoundException('文章不存在');

    return {
      ...toListItem(article),
      contentHtml: article.contentHtml,
      contentText: article.contentText,
      author: article.author,
      url: article.url,
    };
  }

  async markRead(id: string, isRead: boolean): Promise<{ ok: boolean }> {
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) throw new NotFoundException('文章不存在');

    await this.prisma.article.update({ where: { id }, data: { isRead } });
    return { ok: true };
  }

  async importArticle(input: ImportArticleInput): Promise<{ accountId: string; queued: boolean }> {
    let accountId = input.accountId;

    if (!accountId) {
      const candidates = await lookupAccountCandidates(input.url, await this.accounts.providerContext());
      if (candidates.length === 0) {
        throw new BadRequestException('无法从链接解析出公众号信息，请确认这是公众号文章链接');
      }
      const account = await this.accounts.ensureByBiz(candidates[0]);
      accountId = account.id;
    }

    await this.queue.enqueue(
      'fetch-account',
      { accountId, urls: [input.url], manual: true },
      { singletonKey: `import-${hashUrl(input.url)}`, maxAttempts: 2 },
    );

    return { accountId, queued: true };
  }

  async todayCount(): Promise<number> {
    const { start, end } = dayRange(toDateKey());
    return this.prisma.article.count({ where: { publishTime: { gte: start, lt: end } } });
  }
}

function toListItem(article: ArticleWithAccount): ArticleListItemDto {
  return {
    id: article.id,
    title: article.title,
    digest: article.digest,
    coverUrl: article.coverUrl,
    coverLocal: article.coverLocal,
    publishTime: article.publishTime.toISOString(),
    isRead: article.isRead,
    wordCount: article.wordCount,
    account: {
      id: article.account.id,
      name: article.account.name,
      avatarUrl: article.account.avatarUrl,
    },
  };
}
