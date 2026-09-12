import { XMLParser } from 'fast-xml-parser';
import type { RawArticle } from '@wx/shared';
import { fetchText } from '../http';
import { parseWechatArticleUrl } from '../url-utils';
import type { AccountSource, Provider, ProviderContext } from './types';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  cdataPropName: '#cdata',
});

export function resolveFeedUrl(account: AccountSource, context: ProviderContext): string | null {
  const config = (account.providerConfig ?? {}) as Record<string, unknown>;
  const explicit = typeof config.feedUrl === 'string' ? config.feedUrl : undefined;
  if (explicit) return explicit;

  const route = typeof config.route === 'string' ? config.route : undefined;
  if (route) {
    const base = (typeof config.baseUrl === 'string' ? config.baseUrl : undefined) ?? context.rsshubBaseUrl;
    if (!base) return null;
    return `${base.replace(/\/+$/, '')}/${route.replace(/^\/+/, '')}`;
  }

  return null;
}

export class RssProvider implements Provider {
  readonly type = 'rss';

  async fetchArticles(account: AccountSource, since: Date, context: ProviderContext): Promise<RawArticle[]> {
    const feedUrl = resolveFeedUrl(account, context);
    if (!feedUrl) {
      throw new Error(
        '未配置订阅地址：请在账号的数据源配置中填写 feedUrl，或填写 route / baseUrl（rsshub 类型）',
      );
    }

    const xml = await fetchText(feedUrl, context.fetchOptions);
    return parseFeed(xml, since);
  }
}

export function parseFeed(xml: string, since: Date): RawArticle[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const items = collectItems(doc);

  return items
    .map((item) => normalizeItem(item))
    .filter((article): article is RawArticle => article !== null)
    .filter((article) => !article.publishTime || article.publishTime.getTime() >= since.getTime())
    .sort((a, b) => (a.publishTime?.getTime() ?? 0) - (b.publishTime?.getTime() ?? 0));
}

function collectItems(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (channel?.item) return asArray(channel.item);

  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed?.entry) return asArray(feed.entry);

  if (Array.isArray(doc.items)) return asArray(doc.items);

  return [];
}

function normalizeItem(item: Record<string, unknown>): RawArticle | null {
  const url = extractLink(item);
  if (!url) return null;

  const title = textValue(item.title) ?? '无标题';
  const contentHtml = textValue(item['content:encoded']) ?? textValue(item.content);
  const publishTime = parseDate(
    textValue(item.pubDate) ?? textValue(item.published) ?? textValue(item.updated) ?? textValue(item.date),
  );

  const parts = parseWechatArticleUrl(url);
  const idxValue = parts?.idx ? Number(parts.idx) : undefined;

  return {
    title,
    url,
    coverUrl: extractImage(item),
    author: textValue(item.author) ?? textValue(item['dc:creator']),
    publishTime,
    digest: textValue(item.description),
    contentHtml,
    biz: parts?.biz,
    mid: parts?.mid,
    idx: Number.isFinite(idxValue) ? idxValue : undefined,
  };
}

function extractLink(item: Record<string, unknown>): string | null {
  const link = item.link;
  if (typeof link === 'string' && link.trim()) return link.trim();
  if (Array.isArray(link)) {
    for (const entry of link) {
      const value = extractLink({ link: entry });
      if (value) return value;
    }
  }
  if (link && typeof link === 'object') {
    const record = link as Record<string, unknown>;
    const rel = typeof record['@_rel'] === 'string' ? (record['@_rel'] as string) : undefined;
    const href = record['@_href'] ?? record['#text'];
    if (typeof href === 'string' && href.trim()) {
      if (rel && rel !== 'alternate') return null;
      return href.trim();
    }
  }
  return null;
}

function extractImage(item: Record<string, unknown>): string | undefined {
  const enclosure = item.enclosure as Record<string, unknown> | undefined;
  const enclosureUrl = enclosure?.['@_url'];
  if (typeof enclosureUrl === 'string') return enclosureUrl;

  const media = item['media:content'] as Record<string, unknown> | undefined;
  const mediaUrl = media?.['@_url'];
  if (typeof mediaUrl === 'string') return mediaUrl;

  const html = textValue(item['content:encoded']) ?? textValue(item.description);
  if (!html) return undefined;
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return match?.[1];
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function textValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return textValue(value[0]);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return textValue(record['#cdata'] ?? record['#text'] ?? record['@_href']);
  }
  return undefined;
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  if (value && typeof value === 'object') return [value as Record<string, unknown>];
  return [];
}
