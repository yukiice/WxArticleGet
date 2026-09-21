// 在 Docker CI 的独立测试数据库运行，验证真实 MySQL 默认表达式与 Prisma 日期读写。
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient, createPrismaOptions } = require('@wx/db');

const prisma = new PrismaClient(createPrismaOptions());
const rollback = new Error('rollback timezone test records');

async function verify() {
  const [initial] = await prisma.$queryRaw`SELECT @@global.time_zone AS zone`;
  assert.equal(initial.zone, '+08:00', '测试数据库必须使用 +08:00，不能通过更改全局时区绕过验证');

  for (const zone of ['+08:00', '+00:00', '-05:00']) {
    try {
      await prisma.$transaction(async (tx) => {
        // 固定测试值；交互式事务保证 SET 与后续读写使用同一条连接。
        await tx.$executeRawUnsafe(`SET SESSION time_zone = '${zone}'`);
        const [before] = await tx.$queryRaw`SELECT UTC_TIMESTAMP(3) AS time`;
        const id = randomUUID().replaceAll('-', '');

        // 同时验证 SQL 直接插入和 Prisma 创建时省略自动时间字段的行为。
        await tx.$executeRaw`INSERT INTO users (id, username, passwordHash) VALUES (${id}, ${id}, 'test-only')`;
        const sqlUser = await tx.user.findUniqueOrThrow({ where: { id } });
        const ormUser = await tx.user.create({ data: { username: id + '-orm', passwordHash: 'test-only' } });
        const feed = await tx.feedCatalogEntry.create({ data: {
          name: 'timezone test', feedUrl: `https://example.invalid/${id}`, source: 'test',
        } });

        // 明确传入的 UTC 时间和队列到期条件不能受到连接时区影响。
        const runAt = new Date('2026-09-21T00:30:00.123Z');
        const job = await tx.jobQueue.create({ data: { name: 'timezone-test', runAt, status: 'done' } });
        const due = await tx.jobQueue.count({ where: { id: job.id, runAt: { lte: runAt } } });
        assert.equal(job.runAt.toISOString(), runAt.toISOString());
        assert.equal(due, 1);

        const [after] = await tx.$queryRaw`SELECT UTC_TIMESTAMP(3) AS time`;
        for (const date of [sqlUser.createdAt, ormUser.createdAt, feed.createdAt, feed.lastSeenAt, feed.updatedAt, job.createdAt]) {
          assert.ok(date.getTime() >= before.time.getTime() - 1000 && date.getTime() <= after.time.getTime() + 1000, `${zone}: 自动时间偏移：${date.toISOString()}`);
        }
        // 测试成功也回滚，不留下账号、目录或队列记录。
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  const [after] = await prisma.$queryRaw`SELECT @@global.time_zone AS zone`;
  assert.equal(after.zone, '+08:00');
  console.log('PASS: MySQL global +08:00 unchanged; UTC defaults, Prisma writes and queue date comparisons match across session timezones.');
}

void verify().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
