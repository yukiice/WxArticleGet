import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { renderAlertEmail, sendMail } from '@wx/email';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class NotifyService {
  private readonly logger = new Logger('Notify');
  /** 同一告警主题在窗口内只发一次，避免队列重试时重复打扰（如抓取连续重试失败）。 */
  private readonly recentAlerts = new Map<string, number>();
  private static readonly ALERT_DEDUPE_MS = 2 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /** 告警发送失败不应影响主流程，因此只记录日志 */
  async alert(subject: string, message: string): Promise<void> {
    try {
      const now = Date.now();
      const lastSent = this.recentAlerts.get(subject) ?? 0;
      if (now - lastSent < NotifyService.ALERT_DEDUPE_MS) {
        this.logger.log(`告警窗口内重复，跳过发送：${subject}`);
        return;
      }
      this.recentAlerts.set(subject, now);
      if (this.recentAlerts.size > 500) {
        for (const [key, sentAt] of this.recentAlerts) {
          if (now - sentAt >= NotifyService.ALERT_DEDUPE_MS) this.recentAlerts.delete(key);
        }
      }

      const smtp = (await this.settings.resolveAll()).smtp;
      if (!smtp.user || !smtp.pass) {
        this.logger.warn(`未配置 SMTP，跳过告警：${subject}`);
        return;
      }

      const recipients = await this.recipients();
      if (recipients.length === 0) {
        this.logger.warn(`没有收件人，跳过告警：${subject}`);
        return;
      }

      const rendered = renderAlertEmail(subject, message);
      await sendMail(smtp, { to: recipients, ...rendered });
      this.logger.log(`已发送告警邮件：${subject}`);
    } catch (error) {
      this.logger.error(`告警邮件发送失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async recipients(): Promise<string[]> {
    const rows = await this.prisma.emailRecipient.findMany({ where: { enabled: true } });
    if (rows.length > 0) return rows.map((row) => row.email);

    const fallback = this.config.get<string>('MAIL_TO');
    return fallback ? [fallback] : [];
  }
}
