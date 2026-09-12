'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { endpoints } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { ChartIcon, HomeIcon, LogoutIcon, SettingsIcon, SparkIcon, UsersIcon } from './icons';
import { ThemeToggle } from './theme-toggle';

const NAV_ITEMS = [
  { href: '/', label: '阅读', icon: HomeIcon, adminOnly: false },
  { href: '/daily', label: '日报', icon: SparkIcon, adminOnly: false },
  { href: '/accounts', label: '公众号', icon: UsersIcon, adminOnly: false },
  { href: '/admin', label: '管理', icon: SettingsIcon, adminOnly: true },
];

export function isAdminRole(role?: string): boolean {
  return role === 'super' || role === 'admin';
}

export function NavShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const client = useQueryClient();
  const { data: me } = useMe();
  const navItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdminRole(me?.role));

  const logout = async () => {
    await endpoints.logout().catch(() => undefined);
    client.clear();
    router.push('/login');
  };

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-950">
      {/* 桌面端侧边栏 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-zinc-200 bg-white px-3 py-5 lg:flex dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 px-2">
          <div className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">公众号阅读器</div>
          <div className="mt-0.5 text-[11px] text-zinc-400">聚合 · 总结 · 邮件</div>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive(item.href)
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-500'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
              )}
            >
              <item.icon className="size-[18px]" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex size-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="退出登录"
          >
            <LogoutIcon className="size-5" />
          </button>
        </div>
      </aside>

      {/* 移动端顶栏 */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-200 bg-white/85 px-4 backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-900/85">
        <span className="text-[15px] font-bold">公众号阅读器</span>
        <ThemeToggle />
      </header>

      <main className="lg:pl-56">
        <div className="mx-auto w-full max-w-3xl px-0 pb-24 sm:px-6 lg:pb-12">{children}</div>
      </main>

      {/* 移动端底部导航 */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-900/95">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
              isActive(item.href) ? 'text-brand-600' : 'text-zinc-400',
            )}
          >
            <item.icon className="size-[22px]" />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function AdminTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: '/admin', label: '概览' },
    { href: '/admin/accounts', label: '公众号' },
    { href: '/admin/logs', label: '任务日志' },
    { href: '/admin/settings', label: '设置' },
  ];

  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            'shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
            pathname === tab.href
              ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, extra }: { title: string; subtitle?: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 pb-3 pt-5 sm:px-0">
      <div>
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{title}</h1>
        {subtitle ? <p className="mt-1 text-xs text-zinc-500">{subtitle}</p> : null}
      </div>
      {extra}
    </div>
  );
}

export { ChartIcon };
