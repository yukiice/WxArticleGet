export interface JobPayloads {
  'fetch-all': { date?: string };
  'fetch-account': { accountId: string; sinceDays?: number; manual?: boolean; urls?: string[] };
  'process-article': { articleId: string };
  'summarize-day': { date?: string; force?: boolean };
  'send-digest': { date?: string; to?: string[]; test?: boolean };
  'send-alert': { subject: string; message: string };
  'sync-catalog': { source?: string };
}

export interface UserDto {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

export interface AccountCandidate {
  name: string;
  biz: string;
  avatarUrl?: string;
  intro?: string;
  source: string;
  providerType: string;
  providerConfig?: Record<string, unknown>;
}

export interface RawArticle {
  title: string;
  url: string;
  biz?: string;
  mid?: string;
  idx?: number;
  coverUrl?: string;
  author?: string;
  publishTime?: Date;
  digest?: string;
  contentHtml?: string;
}

export interface ParsedArticle {
  title: string;
  author?: string;
  accountName?: string;
  biz?: string;
  mid?: string;
  idx?: number;
  publishTime?: Date;
  coverUrl?: string;
  contentHtml: string;
  contentText: string;
  images: Array<{ originalUrl: string; width?: number; height?: number }>;
  wordCount: number;
}

export interface AccountDto {
  id: string;
  name: string;
  biz: string;
  avatarUrl: string | null;
  intro: string | null;
  providerType: string;
  providerConfig: Record<string, unknown> | null;
  status: string;
  lastFetchAt: string | null;
  lastSuccessAt: string | null;
  articleCount: number;
  createdAt: string;
}

export interface ArticleListItemDto {
  id: string;
  title: string;
  digest: string | null;
  coverUrl: string | null;
  /** 本地化封面路径（相对 /files），存在时前端优先使用，避免依赖微信 CDN */
  coverLocal: string | null;
  publishTime: string;
  isRead: boolean;
  wordCount: number;
  account: { id: string; name: string; avatarUrl: string | null };
}

export interface ArticleDetailDto extends ArticleListItemDto {
  contentHtml: string;
  contentText: string;
  author: string | null;
  url: string;
}

export interface SummaryDto {
  id: string;
  date: string;
  scope: string;
  accountId: string | null;
  model: string;
  contentMd: string;
  status: string;
  articleCount: number;
  tokenIn: number;
  tokenOut: number;
  createdAt: string;
}

export interface JobLogDto {
  id: string;
  type: string;
  accountId: string | null;
  accountName: string | null;
  status: string;
  newCount: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface EmailRecipientDto {
  id: string;
  email: string;
  name: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface SendLogDto {
  id: string;
  subject: string;
  recipients: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface OverviewStatsDto {
  totalArticles: number;
  todayArticles: number;
  totalAccounts: number;
  unreadArticles: number;
  lastSuccessfulFetchAt: string | null;
  accountsWithError: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
