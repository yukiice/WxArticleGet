import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { sendMail } from './transport';

const transporter = { sendMail: vi.fn(), close: vi.fn() } as unknown as ReturnType<typeof nodemailer.createTransport>;

const config = { host: 'smtp.163.com', port: 465, secure: true, user: 'a@x', pass: 'p', from: 'a@x' };
const message = { to: 'b@x', subject: 's', html: '<p>1</p>', text: '1' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(nodemailer as unknown as { createTransport: unknown }, 'createTransport' as never).mockReturnValue(transporter as never);
  (transporter.sendMail as unknown as vi.Mock).mockReset().mockResolvedValue({ messageId: 'mid-1' });
});
afterEach(() => vi.useRealTimers());

describe('sendMail 瞬时错误重试', () => {
  it('前两次 TLS 断开自动重连重试，第三次成功', async () => {
    (transporter.sendMail as unknown as vi.Mock)
      .mockRejectedValueOnce(new Error('Client network socket disconnected before secure TLS connection was established'))
      .mockRejectedValueOnce(new Error('Connection closed unexpectedly'));
    const promise = sendMail(config, message);
    await vi.advanceTimersByTimeAsync(3_000 + 6_000);
    await expect(promise).resolves.toBe('mid-1');
    expect(transporter.sendMail).toHaveBeenCalledTimes(3);
  });

  it('非瞬时错误（如鉴权失败）立即抛出不重试', async () => {
    (transporter.sendMail as unknown as vi.Mock).mockRejectedValueOnce(Object.assign(new Error('Invalid login'), { code: 'EAUTH' }));
    await expect(sendMail(config, message)).rejects.toThrow('Invalid login');
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
  });
});
