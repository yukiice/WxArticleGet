'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArticleCard } from '@/components/article-card';
import { PageHeader } from '@/components/nav-shell';
import { SearchIcon } from '@/components/icons';
import { Badge, Button, EmptyState, Input, Spinner } from '@/components/ui';
import { isAdminRole } from '@/components/nav-shell';
import { useAccounts, useArticles, useMe } from '@/lib/queries';
import { cn, todayKey } from '@/lib/utils';

type Scope = 'today' | 'all' | 'unread';

export default function HomePage() {
  const searchParams = useSearchParams();
  const [scope, setScope] = useState<Scope>('today');
  const [accountId, setAccountId] = useState<string>(() => searchParams.get('accountId') ?? '');
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');

  const params = useMemo(
    () => ({
      ...(scope === 'today' ? { date: todayKey() } : {}),
      ...(scope === 'unread' ? { isRead: 'false' as const } : {}),
      ...(accountId ? { accountId } : {}),
      ...(search ? { q: search } : {}),
      pageSize: 20,
    }),
    [scope, accountId, search],
  );

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useArticles(params);
  const { data: accounts } = useAccounts();
  const { data: me } = useMe();

  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div>
      <PageHeader title="阅读" subtitle={`共 ${total} 篇`} />

      <div className="space-y-3 px-4 sm:px-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            {(
              [
                ['today', '今日'],
                ['all', '全部'],
                ['unread', '未读'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setScope(value);
                }}
                className={cn(
                  'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                  scope === value
                    ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-500',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <form
            className="relative min-w-0 flex-1 basis-full sm:basis-auto"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(keyword.trim());
            }}
          >
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索标题或正文"
              className="pl-9"
            />
          </form>
        </div>

        {accounts && accounts.length > 0 ? (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            <button
              type="button"
              onClick={() => {
                setAccountId('');
              }}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-xs transition-colors',
                accountId === ''
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10'
                  : 'border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400',
              )}
            >
              全部公众号
            </button>
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => {
                  setAccountId(account.id);
                }}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1 text-xs transition-colors',
                  accountId === account.id
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10'
                    : 'border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400',
                )}
              >
                {account.name}
              </button>
            ))}
          </div>
        ) : null}

        {search ? (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            搜索「{search}」
            <button
              type="button"
              className="text-brand-600"
              onClick={() => {
                setSearch('');
                setKeyword('');
              }}
            >
              清除
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 overflow-hidden bg-white sm:rounded-xl sm:border sm:border-zinc-200 sm:shadow-sm dark:bg-zinc-900 dark:sm:border-zinc-800">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner className="text-zinc-400" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="还没有文章"
            description={
              isAdminRole(me?.role)
                ? '到「管理 → 公众号」添加要关注的公众号，抓取任务会在每天定时运行，也可以手动触发。'
                : '还没有抓取到文章，等管理员添加公众号后这里会自动更新。'
            }
          />
        ) : (
          items.map((article) => <ArticleCard key={article.id} article={article} />)
        )}
      </div>

      {hasNextPage ? (
        <div className="mt-4 flex justify-center px-4 sm:px-0">
          <Button variant="secondary" onClick={() => void fetchNextPage()} loading={isFetchingNextPage}>
            加载更多
          </Button>
        </div>
      ) : items.length > 0 ? (
        <div className="mt-6 flex justify-center">
          <Badge>已经到底了</Badge>
        </div>
      ) : null}
    </div>
  );
}
