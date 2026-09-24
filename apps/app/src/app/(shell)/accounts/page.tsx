'use client';

import Link from 'next/link';
import { isAdminRole, PageHeader } from '@/components/nav-shell';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';
import { useAccounts, useMe } from '@/lib/queries';
import { relativeTime } from '@/lib/utils';

export default function AccountsPage() {
  const { data: accounts, isLoading } = useAccounts();
  const { data: me } = useMe();
  const canManage = isAdminRole(me?.role);

  return (
    <div>
      <PageHeader title="公众号" subtitle="点击查看该号的文章" />

      <div className="px-4 sm:px-0">
        {isLoading ? (
          <Card className="flex justify-center py-16">
            <Spinner className="text-zinc-400" />
          </Card>
        ) : !accounts || accounts.length === 0 ? (
          <Card>
            <EmptyState
              title="还没有添加公众号"
              description={
                canManage
                  ? '到「管理 → 公众号」输入名称或粘贴一篇文章链接即可添加。'
                  : '还没有添加公众号，等管理员添加后这里会自动更新。'
              }
              action={
                canManage ? (
                  <Link
                    href="/admin/accounts"
                    className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white"
                  >
                    去添加
                  </Link>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <Card className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {accounts.map((account) => (
              <Link
                key={account.id}
                href={`/?accountId=${account.id}`}
                className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
              >
                {account.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={account.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="size-11 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-500 dark:bg-zinc-800">
                    {account.name.slice(0, 1)}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {account.name}
                    </span>
                    {account.status === 'error' ? <Badge tone="danger">异常</Badge> : null}
                    {account.status === 'paused' ? <Badge>已暂停</Badge> : null}
                  </div>
                  <div className="mt-1 truncate text-xs text-zinc-500">
                    {account.intro ?? `已收录 ${account.articleCount} 篇`}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-400">
                    {account.lastSuccessAt ? `上次成功 ${relativeTime(account.lastSuccessAt)}` : '尚未抓取成功'}
                  </div>
                </div>

                <span className="shrink-0 text-xs text-zinc-400">{account.articleCount} 篇</span>
              </Link>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
