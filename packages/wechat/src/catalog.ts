import { XMLParser } from 'fast-xml-parser';
import { DESKTOP_UA, fetchText } from './http';
import { fetchArticle } from './providers/lookup';
import { parseFeed } from './providers/rss';
import type { ProviderContext } from './providers/types';
import { parseWechatArticleUrl } from './url-utils';

export interface CatalogEntry {
  name: string;
  feedUrl: string;
  source: string;
}

export interface CatalogSourceResult {
  source: string;
  count: number;
  error?: string;
}

export interface CatalogCollectResult {
  entries: CatalogEntry[];
  sources: CatalogSourceResult[];
}

export interface ResolvedFeedAccount {
  biz: string;
  name?: string;
  sampleTitle?: string;
  sampleUrl: string;
}

/** 免费公开的公众号 RSS 目录来源；页面结构如有变化，解析函数会返回 0 条并在同步结果里报错 */
export const CATALOG_SOURCES = [
  { source: 'decemberpei', pageUrl: 'https://decemberpei.cyou/wechatrss' },
  { source: 'wechat2rss', pageUrl: 'https://wechat2rss.xlab.app/list/all.html' },
] as const;

export type CatalogSourceId = (typeof CATALOG_SOURCES)[number]['source'];

const DECEMBERPEI_ITEM = /微信公众号-([^:：<>]{1,40}?)\s*[:：]\s*(https?:\/\/[^\s<>"']+?\.xml)/g;
const WECHAT2RSS_ITEM = /<a[^>]+href="([^"]*\/feed\/[0-9a-f]{40}\.xml)"[^>]*>([^<]{1,60})<\/a>/g;

export function parseDecemberpeiCatalog(html: string): CatalogEntry[] {
  return collectMatches(html.matchAll(DECEMBERPEI_ITEM), 'decemberpei');
}

export function parseWechat2rssCatalog(html: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const match of html.matchAll(WECHAT2RSS_ITEM)) {
    const feedUrl = match[1]?.trim();
    const name = cleanAccountName(match[2] ?? '');
    if (feedUrl && name) entries.push({ name, feedUrl, source: 'wechat2rss' });
  }
  return entries;
}

export function parseCatalogPage(source: string, html: string): CatalogEntry[] {
  switch (source) {
    case 'decemberpei':
      return parseDecemberpeiCatalog(html);
    case 'wechat2rss':
      return parseWechat2rssCatalog(html);
    default:
      return [];
  }
}

/** 抓取全部目录来源并合并去重（单个来源失败不影响其他来源） */
export async function collectCatalogEntries(context: ProviderContext = {}): Promise<CatalogCollectResult> {
  const results = await Promise.all(
    CATALOG_SOURCES.map(async (source) => {
      try {
        const html = await fetchText(source.pageUrl, {
          ...context.fetchOptions,
          userAgent: DESKTOP_UA,
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            ...context.fetchOptions?.headers,
          },
        });
        const entries = parseCatalogPage(source.source, html);
        if (entries.length === 0) {
          throw new Error('页面结构可能已变化，未解析到任何条目');
        }
        return { source: source.source, entries, error: undefined as string | undefined };
      } catch (error) {
        return {
          source: source.source,
          entries: [] as CatalogEntry[],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const byUrl = new Map<string, CatalogEntry>();
  for (const result of results) {
    for (const entry of result.entries) {
      if (!byUrl.has(entry.feedUrl)) byUrl.set(entry.feedUrl, entry);
    }
  }

  return {
    entries: [...byUrl.values()],
    sources: results.map((result) => ({
      source: result.source,
      count: result.entries.length,
      ...(result.error ? { error: result.error } : {}),
    })),
  };
}

/** 从订阅源反解公众号标识（__biz）：取前几篇文章逐篇解析，兼容短链 */
export async function resolveAccountFromFeed(
  feedUrl: string,
  context: ProviderContext = {},
): Promise<ResolvedFeedAccount> {
  const xml = await fetchText(feedUrl, {
    ...context.fetchOptions,
    userAgent: DESKTOP_UA,
    headers: {
      Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*',
      ...context.fetchOptions?.headers,
    },
  });

  const feedTitle = cleanAccountName(readFeedTitle(xml) ?? '');
  const items = parseFeed(xml, new Date(0));
  if (items.length === 0) {
    throw new Error('订阅源中没有可用文章，无法解析公众号标识');
  }

  let lastError: unknown;
  for (const item of items.slice(0, 3)) {
    try {
      const { parsed } = await fetchArticle(item.url, context);
      const biz = parsed.biz ?? parseWechatArticleUrl(item.url)?.biz;
      if (biz) {
        return {
          biz,
          name: cleanAccountName(parsed.accountName ?? '') || feedTitle || undefined,
          sampleTitle: item.title,
          sampleUrl: item.url,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? `：${lastError.message}` : '';
  throw new Error(`未能从订阅源解析出公众号标识（__biz）${suffix}`);
}

function collectMatches(matches: Iterable<RegExpMatchArray>, source: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const match of matches) {
    const name = cleanAccountName(match[1] ?? '');
    const feedUrl = match[2]?.trim();
    if (name && feedUrl) entries.push({ name, feedUrl, source });
  }
  return entries;
}

export function cleanAccountName(raw: string): string {
  return raw
    .replace(/^\s*微信公众号\s*[-—–:：]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readFeedTitle(xml: string): string | undefined {
  const parser = new XMLParser({ ignoreAttributes: true, trimValues: true, cdataPropName: '#cdata' });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  const atom = doc.feed as Record<string, unknown> | undefined;

  return pickText(channel?.title) ?? pickText(atom?.title);
}

function pickText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const nested = pickText(record['#cdata']) ?? pickText(record['#text']);
    if (nested) return nested;
  }
  return undefined;
}
