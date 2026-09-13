import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobDeferredError, JobQueue } from '@wx/queue';
import { queueDatabase } from './helpers/queue-db';

afterEach(() => vi.useRealTimers());
const logger = { log() {}, warn() {}, error() {} };

describe('队列任务生命周期', () => {
  it('同键并发生产只入队一次，完成后键可用于新任务', async () => {
    vi.useFakeTimers();
    const { db, rows } = queueDatabase();
    const queue = new JobQueue(db, { logger });
    const handler = vi.fn();
    queue.work('job', handler);
    const ids = await Promise.all([queue.enqueue('job', {}, { singletonKey: 'key' }), queue.enqueue('job', {}, { singletonKey: 'key' })]);
    expect(ids[0]).toBe(ids[1]);
    expect(rows).toHaveLength(1);
    queue.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(handler).toHaveBeenCalledOnce();
    expect(rows[0].status).toBe('done');
    expect(await queue.enqueue('job', {}, { singletonKey: 'key' })).not.toBe(ids[0]);
    await queue.stop();
  });

  it('等待上游不消耗重试额度，最终失败后释放去重键', async () => {
    vi.useFakeTimers();
    const { db, rows } = queueDatabase();
    const queue = new JobQueue(db, { logger, pollIntervalMs: 10 });
    let waiting = true;
    queue.work('job', () => { if (waiting) throw new JobDeferredError('waiting', 100); throw new Error('failed'); });
    await queue.enqueue('job', {}, { singletonKey: 'key', maxAttempts: 1 });
    queue.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 0, singletonKey: 'key' });
    waiting = false;
    await vi.advanceTimersByTimeAsync(110);
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 1, singletonKey: null });
    await queue.stop();
  });
});
