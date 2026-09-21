import { Injectable, Logger } from '@nestjs/common';
import { collectCatalogEntries, type CatalogSourceResult } from '@wx/wechat';
import { PrismaService } from '../prisma/prisma.service';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const UPSERT_CHUNK_SIZE = 20;

export interface CatalogSyncResult {
  total: number;
  removed: number;
  sources: CatalogSourceResult[];
}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger('Catalog');

  constructor(private readonly prisma: PrismaService) {}

  /** 抓取免费 RSS 目录并写入 feed_catalog；按来源清理已下线条目 */
  async sync(): Promise<CatalogSyncResult> {
    const seenAt = new Date();
    const { entries, sources } = await collectCatalogEntries({
      fetchOptions: { timeoutMs: 30_000, retries: 2 },
    });

    if (entries.length === 0) {
      this.logger.warn('所有目录来源均抓取失败，跳过本次同步');
      return { total: 0, removed: 0, sources };
    }

    for (let index = 0; index < entries.length; index += UPSERT_CHUNK_SIZE) {
      const chunk = entries.slice(index, index + UPSERT_CHUNK_SIZE);
      await Promise.all(
        chunk.map((entry) =>
          this.prisma.feedCatalogEntry.upsert({
            where: { feedUrl: entry.feedUrl },
            create: { name: entry.name, feedUrl: entry.feedUrl, source: entry.source, lastSeenAt: seenAt },
            update: { name: entry.name, source: entry.source, lastSeenAt: seenAt },
          }),
        ),
      );
    }

    let removed = 0;
    for (const source of sources) {
      if (source.error) continue;
      const result = await this.prisma.feedCatalogEntry.deleteMany({
        where: { source: source.source, lastSeenAt: { lt: seenAt } },
      });
      removed += result.count;
    }

    for (const source of sources) {
      if (source.error) this.logger.warn(`目录来源 ${source.source} 同步失败：${source.error}`);
    }
    this.logger.log(`目录同步完成：收录 ${entries.length} 条，清理失效 ${removed} 条`);

    return { total: entries.length, removed, sources };
  }

  async needsSync(): Promise<boolean> {
    const latest = await this.prisma.feedCatalogEntry.findFirst({
      orderBy: { lastSeenAt: 'desc' },
      select: { lastSeenAt: true },
    });
    if (!latest) return true;
    return Date.now() - latest.lastSeenAt.getTime() > STALE_AFTER_MS;
  }
}
