import { Prisma, type PrismaClient } from '@wx/db';
import { JobDeferredError } from '@wx/queue';

/** 正常链路、定时兜底和手动发送共用同一批抓取依赖。 */
export async function waitForFetch(db: Pick<PrismaClient, 'summary' | 'jobQueue'>, date: Date): Promise<void> {
  const summary = await db.summary.findFirst({
    where: { date, scope: 'global' }, select: { id: true, fetchJobIds: true },
  });
  if (!summary) return;
  const ids = Array.isArray(summary.fetchJobIds)
    ? summary.fetchJobIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (ids.length === 0) return;
  const jobs = await db.jobQueue.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  if (jobs.some((job) => job.status === 'pending' || job.status === 'running')) {
    throw new JobDeferredError('等待本批公众号抓取及重试完成');
  }
  if (jobs.length !== ids.length || jobs.some((job) => job.status !== 'done')) {
    throw new Error('本批抓取尚未成功完成，请重试失败的公众号抓取后重新生成/发送日报');
  }
  // 已满足的依赖不再占用历史队列记录，避免任务清理影响历史日报重跑。
  await db.summary.update({ where: { id: summary.id }, data: { fetchJobIds: Prisma.DbNull } });
}
