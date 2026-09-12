import type { AccountCandidate, ParsedArticle } from '@wx/shared';
import { ArticleUnavailableError } from '../errors';
import { DESKTOP_UA, fetchText } from '../http';
import { parseArticleHtml } from '../parse-article';
import { isWechatArticleUrl, looksLikeUrl, parseWechatArticleUrl } from '../url-utils';
import type { FetchedArticle, ProviderContext } from './types';

/** 抓取并解析一篇公众号文章，遇到风控页自动降级桌面 UA 重试一次 */
export async function fetchArticle(url: string, context: ProviderContext = {}): Promise<FetchedArticle> {
  if (!isWechatArticleUrl(url)) {
    throw new Error(`不是合法的公众号文章链接：${url}`);
  }

  try {
    const html = await fetchText(url, context.fetchOptions);
    return { parsed: parseArticleHtml(html, url), finalUrl: url };
  } catch (error) {
    if (error instanceof ArticleUnavailableError && (error.reason === 'verify' || error.reason === 'invalid')) {
      const html = await fetchText(url, { ...context.fetchOptions, userAgent: DESKTOP_UA });
      return { parsed: parseArticleHtml(html, url), finalUrl: url };
    }
    throw error;
  }
}

/** 通过任意一篇文章链接反查公众号信息（免费兜底路径，必须保持可用） */
export async function resolveAccountByArticleUrl(
  url: string,
  context: ProviderContext = {},
): Promise<AccountCandidate> {
  const { parsed } = await fetchArticle(url, context);
  const parts = parseWechatArticleUrl(url);
  const biz = parsed.biz ?? parts?.biz;

  if (!biz) {
    throw new Error('未能从文章中解析出公众号标识（__biz），请换一篇该号的文章链接重试');
  }

  return {
    name: parsed.accountName ?? `公众号 ${biz.slice(0, 8)}`,
    biz,
    avatarUrl: undefined,
    intro: parsed.title ? `最近文章：${parsed.title}` : undefined,
    source: 'article-url',
    providerType: 'manual',
    providerConfig: {},
  };
}

/**
 * 按名称或链接查找公众号。
 * 名称搜索依赖自建搜索服务（searchEndpoint）；未配置时返回空列表，由前端引导用户粘贴文章链接。
 */
export async function lookupAccountCandidates(
  keyword: string,
  context: ProviderContext = {},
): Promise<AccountCandidate[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];

  if (looksLikeUrl(trimmed)) {
    const candidate = await resolveAccountByArticleUrl(trimmed, context);
    return [candidate];
  }

  if (!context.searchEndpoint) return [];

  const separator = context.searchEndpoint.includes('?') ? '&' : '?';
  const endpoint = `${context.searchEndpoint}${separator}keyword=${encodeURIComponent(trimmed)}`;
  const raw = await fetchText(endpoint, {
    ...context.fetchOptions,
    headers: { Accept: 'application/json', ...context.fetchOptions?.headers },
  });

  return normalizeSearchResponse(raw);
}

function normalizeSearchResponse(raw: string): AccountCandidate[] {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return [];
  }

  const list = extractList(payload);
  return list
    .map((item) => normalizeCandidate(item))
    .filter((item): item is AccountCandidate => item !== null);
}

function extractList(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['items', 'data', 'list', 'results', 'accounts']) {
      const value = record[key];
      if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
      if (value && typeof value === 'object') {
        const nested = extractList(value);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

function normalizeCandidate(item: Record<string, unknown>): AccountCandidate | null {
  const biz = pickString(item, ['biz', '__biz', 'bizId', 'biz_id']);
  if (!biz) return null;

  const name = pickString(item, ['name', 'nickname', 'title', 'account_name', 'accountName']) ?? `公众号 ${biz.slice(0, 8)}`;

  return {
    name,
    biz,
    avatarUrl: pickString(item, ['avatarUrl', 'avatar', 'headimg', 'round_head_img', 'roundHeadImg']),
    intro: pickString(item, ['intro', 'description', 'desc', 'signature']),
    source: 'search',
    providerType: 'manual',
    providerConfig: {},
  };
}

function pickString(item: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}
