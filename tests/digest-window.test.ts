import { describe, expect, it, vi } from 'vitest';
import { resolveDigestWindow } from '@wx/db';
import { digestWindow } from '@wx/shared';

describe('日报统计区间', () => {
  it('停机后从上份统计截止点续接，而非发信时间', async () => {
    const previousEnd = new Date('2026-09-11T00:30:00Z');
    const cutoff = new Date('2026-09-13T00:30:00Z');
    const db = { summary: { findFirst: async () => null }, sendLog: { findFirst: vi.fn(async () => ({ windowTo: previousEnd, sentAt: new Date('2026-09-11T01:00:00Z') })) } };
    expect(await resolveDigestWindow(db as never, '2026-09-13', cutoff)).toEqual({ from: previousEnd, to: cutoff });
    expect(db.sendLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { windowTo: 'desc' } }));
  });
  it('手动重跑、发信及兜底沿用已保存的同一窗口', async () => {
    const windowFrom = new Date('2026-09-12T00:30:00Z');
    const windowTo = new Date('2026-09-13T00:30:00Z');
    const db = { summary: { findFirst: async () => ({ windowFrom, windowTo }) }, sendLog: { findFirst: vi.fn() } };
    for (const cutoff of [undefined, new Date('2026-09-13T01:30:00Z'), new Date('2026-09-13T16:00:00Z')]) {
      expect(await resolveDigestWindow(db as never, '2026-09-13', cutoff)).toEqual({ from: windowFrom, to: windowTo });
    }
    expect(db.sendLog.findFirst).not.toHaveBeenCalled();
  });
  it('调度提前或延迟不会产生重复区间或空洞', () => {
    const previousEnd = new Date('2026-09-12T00:30:00Z');
    for (const cutoff of ['2026-09-13T00:29:00Z', '2026-09-13T00:31:00Z']) {
      expect(digestWindow(previousEnd, new Date(cutoff)).from).toEqual(previousEnd);
    }
  });
});
