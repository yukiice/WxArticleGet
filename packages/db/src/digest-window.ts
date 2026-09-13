import type { PrismaClient } from '@prisma/client';
import { dayRange, digestWindow } from '@wx/shared';

/** 所有日报入口优先沿用已落库的窗口，只有首次生成时才计算边界。 */
export async function resolveDigestWindow(
  db: Pick<PrismaClient, 'summary' | 'sendLog'>,
  target: string,
  cutoff = dayRange(target).end,
): Promise<{ from: Date; to: Date }> {
  const date = new Date(`${target}T00:00:00.000Z`);
  const existing = await db.summary.findFirst({
    where: { date, scope: 'global', windowFrom: { not: null }, windowTo: { not: null } },
    select: { windowFrom: true, windowTo: true },
  });
  if (existing?.windowFrom && existing.windowTo) return { from: existing.windowFrom, to: existing.windowTo };

  const previous = await db.sendLog.findFirst({
    where: { date: { lt: date }, status: { in: ['success', 'skipped'] }, windowTo: { not: null, lte: cutoff } },
    orderBy: { windowTo: 'desc' },
    select: { windowTo: true },
  });
  return digestWindow(previous?.windowTo ?? null, cutoff);
}
