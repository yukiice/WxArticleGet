import { Injectable, Logger } from '@nestjs/common';
import { JOB, dateKey, type JobPayloads } from '@wx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService, type CatalogSyncResult } from '../services/catalog.service';
import { DigestService } from '../services/digest.service';
import { IngestService, type FetchAccountResult } from '../services/ingest.service';
import { NotifyService } from '../services/notify.service';
import { SummaryService, type SummaryRunResult } from '../services/summary.service';
import { QueueProvider } from './queue.provider';

@Injectable()
export class JobRunnerService {
  private readonly logger = new Logger('Jobs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProvider,
    private readonly ingest: IngestService,
    private readonly summary: SummaryService,
    private readonly digest: DigestService,
    private readonly notify: NotifyService,
    private readonly catalog: CatalogService,
  ) {}

  /** 每日定时：为所有未暂停的账号派发抓取任务 */
  async fetchAll(): Promise<{ dispatched: number }> {
    const accounts = await this.prisma.account.findMany({
      where: { status: { not: 'paused' } },
      select: { id: true, name: true },
    });

    if (accounts.length === 0) {
      this.logger.warn('没有需要抓取的账号');
      return { dispatched: 0 };
    }

    for (const account of accounts) {
      await this.queue.enqueue(
        JOB.FETCH_ACCOUNT,
        { accountId: account.id },
        { singletonKey: `auto-${account.id}-${dateKey()}` },
      );
    }

    this.logger.log(`已派发 ${accounts.length} 个账号的抓取任务`);
    return { dispatched: accounts.length };
  }

  async fetchAccount(payload: JobPayloads['fetch-account']): Promise<FetchAccountResult> {
    const result = await this.ingest.fetchAccount(payload);
    this.logger.log(
      `抓取完成 account=${payload.accountId} 新增=${result.newCount} 跳过=${result.skipped} 失败=${result.failed}`,
    );
    return result;
  }

  async processArticle(payload: JobPayloads['process-article']): Promise<{ images: number; failed: number }> {
    return this.ingest.reprocess(payload.articleId);
  }

  async summarizeDay(payload: JobPayloads['summarize-day']): Promise<SummaryRunResult> {
    const result = await this.summary.run(payload.date, payload.force ?? false);
    this.logger.log(`总结完成 date=${payload.date ?? 'today'} 篇数=${result.articleCount} 跳过=${result.skipped}`);
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

  /** worker 启动时如果目录为空或过期，异步补一次同步 */
  async syncCatalogIfStale(): Promise<boolean> {
    if (!(await this.catalog.needsSync())) return false;
    await this.queue.enqueue(JOB.SYNC_CATALOG, {}, { singletonKey: `catalog-bootstrap-${dateKey()}` });
    this.logger.log('目录为空或已过期，已派发同步任务');
    return true;
  }
}

