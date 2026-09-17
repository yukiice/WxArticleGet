import { setTimeout as delay } from 'node:timers/promises';

export const WECHAT_MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003127) NetType/WIFI Language/zh_CN';

export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface HttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  userAgent?: string;
  /** 外部取消信号（如任务超时），与单次请求超时一并生效 */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT = 20_000;
const DEFAULT_RETRIES = 2;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function request(url: string, options: HttpOptions): Promise<Response> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': options.userAgent ?? WECHAT_MOBILE_UA,
          'Accept-Language': 'zh-CN,zh;q=0.9',
          ...options.headers,
        },
        redirect: 'follow',
        signal: options.signal
          ? AbortSignal.any([AbortSignal.timeout(timeoutMs), options.signal])
          : AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < retries) {
          await delay(backoffMs(attempt, options.retryDelayMs));
          continue;
        }
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(backoffMs(attempt, options.retryDelayMs));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function backoffMs(attempt: number, base?: number): number {
  const baseMs = base ?? 800;
  const exponential = baseMs * 2 ** attempt;
  return exponential + Math.floor(Math.random() * 400);
}

export async function fetchText(url: string, options: HttpOptions = {}): Promise<string> {
  const response = await request(url, options);
  const buffer = Buffer.from(await response.arrayBuffer());
  return decodeBody(buffer, response.headers.get('content-type') ?? '');
}

/** 微信页面存在 GBK 编码的历史页面，此处做一次宽松解码 */
function decodeBody(buffer: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
  if (charset && charset !== 'utf-8' && charset !== 'utf8') {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      return buffer.toString('utf8');
    }
  }
  return buffer.toString('utf8');
}

export { delay };

