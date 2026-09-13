import {
  DEFAULT_DIGEST_WINDOW_HOURS,
  DEFAULT_FETCH_WINDOW_HOURS,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_TIMEZONE,
  MAX_FETCH_LOOKBACK_DAYS,
} from './constants';

/** 返回指定时区下的自然日 key，格式 YYYY-MM-DD */
export function dateKey(date: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/** 返回指定时区下某天的起止 UTC 时间 */
export function dayRange(dateKeyValue: string, timeZone: string = DEFAULT_TIMEZONE): { start: Date; end: Date } {
  // 该时区相对 UTC 的偏移（分钟），按目标日期取值，规避夏令时误差
  const guess = new Date(`${dateKeyValue}T00:00:00Z`);
  const offsetMinutes = -getTimeZoneOffsetMinutes(guess, timeZone);
  const start = new Date(guess.getTime() + offsetMinutes * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour % 24, map.minute, map.second);
  return (asUtc - date.getTime()) / 60_000;
}

export function formatDateTime(date: Date | string, timeZone: string = DEFAULT_TIMEZONE): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

/**
 * 抓取窗口起点：
 * - 常规：最近 windowHours（默认 24 小时）
 * - 上次成功抓取更早（抓取失败/停机）：从上次成功时刻开始补，最多回溯 maxDays
 * - 首次接入（从未成功）：回溯 firstRunDays 天
 */
export function fetchWindowStart(
  lastSuccessAt: Date | null,
  options: { windowHours?: number; firstRunDays?: number; maxDays?: number } = {},
  now: Date = new Date(),
): Date {
  const windowHours = options.windowHours ?? DEFAULT_FETCH_WINDOW_HOURS;
  const maxDays = options.maxDays ?? MAX_FETCH_LOOKBACK_DAYS;
  const floor = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);

  if (!lastSuccessAt) {
    const firstRunDays = options.firstRunDays ?? DEFAULT_LOOKBACK_DAYS;
    const first = new Date(now.getTime() - firstRunDays * 24 * 60 * 60 * 1000);
    return first < floor ? floor : first;
  }

  const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const start = lastSuccessAt < windowStart ? lastSuccessAt : windowStart;
  return start < floor ? floor : start;
}

/**
 * 日报窗口：
 * - 结束时间取「本次抓取开始时刻」（抓取覆盖到哪，日报就统计到哪，避免同一篇文章漏掉或重复）
 * - 开始时间取「上次成功产出日报的时刻」与「cutoff 前 windowHours」中更早的那个，
 *   所以正常情况就是过去 24 小时，某天没发成功时会自动补上一段。
 */
export function digestWindow(
  lastDigestAt: Date | null,
  cutoff: Date,
  windowHours: number = DEFAULT_DIGEST_WINDOW_HOURS,
): { from: Date; to: Date } {
  const byWindow = new Date(cutoff.getTime() - windowHours * 60 * 60 * 1000);
  const from = lastDigestAt && lastDigestAt < byWindow ? lastDigestAt : byWindow;
  return { from, to: cutoff };
}

/** 人类可读的时间范围，如「09-12 08:30 → 09-13 08:30」 */
export function formatRange(from: Date, to: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const label = (value: Date): string => formatter.format(value).replace(',', '').slice(5);
  return `${label(from)} → ${label(to)}`;
}
