'use client';

import { useState } from 'react';
import { AdminTabs, PageHeader } from '@/components/nav-shell';
import { PlusIcon, RefreshIcon, TrashIcon } from '@/components/icons';
import { Badge, Button, Card, EmptyState, Field, Input, SectionTitle, Select, Spinner } from '@/components/ui';
import {
  useAccounts,
  useCatalogStatus,
  useCreateAccount,
  useDeleteAccount,
  useFetchAccount,
  useImportArticle,
  useLookupAccount,
  useSyncCatalog,
  useUpdateAccount,
} from '@/lib/queries';
import { relativeTime } from '@/lib/utils';
import type { AccountCandidate } from '@wx/shared';

export default function AdminAccountsPage() {
  const { data: accounts, isLoading } = useAccounts();
  const { data: catalog } = useCatalogStatus();
  const lookup = useLookupAccount();
  const syncCatalog = useSyncCatalog();
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const deleteAccount = useDeleteAccount();
  const fetchAccount = useFetchAccount();
  const importArticle = useImportArticle();

  const [keyword, setKeyword] = useState('');
  const [candidates, setCandidates] = useState<AccountCandidate[] | null>(null);
  const [selected, setSelected] = useState<AccountCandidate | null>(null);
  const [providerType, setProviderType] = useState<'manual' | 'rss' | 'rsshub'>('manual');
  const [feedUrl, setFeedUrl] = useState('');
  const [route, setRoute] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    providerType: 'manual' as 'manual' | 'rss' | 'rsshub',
    feedUrl: '',
    route: '',
    baseUrl: '',
  });

  const doLookup = async () => {
    setMessage(null);
    setCandidates(null);
    setSelected(null);
    if (!keyword.trim()) return;
    try {
      const result = await lookup.mutateAsync(keyword.trim());
      if (result.length === 0) {
        setMessage(
          '没有搜索到结果。当前未配置搜索服务，请直接粘贴该公众号任意一篇文章的链接来绑定。',
        );
      } else {
        setCandidates(result);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '查询失败');
    }
  };

  const selectCandidate = (candidate: AccountCandidate) => {
    setSelected(candidate);
    if (candidate.providerType === 'rss') {
      setProviderType('rss');
      const candidateFeed =
        typeof candidate.providerConfig?.feedUrl === 'string' ? candidate.providerConfig.feedUrl : '';
      if (candidateFeed) setFeedUrl(candidateFeed);
    }
  };

  const doSyncCatalog = async () => {
    setMessage(null);
    try {
      await syncCatalog.mutateAsync();
      setMessage('已派发目录同步任务，稍等片刻刷新即可看到最新收录');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '同步失败');
    }
  };

  const doCreate = async () => {
    if (!selected) return;
    setMessage(null);
    try {
      await createAccount.mutateAsync({
        name: selected.name,
        biz: selected.biz || undefined,
        avatarUrl: selected.avatarUrl ?? '',
        intro: selected.intro,
        providerType,
        providerConfig:
          providerType === 'rss'
            ? { feedUrl }
            : providerType === 'rsshub'
              ? { route, baseUrl: baseUrl || undefined }
              : {},
        initialFetch: true,
      });
      setKeyword('');
      setCandidates(null);
      setSelected(null);
      setFeedUrl('');
      setRoute('');
      setBaseUrl('');
      setMessage('已添加，抓取任务已开始执行');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '添加失败');
    }
  };

  const doImport = async () => {
    setMessage(null);
    if (!importUrl.trim()) return;
    try {
      await importArticle.mutateAsync(importUrl.trim());
      setImportUrl('');
      setMessage('已提交导入，稍后刷新即可看到文章');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败');
    }
  };

  const startEdit = (account: NonNullable<typeof accounts>[number]) => {
    const config = (account.providerConfig ?? {}) as Record<string, unknown>;
    setEditingId(account.id);
    setEditForm({
      providerType: (account.providerType as 'manual' | 'rss' | 'rsshub') ?? 'manual',
      feedUrl: typeof config.feedUrl === 'string' ? config.feedUrl : '',
      route: typeof config.route === 'string' ? config.route : '',
      baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : '',
    });
  };

  const saveEdit = async (id: string) => {
    setMessage(null);
    try {
      await updateAccount.mutateAsync({
        id,
        body: {
          providerType: editForm.providerType,
          providerConfig:
            editForm.providerType === 'rss'
              ? { feedUrl: editForm.feedUrl }
              : editForm.providerType === 'rsshub'
                ? { route: editForm.route, baseUrl: editForm.baseUrl || undefined }
                : {},
        },
      });
      setEditingId(null);
      setMessage('数据源配置已更新');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  };

  return (
    <div>
      <PageHeader title="公众号管理" subtitle="添加、配置与手动抓取" />
      <div className="space-y-4 px-4 sm:px-0">
        <AdminTabs />

        <Card className="p-4">
          <SectionTitle title="添加公众号" />
          <div className="flex gap-2">
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="输入公众号名称，或粘贴一篇文章链接"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void doLookup();
              }}
            />
            <Button onClick={() => void doLookup()} loading={lookup.isPending}>
              查询
            </Button>
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            名称搜索优先匹配内置 RSS 目录（decemberpei + wechat2rss，约 700 个号）；未命中时直接粘贴该号任意文章链接即可完成绑定。
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>
              目录收录 {catalog?.count ?? 0} 个公众号
              {catalog?.lastSyncedAt ? ` · 同步于 ${relativeTime(catalog.lastSyncedAt)}` : ' · 尚未同步'}
            </span>
            <button
              type="button"
              className="text-brand-600 disabled:opacity-50"
              disabled={syncCatalog.isPending}
              onClick={() => void doSyncCatalog()}
            >
              {syncCatalog.isPending ? '派发中…' : '立即同步'}
            </button>
          </div>

          {candidates && candidates.length > 0 ? (
            <div className="mt-3 space-y-2">
              {candidates.map((candidate) => (
                <button
                  key={candidate.biz || String(candidate.providerConfig?.feedUrl ?? candidate.name)}
                  type="button"
                  onClick={() => selectCandidate(candidate)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected?.biz === candidate.biz
                      ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10'
                      : 'border-zinc-200 dark:border-zinc-700'
                  }`}
                >
                  {candidate.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={candidate.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-9 rounded-full" />
                  ) : (
                    <div className="flex size-9 items-center justify-center rounded-full bg-zinc-100 text-xs dark:bg-zinc-800">
                      {candidate.name.slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{candidate.name}</div>
                    <div className="truncate text-xs text-zinc-500">{candidate.intro ?? candidate.biz}</div>
                  </div>
                  <Badge>
                    {candidate.source === 'search' ? '搜索' : candidate.source === 'catalog' ? '目录' : '链接'}
                  </Badge>
                </button>
              ))}
            </div>
          ) : null}

          {selected ? (
            <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <Field label="文章发现方式" hint="免费方案推荐先用 manual，配合自建 RSS 服务时选择 rss / rsshub">
                <Select value={providerType} onChange={(event) => setProviderType(event.target.value as typeof providerType)}>
                  <option value="manual">手动导入（不自动发现）</option>
                  <option value="rss">RSS / Atom 订阅地址</option>
                  <option value="rsshub">RSSHub 路由</option>
                </Select>
              </Field>

              {providerType === 'rss' ? (
                <Field label="订阅地址" hint="自建服务（如公众号转 RSS 项目）提供的 Feed 地址">
                  <Input value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} placeholder="https://..." />
                </Field>
              ) : null}

              {providerType === 'rsshub' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="RSSHub 路由" hint="例如 /wechat/xxx">
                    <Input value={route} onChange={(event) => setRoute(event.target.value)} placeholder="/wechat/..." />
                  </Field>
                  <Field label="实例地址" hint="留空则使用全局配置">
                    <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://rsshub.example.com" />
                  </Field>
                </div>
              ) : null}

              <Button onClick={() => void doCreate()} loading={createAccount.isPending}>
                确认添加并开始抓取
              </Button>
            </div>
          ) : null}

          {message ? (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              {message}
            </div>
          ) : null}
        </Card>

        <Card className="p-4">
          <SectionTitle title="手动导入文章" />
          <div className="flex gap-2">
            <Input
              value={importUrl}
              onChange={(event) => setImportUrl(event.target.value)}
              placeholder="粘贴公众号文章链接"
            />
            <Button variant="secondary" onClick={() => void doImport()} loading={importArticle.isPending}>
              导入
            </Button>
          </div>
        </Card>

        <Card>
          <div className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold dark:border-zinc-800">
            已添加的公众号
          </div>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="text-zinc-400" />
            </div>
          ) : !accounts || accounts.length === 0 ? (
            <EmptyState title="还没有公众号" description="使用上方的输入框添加第一个公众号。" />
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {accounts.map((account) => (
                <div key={account.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{account.name}</span>
                        {account.status === 'error' ? <Badge tone="danger">异常</Badge> : null}
                        {account.status === 'paused' ? <Badge>已暂停</Badge> : <Badge tone="success">启用</Badge>}
                        <Badge tone="neutral">{account.providerType}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {account.articleCount} 篇 ·{' '}
                        {account.lastSuccessAt ? `上次成功 ${relativeTime(account.lastSuccessAt)}` : '尚未成功抓取'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void fetchAccount.mutate({ id: account.id })}
                      loading={fetchAccount.isPending}
                    >
                      <RefreshIcon className="size-4" />
                      立即抓取
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void updateAccount.mutate({
                          id: account.id,
                          body: { status: account.status === 'paused' ? 'active' : 'paused' },
                        })
                      }
                    >
                      {account.status === 'paused' ? '启用' : '暂停'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => (editingId === account.id ? setEditingId(null) : startEdit(account))}
                    >
                      {editingId === account.id ? '收起配置' : '数据源配置'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(`确定删除「${account.name}」及其文章吗？`)) {
                          void deleteAccount.mutate(account.id);
                        }
                      }}
                    >
                      <TrashIcon className="size-4" />
                      删除
                    </Button>
                  </div>

                  {editingId === account.id ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                      <Field label="文章发现方式">
                        <Select
                          value={editForm.providerType}
                          onChange={(event) =>
                            setEditForm({ ...editForm, providerType: event.target.value as typeof editForm.providerType })
                          }
                        >
                          <option value="manual">手动导入（不自动发现）</option>
                          <option value="rss">RSS / Atom 订阅地址</option>
                          <option value="rsshub">RSSHub 路由</option>
                        </Select>
                      </Field>

                      {editForm.providerType === 'rss' ? (
                        <Field label="订阅地址">
                          <Input
                            value={editForm.feedUrl}
                            onChange={(event) => setEditForm({ ...editForm, feedUrl: event.target.value })}
                            placeholder="https://..."
                          />
                        </Field>
                      ) : null}

                      {editForm.providerType === 'rsshub' ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="RSSHub 路由">
                            <Input
                              value={editForm.route}
                              onChange={(event) => setEditForm({ ...editForm, route: event.target.value })}
                              placeholder="/wechat/..."
                            />
                          </Field>
                          <Field label="实例地址">
                            <Input
                              value={editForm.baseUrl}
                              onChange={(event) => setEditForm({ ...editForm, baseUrl: event.target.value })}
                              placeholder="https://rsshub.example.com"
                            />
                          </Field>
                        </div>
                      ) : null}

                      <Button size="sm" loading={updateAccount.isPending} onClick={() => void saveEdit(account.id)}>
                        保存配置
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="flex items-center gap-2 pb-4 text-xs text-zinc-400">
          <PlusIcon className="size-4" />
          添加后会自动执行一次回溯抓取（默认 3 天）
        </div>
      </div>
    </div>
  );
}
