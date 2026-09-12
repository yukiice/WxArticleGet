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

export async function sendMail(config: MailConfig, message: MailMessage): Promise<string> {
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
  } finally {
    transport.close();
  }
}

export async function verifyTransport(config: MailConfig): Promise<void> {
  const transport = createTransport(config);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

