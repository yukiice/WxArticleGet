import { createHash } from 'node:crypto';

export interface ArticleUrlParts {
  biz?: string;
  mid?: string;
  idx?: string;
  sn?: string;
  canonical: string;
}

export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function isWechatArticleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === 'mp.weixin.qq.com' && (url.pathname === '/s' || url.pathname.startsWith('/s/'));
  } catch {
    return false;
  }
}

export function parseWechatArticleUrl(input: string): ArticleUrlParts | null {
  const trimmed = input.trim();
  if (!isWechatArticleUrl(trimmed)) return null;

  const url = new URL(trimmed);
  const biz = url.searchParams.get('__biz') ?? undefined;
  const mid = url.searchParams.get('mid') ?? undefined;
  const idx = url.searchParams.get('idx') ?? undefined;
  const sn = url.searchParams.get('sn') ?? undefined;

  return { biz, mid, idx, sn, canonical: url.toString() };
}

/** 归一化文章链接：去掉追踪参数，保留文章标识所需的参数 */
export function normalizeArticleUrl(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const keep = ['__biz', 'mid', 'idx', 'sn', 'chksm', 'scene', 'srcid'];
    const params = new URLSearchParams();
    for (const key of keep) {
      const value = url.searchParams.get(key);
      if (value !== null) params.set(key, value);
    }
    url.search = params.toString();
    url.hash = '';
    return url.toString();
  } catch {
    return trimmed;
  }
}

export function hashUrl(input: string): string {
  return createHash('sha256').update(normalizeArticleUrl(input)).digest('hex');
}

export function hashString(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

