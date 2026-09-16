import { PrismaClient, type Prisma } from '@prisma/client';

export * from '@prisma/client';
export * from './digest-window';

// 队列用 create + 捕获 P2002 实现 singletonKey 去重，这类唯一键冲突是预期行为，
// Prisma 默认会把它们按 error 打到 stderr，这里集中过滤，避免日志噪音。
const IGNORED_QUERY_ERRORS = ['job_queue_singletonKey_key'];

/** Prisma 日志配置：error 走事件模式，便于过滤预期内的错误。 */
export function createPrismaOptions(): Prisma.PrismaClientOptions {
  return {
    log: process.env.PRISMA_LOG === 'true'
      ? ['query', 'warn', 'error']
      : [{ emit: 'stdout', level: 'warn' }, { emit: 'event', level: 'error' }],
  };
}

/** 接管 error 事件：过滤预期冲突，其余照常打印。PRISMA_LOG=true 时保留 Prisma 原样输出。 */
export function attachPrismaErrorFilter(client: PrismaClient): void {
  if (process.env.PRISMA_LOG === 'true') return;
  (client as unknown as {
    $on(event: 'error', callback: (event: Prisma.LogEvent) => void): void;
  }).$on('error', (event) => {
    if (IGNORED_QUERY_ERRORS.some((key) => event.message.includes(key))) return;
    console.error(`prisma:error ${event.message}`);
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient(createPrismaOptions());
  attachPrismaErrorFilter(client);
  return client;
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
