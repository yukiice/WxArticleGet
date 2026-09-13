import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { renderDigestEmail, sendMail, type DigestArticle } from '@wx/email';
import { DEFAULT_DIGEST_WINDOW_HOURS, JOB, dateKey, formatDateTime, formatRange, type JobPayloads } from '@wx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QueueProvider } from '../queue/queue.provider';
import { SettingsService } from '../settings/settings.service';
import { NotifyService } from './notify.service';

const MAX_SUMMARY_DEFER = 5;
const SUMMARY_DEFER_MS = 60_000;

export interface DigestResult {
  sent: boolean;
  recipients: string[];
  articleCount: number;
}

@Injectable()
export class DigestService {
  private readonly logger = new Logger('Digest');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProvider,
    private readonly settings: SettingsService,
    private readonly notify: NotifyService,
    private readonly config: ConfigService,
  ) {}

  /** 统计区间默认为「过去 24 小时」，定时链路由 fetch-all 传入精确区间 */
  async send(payload: JobPayloads['send-digest']): Promise<DigestResult> {
    const to = payload.windowTo ? new Date(payload.windowTo) : new Date();
    const from = payload.windowFrom
      ? new Date(payload.windowFrom)
      : new Date(to.getTime() - DEFAULT_DIGEST_WINDOW_HOURS * 60 * 60 * 1000);
    const target = payload.date ?? dateKey(to);
    const dateOnly = new Date(`${target}T00:00:00.000Z`);
    const range = formatRange(from, to);
    const settings = await this.settings.resolveAll();

    if (!settings.digest.enabled && !payload.test) {
      this.logger.log('邮件推送已关闭，跳过');
      return { sent: false, recipients: [], articleCount: 0 };
    }

    // 当天已经产出过日报（含「无新文章」）就不再重复发送：
    // 定时任务重跑、兜底任务、以及带「总结未就绪」顺延的重复投递都靠这里去重
    const alreadySent = await this.prisma.sendLog.findFirst({
      where: { date: dateOnly, status: { in: ['success', 'skipped'] } },
      select: { id: true },
    });
    if (alreadySent && !payload.test) {
      this.logger.log(`${target} 已有发送记录，跳过推送`);
      return { sent: false, recipients: [], articleCount: 0 };
    }

    const recipients = payload.to?.length ? payload.to : await this.notify.recipients();
    if (recipients.length === 0) {
      await this.notify.alert('邮件推送失败', '没有可用的收件人，请在管理后台添加收件人。');
      return { sent: false, recipients: [], articleCount: 0 };
    }

    const articles = await this.prisma.article.findMany({
      where: { publishTime: { gte: from, lt: to } },
      orderBy: { publishTime: 'desc' },
      take: settings.digest.maxArticles,
      include: { account: true },
    });

    if (articles.length === 0 && !payload.test) {
      // 区间内没有新文章属于正常情况：不发邮件、不发告警，只留一条记录供后台查看
      await this.prisma.sendLog.create({
        data: {
          date: dateOnly,
          subject: `【${target}】无新文章`,
          recipients: recipients.join(', '),
          status: 'skipped',
        },
      });
      this.logger.log(`${range} 没有新文章，跳过推送`);
      return { sent: false, recipients, articleCount: 0 };
    }

    // AI 总结还没跑完时顺延重发，避免日报发出去缺了总结（总结失败则照常发送，避免卡死）
    if (settings.digest.includeDigest && !payload.test) {
      const summaryRow = await this.prisma.summary.findFirst({
        where: { date: dateOnly, scope: 'global' },
        select: { status: true },
      });
      // 只有明确落库为终态才算「就绪」：还没生成（无记录）或正在生成都要等，
      // 生成失败则照常发送，避免日报被卡住。
      const ready = summaryRow?.status === 'done' || summaryRow?.status === 'empty';
      const deferCount = payload.deferCount ?? 0;
      if (!ready && deferCount < MAX_SUMMARY_DEFER) {
        const runAt = new Date(Date.now() + SUMMARY_DEFER_MS);
        await this.queue.enqueue(
          JOB.SEND_DIGEST,
          { ...payload, deferCount: deferCount + 1 },
          { runAt, singletonKey: `digest-${target}-defer${deferCount + 1}` },
        );
        this.logger.log(
          `${target} 的 AI 总结还没生成完（${summaryRow?.status ?? 'pending'}），${SUMMARY_DEFER_MS / 1000}s 后重试（第 ${deferCount + 1}/${MAX_SUMMARY_DEFER} 次）`,
        );
        return { sent: false, recipients, articleCount: articles.length };
      }
      if (!ready) {
        this.logger.warn(`${target} 的 AI 总结仍未就绪（${summaryRow?.status ?? 'pending'}），按当前状态发送不含总结的日报`);
      }
    }

    const summary = settings.digest.includeDigest
      ? await this.prisma.summary.findFirst({ where: { date: dateOnly, scope: 'global', status: 'done' } })
      : null;

    const siteUrl = (this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
    const digestArticles: DigestArticle[] = articles.map((article) => ({
      title: article.title,
      url: `${siteUrl}/articles/${article.id}`,
      sourceUrl: article.url,
      accountName: article.account.name,
      publishTime: formatDateTime(article.publishTime),
      digest: article.digest,
      coverUrl: article.coverLocal ? `${siteUrl}${article.coverLocal}` : article.coverUrl,
    }));

    const rendered = renderDigestEmail({
      date: target,
      rangeLabel: range,
      summaryMarkdown: summary?.status === 'done' ? summary.contentMd : null,
      summaryModel: summary?.model ?? null,
      articles: digestArticles,
      siteUrl,
      maxArticles: settings.digest.maxArticles,
    });

    try {
      const messageId = await sendMail(settings.smtp, {
        to: recipients,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });

      await this.prisma.sendLog.create({
        data: {
          date: dateOnly,
          subject: rendered.subject,
          recipients: recipients.join(', '),
          status: 'success',
          sentAt: new Date(),
        },
      });

      this.logger.log(`已发送 ${target} 的日报（${range}，${articles.length} 篇）到 ${recipients.join(', ')}（${messageId}）`);
      return { sent: true, recipients, articleCount: articles.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.sendLog.create({
        data: {
          date: dateOnly,
          subject: rendered.subject,
          recipients: recipients.join(', '),
          status: 'failed',
          error: message,
        },
      });
      await this.notify.alert(`邮件发送失败（${target}）`, `收件人：${recipients.join(', ')}\n\n原因：${message}`);
      throw error;
    }
  }
}
