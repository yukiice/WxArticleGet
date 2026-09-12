import { Injectable } from '@nestjs/common';
import { dateKey, dayRange, type OverviewStatsDto } from '@wx/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<OverviewStatsDto> {
    const { start, end } = dayRange(dateKey());

    const [totalArticles, todayArticles, totalAccounts, unreadArticles, accountsWithError, lastSuccess] =
      await Promise.all([
        this.prisma.article.count(),
        this.prisma.article.count({ where: { publishTime: { gte: start, lt: end } } }),
        this.prisma.account.count(),
        this.prisma.article.count({ where: { isRead: false } }),
        this.prisma.account.count({ where: { status: 'error' } }),
        this.prisma.account.findFirst({
          where: { lastSuccessAt: { not: null } },
          orderBy: { lastSuccessAt: 'desc' },
          select: { lastSuccessAt: true },
        }),
      ]);

    return {
      totalArticles,
      todayArticles,
      totalAccounts,
      unreadArticles,
      accountsWithError,
      lastSuccessfulFetchAt: lastSuccess?.lastSuccessAt?.toISOString() ?? null,
    };
  }
}

