import { lookup } from 'node:dns/promises';
import { get as httpGet, type IncomingMessage } from 'node:http';
import { get as httpsGet } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { delay, WECHAT_MOBILE_UA, type HttpOptions } from './http';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;

class UnsafeImageError extends Error {}

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

/** 图片格式由字节签名决定；外部 URL 不能指定文件扩展名。SVG 不作为同源文件保存。 */
export function imageExtension(data: Buffer, contentType: string | null): '.png' | '.jpg' | '.gif' | '.webp' {
  let format: { extension: '.png' | '.jpg' | '.gif' | '.webp'; mime: string } | undefined;
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) format = { extension: '.png', mime: 'image/png' };
  else if (data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) format = { extension: '.jpg', mime: 'image/jpeg' };
  else if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii'))) format = { extension: '.gif', mime: 'image/gif' };
  else if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    format = { extension: '.webp', mime: 'image/webp' };
  }
  const mime = contentType?.split(';')[0].trim().toLowerCase();
  if (!format || (mime && mime !== 'application/octet-stream' && mime !== format.mime)) {
    throw new UnsafeImageError('响应不是受支持的图片，或 Content-Type 与文件内容不一致');
  }
  return format.extension;
}

async function openPublicImage(url: URL, signal: AbortSignal, options: HttpOptions): Promise<IncomingMessage> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new UnsafeImageError('图片仅允许不含凭据的 HTTP/HTTPS 地址');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new UnsafeImageError('图片地址不能指向内网或保留地址');
  }

  // 将校验过的解析结果直接交给实际连接，避免 DNS 二次解析/重绑定；不复用其他请求的连接。
  return new Promise((resolve, reject) => {
    const get = url.protocol === 'https:' ? httpsGet : httpGet;
    const request = get(url, {
      agent: false,
      signal,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      headers: { 'User-Agent': WECHAT_MOBILE_UA, Accept: 'image/png,image/jpeg,image/gif,image/webp', ...options.headers },
    }, resolve);
    request.on('error', reject);
  });
}

async function downloadImage(input: string, options: HttpOptions) {
  let url = new URL(input);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await openPublicImage(url, signal, options);
    const status = response.statusCode ?? 0;
    try {
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        if (redirects === MAX_REDIRECTS) throw new UnsafeImageError('图片重定向次数过多');
        url = new URL(response.headers.location, url);
        continue; // 每一跳都重新校验目标，并锁定实际连接 IP。
      }
      if (status < 200 || status >= 300) throw new Error(`图片下载 HTTP ${status}`);
      if (Number(response.headers['content-length']) > MAX_IMAGE_BYTES) throw new UnsafeImageError('图片超过 10 MB');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_IMAGE_BYTES) throw new UnsafeImageError('图片超过 10 MB');
        chunks.push(buffer);
      }
      const data = Buffer.concat(chunks);
      const contentType = response.headers['content-type'] ?? null;
      return { data, contentType, extension: imageExtension(data, contentType) };
    } finally {
      response.destroy();
    }
  }
  throw new UnsafeImageError('图片重定向次数过多');
}

export async function fetchImage(url: string, options: HttpOptions = {}) {
  const retries = options.retries ?? 1;
  for (let attempt = 0; ; attempt++) {
    try {
      return await downloadImage(url, options);
    } catch (error) {
      // 外部信号已取消时立即失败，不再退避重试
      if (options.signal?.aborted) throw error;
      if (error instanceof UnsafeImageError || attempt >= retries) throw error;
      await delay((options.retryDelayMs ?? 800) * 2 ** attempt);
    }
  }
}
