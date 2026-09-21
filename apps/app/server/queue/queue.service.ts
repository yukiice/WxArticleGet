import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobQueue, type EnqueueOptions } from '@wx/queue';
import type { JobName, JobPayloads } from '@wx/shared';
import { PrismaService } from '../prisma/prisma.service';

/** 同一进程负责入队和执行，任务状态仍持久化在 MySQL 中。 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger('Queue');
  private readonly queue: JobQueue;

  constructor(config: ConfigService, prisma: PrismaService) {
    this.queue = new JobQueue(prisma, {
      expireMinutes: Number(config.get<string>('QUEUE_EXPIRE_MINUTES') ?? 30),
      retryDelayMs: Number(config.get<string>('QUEUE_RETRY_DELAY_MS') ?? 30000),
      pollIntervalMs: Number(config.get<string>('QUEUE_POLL_MS') ?? 3000),
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
}
