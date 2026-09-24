'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminTabs, PageHeader, isAdminRole } from '@/components/nav-shell';
import { Badge, Button, Card, Field, Input, SectionTitle, Select, Spinner } from '@/components/ui';
import {
  useAccounts,
  useChangePassword,
  useCreateUser,
  useDeleteUser,
  useFetchAccount,
  useMe,
  useRunSummary,
  useSendDigestNow,
  useStats,
  useUpdateUser,
  useUsers,
} from '@/lib/queries';
import { relativeTime } from '@/lib/utils';

export default function AdminOverviewPage() {
  const { data: stats, isLoading } = useStats();
  const { data: accounts } = useAccounts();
  const fetchAccount = useFetchAccount();
  const runSummary = useRunSummary();
  const sendDigest = useSendDigestNow();

  const fetchAll = async () => {
    for (const account of accounts ?? []) {
      await fetchAccount.mutateAsync({ id: account.id }).catch(() => undefined);
    }
  };

  return (
    <div>
      <PageHeader title="管理" subtitle="运行状态与快捷操作" />
      <div className="px-4 sm:px-0">
        <AdminTabs />

        {isLoading ? (
          <Card className="flex justify-center py-16">
            <Spinner className="text-zinc-400" />
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="今日新增" value={stats?.todayArticles ?? 0} />
              <StatCard label="文章总数" value={stats?.totalArticles ?? 0} />
              <StatCard label="未读" value={stats?.unreadArticles ?? 0} />
              <StatCard label="公众号" value={stats?.totalAccounts ?? 0} />
            </div>

            <Card className="mt-3 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">最近成功抓取</span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  {stats?.lastSuccessfulFetchAt ? relativeTime(stats.lastSuccessfulFetchAt) : '暂无记录'}
                </span>
              </div>
              {stats && stats.accountsWithError > 0 ? (
                <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10">
                  有 {stats.accountsWithError} 个账号处于异常状态，可到「公众号」页手动重试，或粘贴文章链接手动导入。
                </div>
              ) : null}
            </Card>

            <div className="mt-6">
              <SectionTitle title="快捷操作" />
              <Card className="divide-y divide-zinc-100 dark:divide-zinc-800">
                <ActionRow
                  title="抓取全部账号"
                  description="立即对所有公众号执行一次抓取"
                  action={
                    <Button size="sm" variant="secondary" loading={fetchAccount.isPending} onClick={() => void fetchAll()}>
                      执行
                    </Button>
                  }
                />
                <ActionRow
                  title="生成今日总结"
                  description="调用 DeepSeek 重新生成本日 AI 总结"
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={runSummary.isPending}
                      onClick={() => void runSummary.mutate({ force: true })}
                    >
                      执行
                    </Button>
                  }
                />
                <ActionRow
                  title="立即发送日报邮件"
                  description="按当前收件人与模板发送今天的文章"
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={sendDigest.isPending}
                      onClick={() => void sendDigest.mutate(undefined)}
                    >
                      执行
                    </Button>
                  }
                />
                <Link href="/admin/accounts" className="block px-4 py-3 text-sm text-brand-600">
                  添加 / 管理公众号 →
                </Link>
              </Card>
            </div>

            <AccountSection />
          </>
        )}
      </div>
    </div>
  );
}

function AccountSection() {
  const { data: me } = useMe();
  const isAdmin = isAdminRole(me?.role);

  return (
    <div className="mt-6">
      <SectionTitle title="账号" />
      <div className="grid gap-3 sm:grid-cols-2">
        <ChangePasswordCard />
        {isAdmin ? <CreateUserCard /> : null}
      </div>
      {isAdmin ? (
        <div className="mt-3">
          <UserListCard />
        </div>
      ) : null}
    </div>
  );
}

function UserListCard() {
  const { data: users } = useUsers();
  const { data: me } = useMe();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const iAmSuper = me?.role === 'super';
  // 显示层按层级收窄：总管理员看全部；管理员只看成员（自然不含自己、其他管理员与总管理员）
  const visibleUsers = (users ?? []).filter((user) => iAmSuper || user.role === 'member');

  const changeRole = async (id: string, role: 'admin' | 'member') => {
    setNotice(null);
    try {
      const updated = await updateUser.mutateAsync({ id, body: { role } });
      setNotice({ tone: 'ok', text: `已把「${updated.username}」设为${ROLE_LABEL[updated.role] ?? updated.role}` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '修改失败' });
    }
  };

  const remove = async (id: string, username: string) => {
    setNotice(null);
    try {
      await deleteUser.mutateAsync(id);
      setConfirmingId(null);
      setNotice({ tone: 'ok', text: `已删除账号「${username}」` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '删除失败' });
    }
  };

  return (
    <Card className="p-4">
      <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">账号管理</div>
      <div className="mt-0.5 text-xs text-zinc-500">
        {iAmSuper
          ? '可调整角色或删除账号；总管理员与当前登录账号不可修改。'
          : '这里只显示成员账号；管理员账号与角色调整由总管理员维护。'}
      </div>

      <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {visibleUsers.map((user) => {
          const isSuper = user.role === 'super';
          const isSelf = user.id === me?.sub;

          return (
            <div key={user.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{user.username}</span>
                {isSuper ? <Badge>总管理员</Badge> : null}
                {isSelf ? <span className="text-[11px] text-zinc-400">当前登录</span> : null}
              </div>

              {isSuper ? null : (
                <div className="flex items-center gap-2">
                  {iAmSuper ? (
                    <div className="w-28 shrink-0">
                      <Select
                        size="sm"
                        value={user.role}
                        disabled={isSelf || updateUser.isPending}
                        onChange={(event) => void changeRole(user.id, event.target.value as 'admin' | 'member')}
                      >
                        <option value="member">成员（只读）</option>
                        <option value="admin">管理员</option>
                      </Select>
                    </div>
                  ) : null}
                  {confirmingId === user.id ? (
                    <>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={deleteUser.isPending}
                        onClick={() => void remove(user.id, user.username)}
                      >
                        确认删除
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isSelf}
                      onClick={() => setConfirmingId(user.id)}
                    >
                      删除
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {users && visibleUsers.length === 0 ? (
          <div className="py-3 text-xs text-zinc-400">{iAmSuper ? '暂无账号' : '暂无成员账号'}</div>
        ) : null}
      </div>

      {notice ? (
        <div className="mt-3">
          <Notice tone={notice.tone} text={notice.text} />
        </div>
      ) : null}
    </Card>
  );
}

const ROLE_LABEL: Record<string, string> = {
  super: '总管理员',
  admin: '管理员',
  member: '成员',
};

function CreateUserCard() {
  const { data: users } = useUsers();
  const { data: me } = useMe();
  const createUser = useCreateUser();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const iAmSuper = me?.role === 'super';
  // 与账号管理列表同口径：管理员只展示成员
  const visibleUsers = (users ?? []).filter((user) => iAmSuper || user.role === 'member');
  const existingNames = visibleUsers
    .map((user) => `${user.username}（${ROLE_LABEL[user.role] ?? user.role}）`)
    .join('、');
  const existingFallback = iAmSuper ? '暂无账号' : '暂无成员账号';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);
    try {
      const created = await createUser.mutateAsync({ username, password, confirmPassword, role });
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      setRole('member');
      setNotice({ tone: 'ok', text: `已添加账号「${created.username}」，可立即登录` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '添加失败' });
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">添加账号</div>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          仅管理员
        </span>
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">
        已有账号：{users ? existingNames || existingFallback : '加载中…'}
      </div>
      <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-3">
        <Field label="用户名">
          <Input autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} required />
        </Field>
        <Field label="密码" hint="至少 8 位">
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </Field>
        <Field label="确认密码">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </Field>
        <Field
          label="角色"
          hint={
            iAmSuper
              ? '管理员可使用管理后台；成员仅能阅读'
              : '你添加的账号均为成员（只读），管理员由总管理员创建'
          }
        >
          <Select value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'member')}>
            <option value="member">成员（只读）</option>
            {iAmSuper ? <option value="admin">管理员</option> : null}
          </Select>
        </Field>
        {notice ? <Notice tone={notice.tone} text={notice.text} /> : null}
        <Button type="submit" size="sm" loading={createUser.isPending}>
          添加
        </Button>
      </form>
    </Card>
  );
}

function ChangePasswordCard() {
  const { data: me } = useMe();
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword, confirmPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice({ tone: 'ok', text: '密码已更新，下次登录请使用新密码' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '修改失败' });
    }
  };

  return (
    <Card className="p-4">
      <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">修改密码</div>
      <div className="mt-0.5 text-xs text-zinc-500">当前登录：{me?.username ?? '—'}</div>
      <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-3">
        <Field label="当前密码">
          <Input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </Field>
        <Field label="新密码" hint="至少 8 位">
          <Input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            minLength={8}
            required
          />
        </Field>
        <Field label="确认新密码">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </Field>
        {notice ? <Notice tone={notice.tone} text={notice.text} /> : null}
        <Button type="submit" size="sm" loading={changePassword.isPending}>
          保存
        </Button>
      </form>
    </Card>
  );
}

function Notice({ tone, text }: { tone: 'ok' | 'error'; text: string }) {
  return (
    <div
      className={
        tone === 'ok'
          ? 'rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
          : 'rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10'
      }
    >
      {text}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">{value}</div>
    </Card>
  );
}

function ActionRow({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{title}</div>
        <div className="mt-0.5 text-xs text-zinc-500">{description}</div>
      </div>
      {action}
    </div>
  );
}

