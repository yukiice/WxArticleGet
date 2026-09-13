import { Injectable, NotFoundException } from '@nestjs/common';
import { dateKey, dayRange, resolveDailyWindow, type SummaryDto } from '@wx/shared';
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
      // 包含 status = 'empty'（当天没有新文章）的日子，方便回到历史查看
      where: { scope: 'global', status: { in: ['done', 'empty'] } },
      orderBy: { date: 'desc' },
      take: limit,
    });
    return summaries.map(toDto);
  }

  async run(date?: string, force = false): Promise<{ queued: boolean; date: string }> {
    const target = date ?? dateKey();
    const { from, to } = await this.resolveWindow(target);
    await this.queue.enqueue(
      'summarize-day',
      { date: target, force, windowFrom: from.toISOString(), windowTo: to.toISOString() },
      { singletonKey: `summary-${target}-${Date.now()}` },
    );
    return { queued: true, date: target };
  }

  /**
   * 与自动链路保持同一口径：截止点取该日 24:00，起点取该日之前最近一次成功产出日报的时刻，
   * 没发成功过则回退 24 小时。手动补生成历史某天时不会把后一天的文章算进来。
   */
  private async resolveWindow(target: string): Promise<{ from: Date; to: Date }> {
    const lastProduced = await this.prisma.sendLog.findFirst({
      where: { status: { in: ['success', 'skipped'] }, createdAt: { lt: dayRange(target).start } },
      orderBy: { createdAt: 'desc' },
      select: { sentAt: true, createdAt: true },
    });
    const lastDigestAt = lastProduced?.sentAt ?? lastProduced?.createdAt ?? null;
    const { from, to } = resolveDailyWindow(target, lastDigestAt);
    return { from, to };
  }
}

function toDto(summary: Summary): SummaryDto {
  return {
    id: summary.id,
    date: summary.date.toISOString().slice(0, 10),
    windowFrom: summary.windowFrom?.toISOString() ?? null,
    windowTo: summary.windowTo?.toISOString() ?? null,
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

