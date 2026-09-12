import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_TIMEZONE, JOB, dailyCron, type JobPayloads } from '@wx/shared';
import { SettingsService } from '../settings/settings.service';
import { BossProvider } from './boss.provider';
import { JobRunnerService } from './job-runner.service';

@Injectable()
export class BossService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Worker');

  constructor(
    private readonly boss: BossProvider,
    private readonly runner: JobRunnerService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  // 必须用 onApplicationBootstrap：Nest 的 onModuleInit 是并发触发的，
  // 此时 BossProvider 的 PgBoss 实例可能尚未就绪。
  async onApplicationBootstrap(): Promise<void> {
    const boss = this.boss.instance;

    await boss.work(JOB.FETCH_ALL, async () => {
      await this.runner.fetchAll();
    });

    await boss.work(JOB.FETCH_ACCOUNT, async (jobs) => {
      for (const job of jobs) {
        await this.runner.fetchAccount(job.data as JobPayloads['fetch-account']);
      }
    });

    await boss.work(JOB.PROCESS_ARTICLE, async (jobs) => {
      for (const job of jobs) {
        await this.runner.processArticle(job.data as JobPayloads['process-article']);
      }
    });

    await boss.work(JOB.SUMMARIZE_DAY, async (jobs) => {
      for (const job of jobs) {
        await this.runner.summarizeDay((job.data ?? {}) as JobPayloads['summarize-day']);
      }
    });

    await boss.work(JOB.SEND_DIGEST, async (jobs) => {
      for (const job of jobs) {
        await this.runner.sendDigest((job.data ?? {}) as JobPayloads['send-digest']);
      }
    });

    await boss.work(JOB.SEND_ALERT, async (jobs) => {
      for (const job of jobs) {
        await this.runner.sendAlert(job.data as JobPayloads['send-alert']);
      }
    });

    await boss.work(JOB.SYNC_CATALOG, async () => {
      await this.runner.syncCatalog();
    });

    await this.registerSchedules();
    try {
      await this.runner.syncCatalogIfStale();
    } catch (error) {
      this.logger.warn(`目录预热同步派发失败：${error instanceof Error ? error.message : String(error)}`);
    }
    this.logger.log('任务处理器与定时计划已就绪');
  }

  private async registerSchedules(): Promise<void> {
    const boss = this.boss.instance;
    const timeZone = this.config.get<string>('TZ') ?? DEFAULT_TIMEZONE;
    const fetchCron = this.config.get<string>('FETCH_CRON') ?? '0 7 * * *';
    const summaryCron = this.config.get<string>('SUMMARY_CRON') ?? '30 7 * * *';
    const catalogCron = this.config.get<string>('CATALOG_CRON') ?? '0 3 * * *';
    const settings = await this.settings.resolveAll();
    const digestCron = dailyCron(settings.digest.sendTime);

    await boss.schedule(JOB.SYNC_CATALOG, catalogCron, {}, { tz: timeZone });
    await boss.schedule(JOB.FETCH_ALL, fetchCron, {}, { tz: timeZone });
    await boss.schedule(JOB.SUMMARIZE_DAY, summaryCron, {}, { tz: timeZone });
    await boss.schedule(JOB.SEND_DIGEST, digestCron, {}, { tz: timeZone });

    this.logger.log(
      `定时计划：目录「${catalogCron}」 抓取「${fetchCron}」 总结「${summaryCron}」 邮件「${digestCron}」（${timeZone}）`,
    );
  }
}

