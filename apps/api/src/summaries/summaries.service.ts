import { Injectable, NotFoundException } from '@nestjs/common';
import { dateKey, type SummaryDto } from '@wx/shared';
import type { Summary } from '@wx/db';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

export function toDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

@Injectable()
export class SummariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async byDate(date: string): Promise<SummaryDto | null> {
    const summary = await this.prisma.summary.findFirst({
      where: { date: toDateOnly(date), scope: 'global' },
    });
    return summary ? toDto(summary) : null;
  }

  async detail(id: string): Promise<SummaryDto> {
    const summary = await this.prisma.summary.findUnique({ where: { id } });
    if (!summary) throw new NotFoundException('总结不存在');
    return toDto(summary);
  }

  async recent(limit = 30): Promise<SummaryDto[]> {
    const summaries = await this.prisma.summary.findMany({
      where: { scope: 'global', status: 'done' },
      orderBy: { date: 'desc' },
      take: limit,
    });
    return summaries.map(toDto);
  }

  async run(date?: string, force = false): Promise<{ queued: boolean; date: string }> {
    const target = date ?? dateKey();
    await this.queue.enqueue('summarize-day', { date: target, force }, { singletonKey: `summary-${target}-${Date.now()}` });
    return { queued: true, date: target };
  }
}

function toDto(summary: Summary): SummaryDto {
  return {
    id: summary.id,
    date: summary.date.toISOString().slice(0, 10),
    scope: summary.scope,
    accountId: summary.accountId,
    model: summary.model,
    contentMd: summary.contentMd,
    status: summary.status,
    articleCount: summary.articleCount,
    tokenIn: summary.tokenIn,
    tokenOut: summary.tokenOut,
    createdAt: summary.createdAt.toISOString(),
  };
}

