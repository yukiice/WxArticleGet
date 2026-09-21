export const JOB = {
  FETCH_ALL: 'fetch-all',
  FETCH_ACCOUNT: 'fetch-account',
  PROCESS_ARTICLE: 'process-article',
  SUMMARIZE_DAY: 'summarize-day',
  SEND_DIGEST: 'send-digest',
  SEND_ALERT: 'send-alert',
  SYNC_CATALOG: 'sync-catalog',
  RETRY_FAILED: 'retry-failed',
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

export const ALL_QUEUES: JobName[] = Object.values(JOB);

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

export const DEFAULT_LOOKBACK_DAYS = 3;

/** 抓取窗口：常规情况下只看最近 24 小时 */
export const DEFAULT_FETCH_WINDOW_HOURS = 24;

/** 日报窗口：至少覆盖最近 24 小时 */
export const DEFAULT_DIGEST_WINDOW_HOURS = 24;

/** 抓取长期失败时的最大回溯天数，避免无限制往前补 */
export const MAX_FETCH_LOOKBACK_DAYS = 7;

export const SETTINGS_KEY = {
  llm: 'llm',
  smtp: 'smtp',
  digest: 'digest',
  fetch: 'fetch',
} as const;

export const PROVIDER_TYPE = {
  manual: 'manual',
  rss: 'rss',
  rsshub: 'rsshub',
} as const;

export type ProviderType = (typeof PROVIDER_TYPE)[keyof typeof PROVIDER_TYPE];

export const USER_ROLE = {
  /** 总管理员：由 ADMIN_USERNAME 指定，随服务启动自动保证 */
  super: 'super',
  admin: 'admin',
  member: 'member',
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export const ACCOUNT_STATUS = {
  active: 'active',
  paused: 'paused',
  error: 'error',
} as const;

export const SUMMARY_SCOPE = {
  global: 'global',
  account: 'account',
} as const;

export const SECRET_MASK = '********';
