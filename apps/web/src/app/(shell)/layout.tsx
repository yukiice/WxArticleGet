import { NavShell } from '@/components/nav-shell';

export const dynamic = 'force-dynamic';

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <NavShell>{children}</NavShell>;
}

