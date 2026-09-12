import { setTimeout as delay } from 'node:timers/promises';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@wx/db';
import type { JobPayloads, ParsedArticle, RawArticle, ResolvedSettings } from '@wx/shared';
import {
  ArticleUnavailableError,
  countWords,
  extractImages,
  fetchArticle,
  fetchArticlesForAccount,
  hashString,
  hashUrl,
  htmlToPlainText,
  isWechatArticleUrl,
  sanitizeContentHtml,
  type AccountSource,
  type ProviderContext,
} from '@wx/wechat';
import type { Account } from '@wx/db';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LocalizeService } from './localize.service';
import { NotifyService } from './notify.service';

export interface FetchAccountResult {
  newCount: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger('Ingest');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly localize: LocalizeService,
    private readonly notify: NotifyService,
  ) {}

  buildContext(settings: ResolvedSettings): ProviderContext {
    return {
      searchEndpoint: settings.fetch.searchEndpoint,
      rsshubBaseUrl: settings.fetch.rsshubBaseUrl,
      requestDelayMs: settings.fetch.requestDelayMs,
      fetchOptions: { timeoutMs: 25_000, retries: 2 },
    };
  }

  async fetchAccount(payload: JobPayloads['fetch-account']): Promise<FetchAccountResult> {
    const account = await this.prisma.account.findUnique({ where: { id: payload.accountId } });
    if (!account) throw new Error(`账号不存在：${payload.accountId}`);

    const settings = await this.settings.resolveAll();
    const context = this.buildContext(settings);
    const jobLog = await this.prisma.jobLog.create({
      data: { type: 'fetch', accountId: account.id, status: 'running', startedAt: new Date() },
    });

    const sinceDays = payload.sinceDays ?? settings.fetch.lookbackDays;
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    try {
      const candidates = await this.collectCandidates(account, payload, since, settings, context);

      let newCount = 0;
      let skipped = 0;
      let failed = 0;

      for (const item of candidates) {
        try {
          const created = await this.ingestOne(account, item, context, settings);
          if (created) newCount += 1;
          else skipped += 1;
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof ArticleUnavailableError) {
            this.logger.warn(`文章不可用 ${item.url}: ${message}`);
          } else {
            this.logger.error(`文章处理失败 ${item.url}: ${message}`);
          }
        }

        if (settings.fetch.requestDelayMs > 0) {
          await delay(settings.fetch.requestDelayMs);
        }
      }

      const now = new Date();
      await this.prisma.account.update({
        where: { id: account.id },
        data: { lastFetchAt: now, lastSuccessAt: now, status: 'active' },
      });
      await this.prisma.jobLog.update({
        where: { id: jobLog.id },
        data: {
          status: 'success',
          newCount,
          finishedAt: now,
          error: failed > 0 ? `${failed} 篇处理失败` : null,
        },
      });

      if (newCount === 0 && !payload.manual) {
        this.logger.log(`账号 ${account.name} 本次没有新文章`);
      }

      return { newCount, skipped, failed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.jobLog.update({
        where: { id: jobLog.id },
        data: { status: 'failed', finishedAt: new Date(), error: message },
      });
      await this.prisma.account.update({
        where: { id: account.id },
        data: { status: 'error', lastFetchAt: new Date() },
      });
      await this.notify.alert(
        `抓取失败：${account.name}`,
        `公众号「${account.name}」抓取失败。\n\n原因：${message}\n\n可到管理后台手动触发重试，或粘贴文章链接手动导入。`,
      );
      throw error;
    }
  }

  private async collectCandidates(
    account: Account,
    payload: JobPayloads['fetch-account'],
    since: Date,
    settings: ResolvedSettings,
    context: ProviderContext,
  ): Promise<RawArticle[]> {
    if (payload.urls?.length) {
      return payload.urls.map((url) => ({ title: '', url }));
    }

    const source: AccountSource = {
      id: account.id,
      name: account.name,
      biz: account.biz,
      providerType: account.providerType,
      providerConfig: (account.providerConfig as Record<string, unknown> | null) ?? null,
    };

    const articles = await fetchArticlesForAccount(source, since, context);
    const limit = settings.fetch.dailyLimitPerAccount;
    return articles.length > limit ? articles.slice(-limit) : articles;
  }

  private async ingestOne(
    account: Account,
    raw: RawArticle,
    context: ProviderContext,
    settings: ResolvedSettings,
  ): Promise<boolean> {
    const urlHash = hashUrl(raw.url);
    const existing = await this.prisma.article.findUnique({ where: { urlHash }, select: { id: true } });
    if (existing) return false;

    const parsed = await this.parseContent(raw, context);
    const biz = parsed.biz ?? raw.biz ?? account.biz;
    const mid = parsed.mid ?? raw.mid ?? urlHash.slice(0, 16);
    const idx = parsed.idx ?? raw.idx ?? 0;
    const publishTime = parsed.publishTime ?? raw.publishTime ?? new Date();

    let articleId: string;
    try {
      const article = await this.prisma.article.create({
        data: {
          accountId: account.id,
          biz,
          mid,
          idx,
          title: parsed.title || raw.title || '无标题',
          author: parsed.author ?? raw.author ?? null,
          publishTime,
          url: raw.url,
          urlHash,
          coverUrl: parsed.coverUrl ?? raw.coverUrl ?? null,
          contentHtml: parsed.contentHtml,
          contentText: parsed.contentText,
          digest: buildDigest(raw.digest, parsed.contentText),
          wordCount: parsed.wordCount || countWords(parsed.contentText),
          processed: false,
        },
        select: { id: true },
      });
      articleId = article.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }

    const localized = await this.localize.localizeImages(articleId, parsed.contentHtml, parsed.images);
    const coverLocal = parsed.coverUrl ? await this.localize.localizeCover(articleId, parsed.coverUrl) : null;

    await this.prisma.article.update({
      where: { id: articleId },
      data: { contentHtml: localized.contentHtml, coverLocal, processed: true },
    });

    const dimensions = new Map(parsed.images.map((image) => [image.originalUrl, image]));
    if (localized.files.length > 0) {
      await this.prisma.articleImage.createMany({
        data: localized.files.map((file) => ({
          articleId,
          originalUrl: file.originalUrl,
          // MySQL 无法给 TEXT 建唯一索引，去重用 sha256
          originalUrlHash: hashString(file.originalUrl),
          localPath: file.localPath,
          width: dimensions.get(file.originalUrl)?.width ?? null,
          height: dimensions.get(file.originalUrl)?.height ?? null,
        })),
        skipDuplicates: true,
      });
    }

    if (localized.failed > 0) {
      this.logger.warn(`文章 ${parsed.title} 有 ${localized.failed} 张图片未能本地化，将回退到原始地址`);
    }

    this.logger.log(`已入库：${parsed.title}`);
    return true;
  }

  private async parseContent(raw: RawArticle, context: ProviderContext): Promise<ParsedArticle> {
    if (raw.contentHtml && !isWechatArticleUrl(raw.url)) {
      return buildFromFeedContent(raw);
    }

    try {
      const fetched = await fetchArticle(raw.url, context);
      return {
        ...fetched.parsed,
        title: fetched.parsed.title || raw.title,
        coverUrl: fetched.parsed.coverUrl ?? raw.coverUrl,
        publishTime: fetched.parsed.publishTime ?? raw.publishTime,
      };
    } catch (error) {
      // 部分公众号对非微信客户端环境只返回空壳页（无 #js_content），
      // 此时若订阅源（如 RSS/RSSHub）已带全文，则回退使用，避免整篇丢失。
      if (raw.contentHtml && error instanceof ArticleUnavailableError) {
        this.logger.warn(`原文不可用（${error.reason}），回退使用订阅源内容：${raw.url}`);
        return buildFromFeedContent(raw);
      }
      throw error;
    }
  }

  /** 重新本地化文章图片（图片下载失败或更换存储位置时使用） */
  async reprocess(articleId: string): Promise<{ images: number; failed: number }> {
    const article = await this.prisma.article.findUnique({ where: { id: articleId } });
    if (!article) throw new Error(`文章不存在：${articleId}`);

    const images = extractImages(article.contentHtml);
    const localized = await this.localize.localizeImages(article.id, article.contentHtml, images);
    const coverLocal = article.coverUrl ? await this.localize.localizeCover(article.id, article.coverUrl) : null;

    await this.prisma.article.update({
      where: { id: article.id },
      data: {
        contentHtml: localized.contentHtml,
        coverLocal: coverLocal ?? article.coverLocal,
        processed: true,
      },
    });

    return { images: localized.succeeded, failed: localized.failed };
  }
}

function buildDigest(rawDigest: string | undefined, contentText: string): string | null {
  const source = rawDigest ? htmlToPlainText(sanitizeContentHtml(rawDigest)) : contentText;
  const normalized = source.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > 120 ? `${normalized.slice(0, 120)}…` : normalized;
}

/** 第三方 RSS 常见做法：图片经其代理转发（且代理地址会过期/403）；这里还原成原始地址 */
function restoreProxyUrl(url: string): string {
  const decoded = url.replace(/&amp;/g, '&');
  const marker = decoded.indexOf('/img-proxy/');
  if (marker === -1) return url;

  const uIndex = decoded.indexOf('u=', marker);
  if (uIndex === -1) return url;

  try {
    const original = decodeURIComponent(decoded.slice(uIndex + 2));
    return original.startsWith('http') ? original : url;
  } catch {
    return url;
  }
}

function restoreProxiedImages(html: string): string {
  return html.replace(/<img([^>]*?)src="([^"]*\/img-proxy\/[^"]*)"/gi, (match, attrs: string, src: string) => {
    const restored = restoreProxyUrl(src);
    return restored === src ? match : `<img${attrs}src="${restored}"`;
  });
}

function buildFromFeedContent(raw: RawArticle): ParsedArticle {
  const contentHtml = sanitizeContentHtml(restoreProxiedImages(raw.contentHtml ?? ''));
  const contentText = htmlToPlainText(contentHtml);
  return {
    title: raw.title,
    author: raw.author,
    biz: raw.biz,
    mid: raw.mid,
    idx: raw.idx,
    publishTime: raw.publishTime,
    coverUrl: raw.coverUrl ? restoreProxyUrl(raw.coverUrl) : undefined,
    contentHtml,
    contentText,
    images: extractImages(contentHtml),
    wordCount: countWords(contentText),
  };
}
