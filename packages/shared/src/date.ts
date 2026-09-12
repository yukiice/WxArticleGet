import { DEFAULT_TIMEZONE } from './constants';

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

