import { Injectable } from '@nestjs/common';
import { jobLogQuerySchema, type JobLogDto, type Paginated } from '@wx/shared';
import type { Prisma } from '@wx/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  async jobs(query: unknown): Promise<Paginated<JobLogDto>> {
    const input = jobLogQuerySchema.parse(query);
    const where: Prisma.JobLogWhereInput = {};
    if (input.type) where.type = input.type;
    if (input.status) where.status = input.status;

    const [total, items] = await Promise.all([
      this.prisma.jobLog.count({ where }),
      this.prisma.jobLog.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        include: { account: true },
      }),
    ]);

    return {
      total,
      page: input.page,
      pageSize: input.pageSize,
      items: items.map((log) => ({
        id: log.id,
        type: log.type,
        accountId: log.accountId,
        accountName: log.account?.name ?? null,
        status: log.status,
        newCount: log.newCount,
        error: log.error,
        startedAt: log.startedAt.toISOString(),
        finishedAt: log.finishedAt?.toISOString() ?? null,
      })),
    };
  }
}

