import type { AccountCandidate, ParsedArticle, RawArticle } from '@wx/shared';
import type { HttpOptions } from '../http';

export interface ProviderContext {
  /** 自建「公众号搜索」服务地址；未配置时只能通过文章链接解析账号 */
  searchEndpoint?: string;
  /** 自建 RSSHub 实例地址，用于拼装 rsshub 类型的订阅地址 */
  rsshubBaseUrl?: string;
  fetchOptions?: HttpOptions;
  /** 抓取同一账号文章之间的间隔，降低被风控概率 */
  requestDelayMs?: number;
}

export interface AccountSource {
  id: string;
  name: string;
  biz: string;
  providerType: string;
  providerConfig?: Record<string, unknown> | null;
}

export interface FetchedArticle {
  parsed: ParsedArticle;
  finalUrl: string;
}

export interface Provider {
  readonly type: string;
  fetchArticles(account: AccountSource, since: Date, context: ProviderContext): Promise<RawArticle[]>;
}

export type { AccountCandidate, ParsedArticle, RawArticle };
