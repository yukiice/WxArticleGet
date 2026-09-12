import type { JobQueue as JobQueueRow, Prisma, PrismaClient } from '@wx/db';
import { nextRunAt } from './cron';

export interface JobQueueLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface EnqueueOptions {
  /** 延迟到该时间之后执行，默认立即 */
  runAt?: Date;
  /** 相同 key 的任务在 pending / running 期间只会存在一个 */
  singletonKey?: string;
  maxAttempts?: number;
  priority?: number;
}

export interface JobQueueOptions {
  /** 空闲时的轮询间隔，默认 3s */
  pollIntervalMs?: number;
  /** 单轮最多连续处理多少个任务，防止长期霸占循环，默认 20 */
  batchSize?: number;
  /** running 超过该时长视为进程崩溃，回收重跑，默认 30 分钟 */
  expireMinutes?: number;
  /** 失败重试的基础间隔，按 2^n 退避，默认 30s */
  retryDelayMs?: number;
  logger?: JobQueueLogger;
}

export type JobQueueHandler = (payload: unknown) => Promise<void> | void;

export const JOB_STATUS = {
  pending: 'pending',
  running: 'running',
  done: 'done',
  failed: 'failed',
} as const;

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 30_000;

interface ScheduleEntry {
  name: string;
  cron: string;
  payload: unknown;
  timeZone?: string;
  nextAt?: Date;
}

/**
 * 基于 MySQL 的轻量任务队列，用来替代 pg-boss（pg-boss 只能跑在 PostgreSQL 上）。
 *
 * 对齐原来用到的 pg-boss 能力：
 * - app 侧只写库（enqueue），worker 侧轮询消费（work + start）
 * - 失败按 2^n 退避重试，超过 maxAttempts 记为 failed
 * - singletonKey 去重，避免同一任务并发重复
 * - running 超时回收（进程崩溃后任务不会永远卡住）
 * - cron 定时（进程内调度，重启后按最新配置重新注册）
 *
 * 单个 worker 进程消费，任务串行执行；本项目任务量很小（每天个位数），足够用。
 */
export class JobQueue {
  private readonly handlers = new Map<string, JobQueueHandler>();
  private readonly schedules = new Map<string, ScheduleEntry>();
  private readonly logger: JobQueueLogger;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly expireMs: number;
  private readonly retryDelayMs: number;

  private pollTimer?: NodeJS.Timeout;
  private scheduleTimer?: NodeJS.Timeout;
  private started = false;
  private stopping = false;
  private activeJobId: string | null = null;
  private currentRun: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaClient,
    options: JobQueueOptions = {},
  ) {
    this.logger = options.logger ?? console;
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
    this.batchSize = options.batchSize ?? 20;
    this.expireMs = (options.expireMinutes ?? 30) * 60_000;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  // ---------------------------------------------------------------- 生产者

  /** 入队一个任务；带 singletonKey 且已有同 key 任务在排队/执行时直接复用 */
  async enqueue<T extends string>(name: T, payload?: unknown, options: EnqueueOptions = {}): Promise<string | null> {
    if (options.singletonKey) {
      const existing = await this.prisma.jobQueue.findFirst({
        where: { singletonKey: options.singletonKey, status: { in: [JOB_STATUS.pending, JOB_STATUS.running] } },
        select: { id: true },
      });
      if (existing) {
        this.logger.warn(`任务已存在，跳过入队 ${name}（${options.singletonKey}）`);
        return existing.id;
      }
    }

    const created = await this.prisma.jobQueue.create({
      data: {
        name,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
        status: JOB_STATUS.pending,
        runAt: options.runAt ?? new Date(),
        singletonKey: options.singletonKey ?? null,
        maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        priority: options.priority ?? 0,
      },
      select: { id: true },
    });

    this.wake();
    return created.id;
  }

  // ---------------------------------------------------------------- 消费者

  /** 注册任务处理器（worker 侧） */
  work(name: string, handler: JobQueueHandler): void {
    this.handlers.set(name, handler);
  }

  /** 注册 cron 定时任务（worker 侧），时间按 timeZone 计算 */
  schedule(name: string, cron: string, payload: unknown = {}, options: { timeZone?: string } = {}): void {
    const key = `${name}|${cron}|${options.timeZone ?? ''}`;
    this.schedules.set(key, { name, cron, payload, timeZone: options.timeZone });
    this.logger.log(`注册定时任务 ${name}：${cron}${options.timeZone ? `（${options.timeZone}）` : ''}`);
    if (this.started) this.armSchedules();
  }

  /** 启动轮询与定时调度 */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.logger.log(`任务队列已就绪，轮询间隔 ${this.pollIntervalMs}ms`);
    this.armPoll(0);
    this.armSchedules();
  }

  /** 停止轮询并等待当前任务跑完 */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = undefined;
    }
    await this.currentRun;
    this.started = false;
  }

  /** 清理历史任务记录，避免 job_queue 无限增长 */
  async prune(olderThanDays = 7): Promise<number> {
    const before = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.jobQueue.deleteMany({
      where: { status: { in: [JOB_STATUS.done, JOB_STATUS.failed] }, finishedAt: { lt: before } },
    });
    return result.count;
  }

  // ---------------------------------------------------------------- 内部实现

  private wake(): void {
    if (!this.started || this.stopping || this.pollTimer === undefined) return;
    // 本进程同时是消费者时，入队后立即唤醒，避免白等一个轮询间隔
    clearTimeout(this.pollTimer);
    this.armPoll(0);
  }

  private armPoll(delayMs: number): void {
    if (!this.started || this.stopping) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      this.currentRun = this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    let delay = this.pollIntervalMs;
    try {
      const processed = await this.drain();
      if (processed > 0) delay = 0;
    } catch (error) {
      this.logger.error(`任务轮询失败：${describeError(error)}`);
      delay = Math.max(this.pollIntervalMs, 5_000);
    }
    this.armPoll(delay);
  }

  private async drain(): Promise<number> {
    await this.reapExpired();

    let processed = 0;
    while (!this.stopping && processed < this.batchSize) {
      const job = await this.claimNext();
      if (!job) break;
      await this.runJob(job);
      processed += 1;
    }
    return processed;
  }

  /** 认领一个到期任务：先查再原子更新，更新失败说明被别的进程抢走 */
  private async claimNext(): Promise<JobQueueRow | null> {
    const names = [...this.handlers.keys()];
    if (names.length === 0) return null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = await this.prisma.jobQueue.findFirst({
        where: { status: JOB_STATUS.pending, name: { in: names }, runAt: { lte: new Date() } },
        orderBy: [{ priority: 'desc' }, { runAt: 'asc' }, { createdAt: 'asc' }],
      });
      if (!candidate) return null;

      const startedAt = new Date();
      const claimed = await this.prisma.jobQueue.updateMany({
        where: { id: candidate.id, status: JOB_STATUS.pending },
        data: { status: JOB_STATUS.running, startedAt, attempts: { increment: 1 } },
      });
      if (claimed.count === 1) {
        return { ...candidate, status: JOB_STATUS.running, startedAt, attempts: candidate.attempts + 1 };
      }
    }

    return null;
  }

  private async runJob(job: JobQueueRow): Promise<void> {
    const handler = this.handlers.get(job.name);
    const startedAt = Date.now();
    this.activeJobId = job.id;
    this.logger.log(`开始执行任务 ${job.name}（第 ${job.attempts}/${job.maxAttempts} 次）`);

    try {
      if (!handler) throw new Error(`没有注册任务处理器：${job.name}`);
      await withTimeout(
        Promise.resolve(handler(job.payload ?? {})),
        this.expireMs,
        `任务执行超过 ${describeDuration(this.expireMs)}未结束`,
      );
      await this.prisma.jobQueue.update({
        where: { id: job.id },
        data: { status: JOB_STATUS.done, finishedAt: new Date(), lastError: null },
      });
      this.logger.log(`任务完成 ${job.name}（${Date.now() - startedAt}ms）`);
    } catch (error) {
      const message = describeError(error);
      if (job.attempts < job.maxAttempts) {
        const delay = this.retryDelayMs * 2 ** Math.max(0, job.attempts - 1);
        await this.prisma.jobQueue.update({
          where: { id: job.id },
          data: {
            status: JOB_STATUS.pending,
            startedAt: null,
            runAt: new Date(Date.now() + delay),
            lastError: message,
          },
        });
        this.logger.warn(`任务失败将重试 ${job.name}（第 ${job.attempts}/${job.maxAttempts} 次）：${message}`);
      } else {
        await this.prisma.jobQueue.update({
          where: { id: job.id },
          data: { status: JOB_STATUS.failed, finishedAt: new Date(), lastError: message },
        });
        this.logger.error(`任务最终失败 ${job.name}：${message}`);
      }
    } finally {
      this.activeJobId = null;
    }
  }

  /** 回收超时未完成的任务（进程重启 / 卡死） */
  private async reapExpired(): Promise<void> {
    const deadline = new Date(Date.now() - this.expireMs);
    const result = await this.prisma.jobQueue.updateMany({
      where: {
        status: JOB_STATUS.running,
        startedAt: { lt: deadline },
        ...(this.activeJobId ? { id: { not: this.activeJobId } } : {}),
      },
      data: { status: JOB_STATUS.pending, startedAt: null, runAt: new Date() },
    });
    if (result.count > 0) {
      this.logger.warn(`回收 ${result.count} 个超时任务，将重新执行`);
    }
  }

  private armSchedules(): void {
    if (!this.started || this.stopping || this.schedules.size === 0) return;
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer);

    let soonest = Number.POSITIVE_INFINITY;
    for (const entry of this.schedules.values()) {
      try {
        entry.nextAt = nextRunAt(entry.cron, entry.timeZone);
        soonest = Math.min(soonest, entry.nextAt.getTime());
      } catch (error) {
        this.logger.error(`cron 表达式无法解析：${entry.cron}（${describeError(error)}）`);
        entry.nextAt = undefined;
      }
    }
    if (!Number.isFinite(soonest)) return;

    // 最长一分钟检查一次，便于时钟跳变 / 新注册的定时任务及时生效
    const delay = Math.min(Math.max(soonest - Date.now(), 0), 60_000);
    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = undefined;
      void this.fireSchedules();
    }, delay);
  }

  private async fireSchedules(): Promise<void> {
    const now = Date.now();
    for (const entry of this.schedules.values()) {
      if (!entry.nextAt || entry.nextAt.getTime() > now) continue;
      try {
        await this.enqueue(entry.name, entry.payload, {
          singletonKey: `schedule:${entry.name}:${entry.nextAt.toISOString()}`,
        });
      } catch (error) {
        this.logger.error(`定时任务派发失败 ${entry.name}：${describeError(error)}`);
      }
      entry.nextAt = undefined;
    }
    this.armSchedules();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function describeDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟`;
  return `${Math.round(ms / 3_600_000)} 小时`;
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
