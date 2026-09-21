'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Spinner } from '@/components/ui';
import { isAdminRole } from '@/components/nav-shell';
import { useMe } from '@/lib/queries';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  const router = useRouter();
  const allowed = isAdminRole(me?.role);

  useEffect(() => {
    if (me && !allowed) router.replace('/');
  }, [me, allowed, router]);

  if (isLoading || (!me && !allowed)) {
    return (
      <Card className="mt-16 flex justify-center py-16">
        <Spinner className="text-zinc-400" />
      </Card>
    );
  }

  if (!allowed) return null;
  return <>{children}</>;
}
