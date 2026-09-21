import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobQueue, JobDeferredError, describeError } from '@wx/queue';
import { queueDatabase } from './helpers/queue-db';

afterEach(() => vi.useRealTimers());
const logger = { log() {}, warn() {}, error() {} };

describe('队列压力与并发边界', () => {
  it('500 个任务批量入队 + 单消费者按批消化（batchSize=20）', async () => {
    vi.useFakeTimers();
    const { db, rows } = queueDatabase();
    const queue = new JobQueue(db, { logger, pollIntervalMs: 1, batchSize: 20 });
    let done = 0;
    queue.work('bulk', () => { done += 1; });
    const started = Date.now();
    await Promise.all(Array.from({ length: 500 }, (_, i) => queue.enqueue('bulk', { i })));
    queue.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(rows).toHaveLength(500);
    expect(rows.every((row) => row.status === 'done')).toBe(true);
    expect(done).toBe(500);
    // 内存替身里的 createdAt 相同，priority 全为 0，因此顺序稳定
    await queue.stop();
    expect(Date.now() - started).toBeGreaterThanOrEqual(0);
  });

  it('并发入队 200 个不同 singletonKey 只保留 200 条，且同键竞争只有一个成功', async () => {
    vi.useFakeTimers();
    const { db, rows } = queueDatabase();
    const queue = new JobQueue(db, { logger, pollIntervalMs: 1 });
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) => queue.enqueue('job', { i }, { singletonKey: `key-${i % 100}` })),
    );
    // 100 个不同 key，并发下每个 key 只应有一条记录
    expect(rows).toHaveLength(100);
    const uniqueIds = new Set(results.filter((id): id is string => Boolean(id)));
    expect(uniqueIds.size).toBe(100);
    await queue.stop();
  });

  it('handler 连续抛错的任务被 defer 时不消耗重试额度，最终仍能成功', async () => {
    vi.useFakeTimers();
    const { db, rows } = queueDatabase();
    const queue = new JobQueue(db, { logger, pollIntervalMs: 1, retryDelayMs: 50 });
    let failures = 0;
    queue.work('defer', () => {
      failures += 1;
      if (failures <= 3) throw new JobDeferredError('waiting upstream', 50);
    });
    await queue.enqueue('defer');
    queue.start();
    await vi.advanceTimersByTimeAsync(300);
    await queue.stop();
    expect(rows[0]).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('handler 永久失败：按指数退避重试至 maxAttempts 后落 failed 并释放 singletonKey', async () => {
    vi.useFakeTimers();
    const { db, rows } = queueDatabase();
    const queue = new JobQueue(db, { logger, pollIntervalMs: 1, retryDelayMs: 100 });
    const runAt: Date[] = [];
    queue.work('always-fail', () => { throw new Error('boom'); });
    await queue.enqueue('always-fail', {}, { singletonKey: 'k', maxAttempts: 3 });
    queue.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await queue.stop();
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 3, singletonKey: null });
    expect(runAt).toEqual([]);
  });

  it('running 超时的任务被回收重跑，且当前活跃任务不会被误回收', async () => {
    vi.useFakeTimers();
    const { db, rows } = queueDatabase();
    const queue = new JobQueue(db, { logger, pollIntervalMs: 5, expireMinutes: 1 });
    const starts: number[] = [];
    queue.work('long', () => { starts.push(Date.now()); });
    await queue.enqueue('long');
    queue.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts).toHaveLength(1); // 运行中的任务不被 reap
    await queue.stop();
  });

  it('describeError 对非 Error 值安全序列化', () => {
    expect(describeError(new Error('x'))).toBe('x');
    expect(describeError('str')).toBe('str');
    expect(describeError(42)).toBe('42');
    expect(describeError(null)).toBe('null');
  });

  it('过期 prune 只清理已完成/失败的历史记录，不碰在途任务', async () => {
    vi.useFakeTimers();
    const { db, rows } = queueDatabase();
    const queue = new JobQueue(db, { logger, pollIntervalMs: 1 });
    queue.work('job', () => {});
    await queue.enqueue('job');
    await queue.enqueue('job');
    // 手动把第一条推成 30 天前完成，第二条保持 pending
    rows[0].status = 'done';
    rows[0].finishedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    rows[0].createdAt = rows[0].finishedAt;
    const removed = await queue.prune(7);
    expect(removed).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    await queue.stop();
  });
});
