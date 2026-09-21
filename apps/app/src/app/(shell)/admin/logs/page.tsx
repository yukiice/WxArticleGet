'use client';

import { useState } from 'react';
import { AdminTabs, PageHeader } from '@/components/nav-shell';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { useJobLogs, useSendLogs } from '@/lib/queries';
import { cn, formatDateTime } from '@/lib/utils';

type Tab = 'jobs' | 'mails';

export default function AdminLogsPage() {
  const [tab, setTab] = useState<Tab>('jobs');
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');

  const jobs = useJobLogs({ page, type, status });
  const mails = useSendLogs(page);

  const active = tab === 'jobs' ? jobs.data : mails.data;
  const isLoading = tab === 'jobs' ? jobs.isLoading : mails.isLoading;
  const total = active?.total ?? 0;

  return (
    <div>
      <PageHeader title="任务日志" subtitle="抓取与发送记录" />
      <div className="px-4 sm:px-0">
        <AdminTabs />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            {(
              [
                ['jobs', '抓取任务'],
                ['mails', '邮件记录'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setTab(value);
                  setPage(1);
                }}
                className={cn(
                  'rounded-md px-3 py-1.5 text-[13px] font-medium',
                  tab === value ? 'bg-white shadow-sm dark:bg-zinc-900' : 'text-zinc-500',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'jobs' ? (
            <>
              <select
                value={type}
                onChange={(event) => {
                  setType(event.target.value);
                  setPage(1);
                }}
                className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-[13px] dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="">全部类型</option>
                <option value="fetch">抓取</option>
                <option value="clean">清洗</option>
                <option value="summary">总结</option>
                <option value="email">邮件</option>
              </select>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-[13px] dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="">全部状态</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
                <option value="running">进行中</option>
              </select>
            </>
          ) : null}
        </div>

        <Card>
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner className="text-zinc-400" />
            </div>
          ) : !active || active.items.length === 0 ? (
            <EmptyState title="暂无记录" description="抓取和发送任务执行后会在这里留下日志。" />
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {tab === 'jobs'
                ? jobs.data?.items.map((log) => (
                    <div key={log.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={log.status} />
                          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                            {log.accountName ?? log.type}
                          </span>
                        </div>
                        <span className="text-xs text-zinc-400">{formatDateTime(log.startedAt)}</span>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        新增 {log.newCount} 篇
                        {log.finishedAt ? ` · 耗时 ${Math.max(1, Math.round((new Date(log.finishedAt).getTime() - new Date(log.startedAt).getTime()) / 1000))}s` : ''}
                      </div>
                      {log.error ? <div className="mt-1 text-xs text-red-500">{log.error}</div> : null}
                    </div>
                  ))
                : mails.data?.items.map((log) => (
                    <div key={log.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={log.status} />
                          <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                            {log.subject}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs text-zinc-400">{formatDateTime(log.createdAt)}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-zinc-500">收件人：{log.recipients}</div>
                      {log.error ? <div className="mt-1 text-xs text-red-500">{log.error}</div> : null}
                    </div>
                  ))}
            </div>
          )}
        </Card>

        {total > 20 ? (
          <div className="mt-4 flex items-center justify-center gap-3">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>
              上一页
            </Button>
            <span className="text-xs text-zinc-500">
              {page} / {Math.ceil(total / 20)}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= Math.ceil(total / 20)}
              onClick={() => setPage((prev) => prev + 1)}
            >
              下一页
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'success') return <Badge tone="success">成功</Badge>;
  if (status === 'failed') return <Badge tone="danger">失败</Badge>;
  if (status === 'running') return <Badge tone="warning">进行中</Badge>;
  return <Badge>{status}</Badge>;
}
