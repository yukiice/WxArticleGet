import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { renderDigestEmail, sendMail, type DigestArticle } from '@wx/email';
import {
  dateKey,
  dayRange,
  resolveDailyWindow,
  type Paginated,
  type RecipientCreateInput,
  type SendLogDto,
} from '@wx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
    private readonly config: ConfigService,
  ) {}

  listRecipients() {
    return this.prisma.emailRecipient.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async createRecipient(input: RecipientCreateInput) {
    return this.prisma.emailRecipient.upsert({
      where: { email: input.email },
      create: { email: input.email, name: input.name ?? null, enabled: true },
      update: { name: input.name ?? null, enabled: true },
    });
  }

  async removeRecipient(id: string): Promise<{ ok: boolean }> {
    await this.prisma.emailRecipient.delete({ where: { id } });
    return { ok: true };
  }

  async activeRecipients(): Promise<string[]> {
    const recipients = await this.prisma.emailRecipient.findMany({ where: { enabled: true } });
    if (recipients.length > 0) return recipients.map((item) => item.email);

    const fallback = this.config.get<string>('MAIL_TO');
    return fallback ? [fallback] : [];
  }

  async sendTest(to?: string): Promise<{ sent: boolean; to: string[] }> {
    const smtp = await this.settings.resolveSmtp();
    if (!smtp.user || !smtp.pass) {
      throw new Error('尚未配置 SMTP 账号或授权码');
    }

    const recipients = to ? [to] : await this.activeRecipients();
    if (recipients.length === 0) throw new Error('没有可用的收件人，请先添加收件人或配置 MAIL_TO');

    const appBaseUrl = this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:3000';
    const { start, end } = dayRange(dateKey());
    const articles = await this.prisma.article.findMany({
      where: { publishTime: { gte: start, lt: end } },
      orderBy: { publishTime: 'desc' },
      take: 5,
      include: { account: true },
    });

    const digestArticles: DigestArticle[] = articles.length
      ? articles.map((article) => ({
          title: article.title,
          url: article.url,
          accountName: article.account.name,
          publishTime: article.publishTime.toISOString(),
          digest: article.digest,
          coverUrl: article.coverLocal ? `${appBaseUrl}${article.coverLocal}` : article.coverUrl,
        }))
      : [
          {
            title: '这是一封测试邮件',
            url: appBaseUrl,
            accountName: '系统',
            publishTime: new Date().toISOString(),
            digest: '收到这封邮件说明 SMTP 配置可用。正式推送将在每天设定的时间发送当日文章。',
            coverUrl: null,
          },
        ];

    const rendered = renderDigestEmail({
      date: `${dateKey()}（测试）`,
      summaryMarkdown: null,
      articles: digestArticles,
      siteUrl: appBaseUrl,
    });

    const messageId = await sendMail(smtp, {
      to: recipients,
      subject: `[测试] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
    });

    this.logger.log(`测试邮件已发送 ${recipients.join(', ')} (${messageId})`);
    return { sent: true, to: recipients };
  }

  async sendNow(date?: string): Promise<{ queued: boolean }> {
    const target = date ?? dateKey();
    const { from, to } = await this.resolveWindow(target);
    await this.queue.enqueue(
      'send-digest',
      { date: target, windowFrom: from.toISOString(), windowTo: to.toISOString() },
      { singletonKey: `digest-${Date.now()}` },
    );
    return { queued: true };
  }

  /** 与自动链路口径一致：截止点取该日 24:00，起点接上次成功产出日报的时刻（无则回退 24 小时） */
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

  async logs(page: number, pageSize: number): Promise<Paginated<SendLogDto>> {
    const [total, items] = await Promise.all([
      this.prisma.sendLog.count(),
      this.prisma.sendLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map((log) => ({
        id: log.id,
        subject: log.subject,
        recipients: log.recipients,
        status: log.status,
        error: log.error,
        sentAt: log.sentAt?.toISOString() ?? null,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }
}

