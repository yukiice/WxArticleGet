import nodemailer, { type Transporter } from 'nodemailer';

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface MailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

export function createTransport(config: MailConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

/** SMTP 瞬时错误（尤其 163 的 TLS 握手中断），值得重连重试一次；日报不是投递语义，重试无重复投递风险。 */
const SEND_ATTEMPTS = 3;
const TRANSIENT_PATTERNS = /Connection closed unexpectedly|TLS|socket|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientSmtpError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code ?? '';
  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'].includes(code) || TRANSIENT_PATTERNS.test(error.message);
}

export async function sendMail(config: MailConfig, message: MailMessage): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt += 1) {
    const transport = createTransport(config);
    try {
      const recipients = Array.isArray(message.to) ? message.to.join(', ') : message.to;
      const info = await transport.sendMail({
        from: config.from,
        to: recipients,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      return info.messageId ?? '';
    } catch (error) {
      lastError = error;
      // 前次尝试未送达即可安全重试；非瞬时错误（如鉴权失败）直接抛出
      if (attempt < SEND_ATTEMPTS - 1 && isTransientSmtpError(error)) {
        await sleep(3_000 * 2 ** attempt);
        continue;
      }
      throw error;
    } finally {
      transport.close();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function verifyTransport(config: MailConfig): Promise<void> {
  const transport = createTransport(config);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

