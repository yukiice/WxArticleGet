import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobQueue, type EnqueueOptions } from '@wx/queue';
import type { JobName, JobPayloads } from '@wx/shared';
import { PrismaService } from '../prisma/prisma.service';

/** worker 侧的任务队列：注册处理器后由 ScheduleService 启动轮询 */
@Injectable()
export class QueueProvider implements OnApplicationShutdown {
  private readonly logger = new Logger('Queue');
  private readonly queue: JobQueue;

  constructor(config: ConfigService, prisma: PrismaService) {
    this.queue = new JobQueue(prisma, {
      pollIntervalMs: Number(config.get<string>('QUEUE_POLL_MS') ?? 3000),
      expireMinutes: Number(config.get<string>('QUEUE_EXPIRE_MINUTES') ?? 30),
      retryDelayMs: Number(config.get<string>('QUEUE_RETRY_DELAY_MS') ?? 30000),
      logger: {
        log: (message) => this.logger.log(message),
        warn: (message) => this.logger.warn(message),
        error: (message) => this.logger.error(message),
      },
    });
  }

  get instance(): JobQueue {
    return this.queue;
  }

  async enqueue<T extends JobName>(
    name: T,
    payload: JobPayloads[T],
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    return this.queue.enqueue(name, payload, { maxAttempts: 3, ...options });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.stop();
  }
}
