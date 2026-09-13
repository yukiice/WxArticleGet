import { parseExpression } from 'cron-parser';

/**
 * 计算 cron 表达式的下一次执行时间（支持时区），解析失败时抛错由调用方兜底。
 * 传入 from 时以它为基准（严格之后的下一次）；不传则用当前时间。
 */
export function nextRunAt(cron: string, timeZone?: string, from?: Date): Date {
  const options = { tz: timeZone, ...(from ? { currentDate: from } : {}) };
  return parseExpression(cron, options).next().toDate();
}
