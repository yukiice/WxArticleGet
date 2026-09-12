import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { renderDigestEmail, sendMail, type DigestArticle } from '@wx/email';
import { dateKey, dayRange, formatDateTime, type JobPayloads } from '@wx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotifyService } from './notify.service';

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
    private readonly settings: SettingsService,
    private readonly notify: NotifyService,
    private readonly config: ConfigService,
  ) {}

  async send(payload: JobPayloads['send-digest']): Promise<DigestResult> {
    const target = payload.date ?? dateKey();
    const dateOnly = new Date(`${target}T00:00:00.000Z`);
    const settings = await this.settings.resolveAll();

    if (!settings.digest.enabled && !payload.test) {
      this.logger.log('邮件推送已关闭，跳过');
      return { sent: false, recipients: [], articleCount: 0 };
    }

    const recipients = payload.to?.length ? payload.to : await this.notify.recipients();
    if (recipients.length === 0) {
      await this.notify.alert('邮件推送失败', '没有可用的收件人，请在管理后台添加收件人。');
      return { sent: false, recipients: [], articleCount: 0 };
    }

    const { start, end } = dayRange(target);
    const articles = await this.prisma.article.findMany({
      where: { publishTime: { gte: start, lt: end } },
      orderBy: { publishTime: 'desc' },
      take: settings.digest.maxArticles,
      include: { account: true },
    });

    if (articles.length === 0 && !payload.test) {
      await this.notify.alert(
        `今日没有抓取到文章（${target}）`,
        '今天所有账号都没有新增文章，可能是数据源失效或公众号确实未更新。建议到管理后台检查各账号的「最后成功抓取时间」。',
      );
      await this.prisma.sendLog.create({
        data: {
          date: dateOnly,
          subject: `【${target}】无新文章`,
          recipients: recipients.join(', '),
          status: 'skipped',
        },
      });
      return { sent: false, recipients, articleCount: 0 };
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
      summaryMarkdown: summary?.contentMd ?? null,
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

      this.logger.log(`已发送 ${target} 的日报到 ${recipients.join(', ')}（${messageId}）`);
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
