import * as cheerio from 'cheerio';
import type { ParsedArticle } from '@wx/shared';
import { ArticleUnavailableError } from './errors';
import { countWords, extractImages, htmlToPlainText, sanitizeContentHtml } from './sanitize';

const UNAVAILABLE_MARKERS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /该内容已被发布者删除|内容已被发布者删除/, reason: 'deleted' },
  { pattern: /此内容因违规无法查看|该内容已被屏蔽/, reason: 'blocked' },
  { pattern: /此内容发送失败无法查看|该内容已被发布者撤回/, reason: 'revoked' },
  { pattern: /参数错误|参数不正确/, reason: 'invalid' },
  { pattern: /环境异常|去验证/, reason: 'verify' },
  { pattern: /该公众号已迁移|文章已迁移/, reason: 'migrated' },
];

export function parseArticleHtml(html: string, url: string): ParsedArticle {
  const $ = cheerio.load(html);
  const rawText = $.root().text();

  const contentHtmlRaw = $('#js_content').html();
  if (!contentHtmlRaw || !contentHtmlRaw.trim()) {
    for (const marker of UNAVAILABLE_MARKERS) {
      if (marker.pattern.test(rawText) || marker.pattern.test(html)) {
        throw new ArticleUnavailableError(`文章不可访问：${marker.reason}`, marker.reason);
      }
    }
    throw new ArticleUnavailableError('未找到正文内容 #js_content', 'no-content');
  }

  const contentHtml = sanitizeContentHtml(contentHtmlRaw);
  const contentText = htmlToPlainText(contentHtml);

  const title =
    decodeEntities(extractStringVariable(html, 'msg_title')) ??
    textOf($('#activity-name').text()) ??
    textOf($('meta[property="og:title"]').attr('content') ?? '') ??
    textOf($('title').text()) ??
    '无标题';

  const accountName = decodeEntities(extractStringVariable(html, 'nickname')) ?? textOf($('#js_name').text());
  const author =
    textOf($('#js_author_name').text()) ??
    decodeEntities(extractStringVariable(html, 'author')) ??
    accountName;

  const publishTime = resolvePublishTime(html, $);
  const coverUrl =
    decodeEntities(extractStringVariable(html, 'msg_cdn_url')) ??
    $('meta[property="og:image"]').attr('content') ??
    undefined;

  const biz = extractStringVariable(html, 'biz') ?? parseUrlParam(url, '__biz');
  const mid = extractStringVariable(html, 'mid') ?? parseUrlParam(url, 'mid');
  const idxRaw = extractStringVariable(html, 'idx') ?? parseUrlParam(url, 'idx');
  const idx = idxRaw ? Number(idxRaw) : undefined;

  return {
    title,
    author: author ?? undefined,
    accountName: accountName ?? undefined,
    biz: biz ?? undefined,
    mid: mid ?? undefined,
    idx: Number.isFinite(idx) ? idx : undefined,
    publishTime,
    coverUrl,
    contentHtml,
    contentText,
    images: extractImages(contentHtml),
    wordCount: countWords(contentText),
  };
}

function resolvePublishTime(html: string, $: cheerio.CheerioAPI): Date | undefined {
  const unixSeconds = extractStringVariable(html, 'ct') ?? extractStringVariable(html, 'create_time');
  if (unixSeconds && /^\d{9,11}$/.test(unixSeconds)) {
    return new Date(Number(unixSeconds) * 1000);
  }

  const raw =
    textOf($('#publish_time').text()) ??
    textOf($('em#publish_time').text()) ??
    textOf($('meta[property="article:published_time"]').attr('content') ?? '');
  if (!raw) return undefined;

  const match = /(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})[日]?\s*(\d{1,2})?:?(\d{2})?/.exec(raw);
  if (!match) return undefined;

  const [, year, month, day, hour = '0', minute = '0'] = match;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00+08:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function textOf(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : undefined;
}

function decodeEntities(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const decoded = cheerio.load(`<div id="__d__">${value}</div>`, null, false)('#__d__').text();
  return textOf(decoded);
}

export function extractStringVariable(html: string, name: string): string | undefined {
  const patterns = [
    new RegExp(`(?:var\\s+|window\\.)${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`),
    new RegExp(`(?:var\\s+|window\\.)${name}\\s*=\\s*'((?:[^'\\\\]|\\\\.)*)'`),
    new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`),
    new RegExp(`(?:var\\s+|window\\.)${name}\\s*=\\s*(\\d{6,})`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return unescapeJsString(match[1]);
  }
  return undefined;
}

function unescapeJsString(value: string): string {
  return value
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function parseUrlParam(url: string, key: string): string | undefined {
  try {
    return new URL(url).searchParams.get(key) ?? undefined;
  } catch {
    return undefined;
  }
}
