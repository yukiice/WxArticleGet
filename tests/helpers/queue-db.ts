import { Prisma, type PrismaClient, type JobQueue } from '@wx/db';

/** 队列公开 API 的内存数据库替身，包含数据库唯一键的冲突语义。 */
export function queueDatabase() {
  const rows: JobQueue[] = [];
  const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value && !value.in.includes(row[key])) return false;
      if ('lte' in value && !(row[key] <= value.lte)) return false;
      if ('lt' in value && !(row[key] < value.lt)) return false;
      if ('not' in value && row[key] === value.not) return false;
      return true;
    }
    return row[key] === value;
  });
  const table = {
    findFirst: async ({ where, orderBy }: any) => {
      const found = rows.filter((row) => matches(row, where));
      if (orderBy) found.sort((a, b) => b.priority - a.priority || +a.runAt - +b.runAt || +a.createdAt - +b.createdAt);
      return found[0] ? { ...found[0] } : null;
    },
    findUnique: async ({ where }: any) => rows.find((row) => matches(row, where)) ?? null,
    findMany: async ({ where }: any) => rows.filter((row) => matches(row, where)).map((row) => ({ ...row })),
    create: async ({ data }: any) => {
      if (data.singletonKey && rows.some((row) => row.singletonKey === data.singletonKey)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
      }
      const row = { id: `job-${rows.length + 1}`, attempts: 0, createdAt: new Date(), startedAt: null, finishedAt: null, ...data };
      rows.push(row);
      return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      const found = rows.filter((row) => matches(row, where));
      for (const row of found) {
        for (const [key, value] of Object.entries(data) as Array<[keyof JobQueue, any]>) {
          (row as any)[key] = value && typeof value === 'object' && 'increment' in value ? Number(row[key]) + value.increment
            : value && typeof value === 'object' && 'decrement' in value ? Number(row[key]) - value.decrement : value;
        }
      }
      return { count: found.length };
    },
  };
  return { rows, db: { jobQueue: table } as unknown as Pick<PrismaClient, 'jobQueue'> };
}
