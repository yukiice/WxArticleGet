import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchImage, imageExtension } from './image';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:http', () => ({ get: vi.fn() }));
vi.mock('node:https', () => ({ get: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=', 'base64');

describe('不可信图片下载', () => {
  it.each(['127.0.0.1', '0x7f000001', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '[::1]', '[::ffff:127.0.0.1]', '[fc00::1]'])('拒绝内网和保留 IP %s', async (host) => {
    await expect(fetchImage(`http://${host}/image`, { retries: 0 })).rejects.toThrow('内网或保留地址');
  });

  it('拒绝 DNS 解析到私网的域名', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as never);
    await expect(fetchImage('https://images.example/image', { retries: 0 })).rejects.toThrow('内网或保留地址');
    expect(get).not.toHaveBeenCalled();
  });

  it('将已校验的 DNS 结果固定到连接，不再次解析，并按字节决定扩展名', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as never);
    vi.mocked(get).mockImplementation(((_url: unknown, options: any, callback: any) => {
      const resolved = vi.fn();
      options.lookup('images.example', { all: true }, resolved);
      expect(resolved).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
      expect(options.agent).toBe(false);
      const response = Object.assign(Readable.from([png]), { statusCode: 200, headers: { 'content-type': 'image/png' } });
      queueMicrotask(() => callback(response));
      return new EventEmitter();
    }) as never);
    const result = await fetchImage('https://images.example/image?wx_fmt=html');
    expect(result.extension).toBe('.png');
    expect(result.data).toEqual(png);
    expect(lookup).toHaveBeenCalledOnce();
  });

  it('拒绝公网图片响应重定向到私网，且不连接第二跳', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    vi.mocked(get).mockImplementation(((_url: unknown, _options: unknown, callback: any) => {
      const response = Object.assign(Readable.from([]), { statusCode: 302, headers: { location: 'http://127.0.0.1/private' } });
      queueMicrotask(() => callback(response));
      return new EventEmitter();
    }) as never);
    await expect(fetchImage('https://images.example/image')).rejects.toThrow('内网或保留地址');
    expect(get).toHaveBeenCalledOnce();
  });

  it('拒绝伪装成图片的 HTML、SVG 和不匹配的响应类型', () => {
    expect(() => imageExtension(Buffer.from('<script>alert(1)</script>'), 'image/png')).toThrow();
    expect(() => imageExtension(Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml')).toThrow();
    expect(() => imageExtension(png, 'text/html')).toThrow();
  });
});
