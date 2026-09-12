'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/nav-shell';
import { SparkIcon } from '@/components/icons';
import { Markdown } from '@/components/markdown';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { isAdminRole } from '@/components/nav-shell';
import { useMe, useRunSummary, useSummaries } from '@/lib/queries';
import { cn, todayKey } from '@/lib/utils';

export default function DailyPage() {
  const [date, setDate] = useState(todayKey());
  const { data, isLoading, refetch } = useSummaries(date);
  const runSummary = useRunSummary();
  const { data: me } = useMe();
  const canRun = isAdminRole(me?.role);

  const summary = data?.summary ?? null;
  const recent = data?.recent ?? [];

  return (
    <div>
      <PageHeader
        title="AI 日报"
        subtitle={date}
        extra={
          canRun ? (
            <Button
              size="sm"
              variant="secondary"
              loading={runSummary.isPending}
              onClick={async () => {
                await runSummary.mutateAsync({ date, force: true });
                setTimeout(() => void refetch(), 3000);
              }}
            >
              重新生成
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4 px-4 sm:px-0">
        {isLoading ? (
          <Card className="flex justify-center py-16">
            <Spinner className="text-zinc-400" />
          </Card>
        ) : summary && summary.status === 'done' && summary.contentMd ? (
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500">
              <SparkIcon className="size-4 text-brand-500" />
              <span>{summary.model}</span>
              <span aria-hidden>·</span>
              <span>{summary.articleCount} 篇</span>
              {summary.tokenIn + summary.tokenOut > 0 ? (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {summary.tokenIn + summary.tokenOut} tokens
                  </span>
                </>
              ) : null}
            </div>
            <Markdown content={summary.contentMd} />
          </Card>
        ) : (
          <Card>
            <EmptyState
              title={summary?.status === 'failed' ? '总结生成失败' : '这一天还没有总结'}
              description={
                summary?.status === 'failed'
                  ? '可以点击右上角「重新生成」，或检查设置中的 DeepSeek API Key。'
                  : '抓取任务完成后会自动生成当日总结，也可以手动触发。'
              }
              action={
                canRun ? (
                  <Button
                    size="sm"
                    loading={runSummary.isPending}
                    onClick={() => void runSummary.mutate({ date, force: true })}
                  >
                    生成总结
                  </Button>
                ) : undefined
              }
            />
          </Card>
        )}

        {recent.length > 0 ? (
          <div>
            <div className="mb-2 px-1 text-[13px] font-semibold text-zinc-600 dark:text-zinc-300">历史日报</div>
            <Card className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {recent.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDate(item.date)}
                  className={cn(
                    'flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40',
                    item.date === date && 'bg-brand-50/60 dark:bg-brand-500/10',
                  )}
                >
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{item.date}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">{item.articleCount} 篇</span>
                    {item.date === todayKey() ? <Badge tone="brand">今天</Badge> : null}
                  </span>
                </button>
              ))}
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}

