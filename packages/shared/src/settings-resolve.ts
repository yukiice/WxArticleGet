import { DEFAULT_LOOKBACK_DAYS, SETTINGS_KEY } from './constants';

export interface ResolvedLlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxInputCharsPerArticle: number;
}

export interface ResolvedSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface ResolvedDigestConfig {
  enabled: boolean;
  sendTime: string;
  maxArticles: number;
  includeDigest: boolean;
}

export interface ResolvedFetchConfig {
  lookbackDays: number;
  dailyLimitPerAccount: number;
  requestDelayMs: number;
  searchEndpoint?: string;
  rsshubBaseUrl?: string;
}

export interface ResolvedSettings {
  llm: ResolvedLlmConfig;
  smtp: ResolvedSmtpConfig;
  digest: ResolvedDigestConfig;
  fetch: ResolvedFetchConfig;
}

export type SettingsGroup = keyof typeof SETTINGS_KEY;
export type StoredSettings = Partial<Record<SettingsGroup, Record<string, unknown>>>;
export type EnvReader = (key: string) => string | undefined;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function resolveSettings(stored: StoredSettings, env: EnvReader): ResolvedSettings {
  const llm = stored.llm ?? {};
  const smtp = stored.smtp ?? {};
  const digest = stored.digest ?? {};
  const fetch = stored.fetch ?? {};

  const smtpUser = str(smtp.user) ?? env('SMTP_USER') ?? '';

  return {
    llm: {
      apiKey: str(llm.apiKey) ?? env('DEEPSEEK_API_KEY') ?? '',
      baseUrl: str(llm.baseUrl) ?? env('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com',
      model: str(llm.model) ?? env('LLM_MODEL') ?? 'deepseek-chat',
      temperature: num(llm.temperature) ?? 0.3,
      maxInputCharsPerArticle: num(llm.maxInputCharsPerArticle) ?? 8000,
    },
    smtp: {
      host: str(smtp.host) ?? env('SMTP_HOST') ?? 'smtp.163.com',
      port: num(smtp.port) ?? Number(env('SMTP_PORT') ?? 465),
      secure: bool(smtp.secure) ?? (env('SMTP_SECURE') ?? 'true') === 'true',
      user: smtpUser,
      pass: str(smtp.pass) ?? env('SMTP_PASS') ?? '',
      from: str(smtp.from) ?? env('MAIL_FROM') ?? smtpUser,
    },
    digest: {
      enabled: bool(digest.enabled) ?? true,
      sendTime: str(digest.sendTime) ?? '09:00',
      maxArticles: num(digest.maxArticles) ?? 20,
      includeDigest: bool(digest.includeDigest) ?? true,
    },
    fetch: {
      lookbackDays: num(fetch.lookbackDays) ?? Number(env('FIRST_RUN_LOOKBACK_DAYS') ?? DEFAULT_LOOKBACK_DAYS),
      dailyLimitPerAccount: num(fetch.dailyLimitPerAccount) ?? 50,
      requestDelayMs: num(fetch.requestDelayMs) ?? 3000,
      searchEndpoint: str(fetch.searchEndpoint) ?? env('WECHAT_SEARCH_ENDPOINT'),
      rsshubBaseUrl: str(fetch.rsshubBaseUrl) ?? env('RSSHUB_BASE_URL'),
    },
  };
}

/** 将 HH:mm 转为每日 cron 表达式 */
export function dailyCron(sendTime: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(sendTime.trim());
  if (!match) return '0 8 * * *';
  const hour = Math.min(23, Number(match[1]));
  const minute = Math.min(59, Number(match[2]));
  return `${minute} ${hour} * * *`;
}

