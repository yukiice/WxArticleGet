import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobQueue, nextRunAt } from '@wx/queue';
import { resolveDigestWindow } from '@wx/db';
import {
  DEFAULT_TIMEZONE,
  JOB,
  dailyCron,
  dateKey,
  formatDateTime,
  formatRange,
  type JobPayloads,
} from '@wx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService, type CatalogSyncResult } from '../tasks/catalog.service';
import { DigestService } from '../tasks/digest.service';
import { IngestService, type FetchAccountResult } from '../tasks/ingest.service';
import { NotifyService } from '../tasks/notify.service';
import { SummaryService, type SummaryRunResult } from '../tasks/summary.service';
import { SettingsService } from '../settings/settings.service';
import { QueueService } from './queue.service';

@Injectable()
export class JobRunnerService {
  private readonly logger = new Logger('Jobs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly ingest: IngestService,
    private readonly summary: SummaryService,
    private readonly digest: DigestService,
    private readonly notify: NotifyService,
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /** 原子发布一批抓取任务和日报窗口；总结/发送会等待这些任务成功完成。 */
  async fetchAll(): Promise<{ dispatched: number; windowFrom: string; windowTo: string }> {
    const cutoff = new Date();
    const target = dateKey(cutoff);
    const settings = await this.settings.resolveAll();
    const accounts = await this.prisma.account.findMany({
      where: { status: { not: 'paused' } },
      select: { id: true, name: true },
    });

    const sendAt = this.nextSendAt(settings.digest.sendTime, cutoff);
    const window = await this.prisma.$transaction(async (tx) => {
      const { from, to } = await resolveDigestWindow(tx, target, cutoff);
      const queue = new JobQueue(tx);
      const fetchJobIds: string[] = [];
      for (const account of accounts) {
        const id = await queue.enqueue(
          JOB.FETCH_ACCOUNT,
          { accountId: account.id, windowFrom: from.toISOString() },
          { singletonKey: `auto-${account.id}-${target}` },
        );
        if (id) fetchJobIds.push(id);
      }
      const date = new Date(`${target}T00:00:00.000Z`);
      const existing = await tx.summary.findFirst({ where: { date, scope: 'global' }, select: { id: true } });
      const data = { windowFrom: from, windowTo: to, fetchJobIds, status: 'pending' };
      if (existing) {
        await tx.summary.update({ where: { id: existing.id }, data });
      } else {
        await tx.summary.create({
          data: {
            ...data, date, scope: 'global', model: settings.llm.model, promptVer: 'v2',
            contentMd: '', articleCount: 0, tokenIn: 0, tokenOut: 0,
          },
        });
      }

      const windowFrom = from.toISOString();
      const windowTo = to.toISOString();
      await queue.enqueue(
        JOB.SUMMARIZE_DAY,
        { date: target, windowFrom, windowTo },
        { singletonKey: `summary-${target}` },
      );
      await queue.enqueue(
        JOB.SEND_DIGEST,
        { date: target, windowFrom, windowTo, scheduled: true },
        { runAt: sendAt, singletonKey: `digest-${target}` },
      );
      return { windowFrom, windowTo };
    }, { timeout: 30_000 });
    this.logger.log(
      `已派发 ${accounts.length} 个账号；日报区间 ${formatRange(new Date(window.windowFrom), new Date(window.windowTo))}，发送时间 ${formatDateTime(sendAt)}`,
    );
    return { dispatched: accounts.length, ...window };
  }

  /**
   * 今天还没到发送时间就用今天的，已经过了（比如任务重试到当天下午）就立刻发。
   *
   * 注意 nextRunAt 返回的是「严格之后」的一次触发：08:30 抓取时用它会取到明天 09:00，
   * 所以先把基准时间往前挪一分钟，落在 08:30 时才能取到当天 09:00。
   */
  private nextSendAt(sendTime: string, cutoff: Date): Date {
    try {
      const timeZone = this.config.get<string>('TZ') ?? DEFAULT_TIMEZONE;
      const next = nextRunAt(dailyCron(sendTime), timeZone, new Date(cutoff.getTime() - 60_000));
      if (next.getTime() - cutoff.getTime() > 12 * 60 * 60 * 1000) {
        return new Date(cutoff.getTime() + 5_000);
      }
      return next;
    } catch {
      return new Date(cutoff.getTime() + 5_000);
    }
  }

  async fetchAccount(payload: JobPayloads['fetch-account'], signal?: AbortSignal): Promise<FetchAccountResult> {
    const result = await this.ingest.fetchAccount(payload, signal);
    this.logger.log(
      `抓取完成 account=${payload.accountId} 新增=${result.newCount} 跳过=${result.skipped} 失败=${result.failed}`,
    );
    return result;
  }

  async processArticle(payload: JobPayloads['process-article']): Promise<{ images: number; failed: number }> {
    return this.ingest.reprocess(payload.articleId);
  }

  async summarizeDay(payload: JobPayloads['summarize-day'], signal?: AbortSignal): Promise<SummaryRunResult> {
    const result = await this.summary.run(payload, signal);
    this.logger.log(
      `总结完成 date=${payload.date ?? 'today'} 篇数=${result.articleCount} 跳过=${result.skipped}`,
    );
    return result;
  }

  async sendDigest(payload: JobPayloads['send-digest']) {
    return this.digest.send(payload);
  }

  async sendAlert(payload: JobPayloads['send-alert']): Promise<void> {
    await this.notify.alert(payload.subject, payload.message);
  }

  /** 同步免费 RSS 目录（名称搜索的数据来源） */
  async syncCatalog(): Promise<CatalogSyncResult> {
    return this.catalog.sync();
  }

  /**
   * 每小时回收近 24 小时内失败的链路任务（fetch-account / summarize-day / send-digest）：
   * - 抓取失败当天往往只是临时网络/风控问题，人工点重试不如每小时自动补抓；
   * - summarize / send-digest 失败多为「依赖的抓取还没成功」，抓取恢复后同样自动重跑；
   * - attempts 累计 ≥ 6 的任务视为彻底失败，不再无限重试，防止坏文章死循环。
   */
  async retryFailed(): Promise<{ repended: number }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stale = await this.prisma.jobQueue.findMany({
      where: {
        status: 'failed',
        updatedAt: { gte: since },
        name: { in: [JOB.FETCH_ACCOUNT, JOB.SUMMARIZE_DAY, JOB.SEND_DIGEST] },
        attempts: { lt: 6 },
      },
      select: { id: true },
    });
    if (stale.length === 0) return { repended: 0 };

    for (const job of stale) {
      // 继续沿用原 payload，attempts 不清零（由认领时递增），做到总尝试次数封顶
      await this.prisma.jobQueue.updateMany({
        where: { id: job.id, status: 'failed' },
        data: { status: 'pending', startedAt: null, finishedAt: null, runAt: new Date() },
      });
    }
    this.logger.log(`自动续跑 ${stale.length} 个失败任务（fetch/总结/日报，24 小时窗口内，累计尝试 ≤ 6 次）`);
    return { repended: stale.length };
  }

  /** 应用启动时如果目录为空或过期，异步补一次同步 */
  async syncCatalogIfStale(): Promise<boolean> {
    if (!(await this.catalog.needsSync())) return false;
    await this.queue.enqueue(JOB.SYNC_CATALOG, {}, { singletonKey: `catalog-bootstrap-${dateKey()}` });
    this.logger.log('目录为空或已过期，已派发同步任务');
    return true;
  }
}

