import { parseExpression } from 'cron-parser';

/** 计算 cron 表达式的下一次执行时间（支持时区），解析失败时抛错由调用方兜底 */
export function nextRunAt(cron: string, timeZone?: string): Date {
  return parseExpression(cron, { tz: timeZone }).next().toDate();
}
