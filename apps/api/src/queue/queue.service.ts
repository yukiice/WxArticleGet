import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ALL_QUEUES, type JobName, type JobPayloads } from '@wx/shared';
import PgBoss from 'pg-boss';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Queue');
  private boss?: PgBoss;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const connectionString = this.config.get<string>('DATABASE_URL');
    if (!connectionString) throw new Error('缺少 DATABASE_URL，无法初始化任务队列');

    const boss = new PgBoss({ connectionString, schema: 'pgboss' });
    boss.on('error', (error) => this.logger.error(error instanceof Error ? error.message : String(error)));

    await boss.start();
    for (const queue of ALL_QUEUES) {
      await boss.createQueue(queue);
    }

    this.boss = boss;
    this.logger.log('任务队列已就绪');
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop({ graceful: true });
  }

  async enqueue<T extends JobName>(
    name: T,
    payload: JobPayloads[T],
    options: PgBoss.SendOptions = {},
  ): Promise<string | null> {
    if (!this.boss) throw new Error('任务队列尚未初始化');

    return this.boss.send(name, payload as object, {
      retryLimit: 3,
      retryBackoff: true,
      expireInMinutes: 30,
      ...options,
    });
  }
}

