import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_TIMEZONE, JOB, dailyCron, type JobPayloads } from '@wx/shared';
import { SettingsService } from '../settings/settings.service';
import { JobRunnerService } from './job-runner.service';
import { QueueProvider } from './queue.provider';

@Injectable()
export class ScheduleService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Worker');

  constructor(
    private readonly queue: QueueProvider,
    private readonly runner: JobRunnerService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  // 必须用 onApplicationBootstrap：Nest 的 onModuleInit 是并发触发的，
  // 处理器还没注册完就开始轮询会漏任务。
  async onApplicationBootstrap(): Promise<void> {
    const queue = this.queue.instance;

    queue.work(JOB.FETCH_ALL, async () => {
      await this.runner.fetchAll();
    });

    queue.work(JOB.FETCH_ACCOUNT, async (payload, signal) => {
      await this.runner.fetchAccount(payload as JobPayloads['fetch-account'], signal);
    });

    queue.work(JOB.PROCESS_ARTICLE, async (payload) => {
      await this.runner.processArticle(payload as JobPayloads['process-article']);
    });

    queue.work(JOB.SUMMARIZE_DAY, async (payload, signal) => {
      await this.runner.summarizeDay((payload ?? {}) as JobPayloads['summarize-day'], signal);
    });

    queue.work(JOB.SEND_DIGEST, async (payload) => {
      await this.runner.sendDigest((payload ?? {}) as JobPayloads['send-digest']);
    });

    queue.work(JOB.SEND_ALERT, async (payload) => {
      await this.runner.sendAlert(payload as JobPayloads['send-alert']);
    });

    queue.work(JOB.SYNC_CATALOG, async () => {
      await this.runner.syncCatalog();
    });

    // 近 24 小时内失败的抓取/总结/日报每小时自动续跑，不再依赖人工点重试
    queue.work(JOB.RETRY_FAILED, async () => {
      await this.runner.retryFailed();
    });

    await this.registerSchedules();
    queue.start();
    await this.prune();

    try {
      await this.runner.syncCatalogIfStale();
    } catch (error) {
      this.logger.warn(`目录预热同步派发失败：${error instanceof Error ? error.message : String(error)}`);
    }
    this.logger.log('任务处理器与定时计划已就绪');
  }

  private async registerSchedules(): Promise<void> {
    const queue = this.queue.instance;
    const timeZone = this.config.get<string>('TZ') ?? DEFAULT_TIMEZONE;
    const fetchCron = this.config.get<string>('FETCH_CRON') ?? '30 8 * * *';
    const summaryCron = this.config.get<string>('SUMMARY_CRON') ?? '45 8 * * *';
    const catalogCron = this.config.get<string>('CATALOG_CRON') ?? '0 3 * * *';
    const settings = await this.settings.resolveAll();
    const digestCron = dailyCron(settings.digest.sendTime);
    // 兜底：正常链路由 fetch-all 在抓取完成后排期，这里只在链路没跑起来时补一次
    const digestFallbackCron = dailyCron(addMinutes(settings.digest.sendTime, 30));

    queue.schedule(JOB.SYNC_CATALOG, catalogCron, {}, { timeZone });
    queue.schedule(JOB.FETCH_ALL, fetchCron, {}, { timeZone });
    queue.schedule(JOB.SUMMARIZE_DAY, summaryCron, {}, { timeZone });
    queue.schedule(JOB.SEND_DIGEST, digestCron, { scheduled: true }, { timeZone });
    queue.schedule(JOB.SEND_DIGEST, digestFallbackCron, { scheduled: true }, { timeZone });
    queue.schedule(JOB.RETRY_FAILED, '10 * * * *', {}, { timeZone });

    this.logger.log(
      `定时计划：目录「${catalogCron}」 抓取「${fetchCron}」 总结兜底「${summaryCron}」 日报「${digestCron}」 日报兜底「${digestFallbackCron}」 失败续跑「10 * * * *」（${timeZone}）`,
    );
  }

  /** 启动时清理历史任务记录（默认保留 7 天） */
  private async prune(): Promise<void> {
    try {
      const removed = await this.queue.instance.prune(Number(this.config.get<string>('QUEUE_KEEP_DAYS') ?? 7));
      if (removed > 0) this.logger.log(`已清理 ${removed} 条历史任务记录`);
    } catch (error) {
      this.logger.warn(`清理历史任务失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** HH:mm 加 N 分钟，用于计算兜底 cron */
function addMinutes(time: string, minutes: number): string {
  const [hour, minute] = time.split(':').map(Number);
  const total = (hour * 60 + minute + minutes) % (24 * 60);
  const hh = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const mm = (total % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}
