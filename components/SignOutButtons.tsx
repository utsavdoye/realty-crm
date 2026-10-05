'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function SignOutButtons({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function out(scope: 'local' | 'global') {
    setBusy(true);
    await createClient().auth.signOut({ scope });
    router.replace('/login');
    router.refresh();
  }
  if (compact) return <button className="btn ghost sm" disabled={busy} onClick={() => out('local')}>Log out</button>;
  return (
    <div className="row-gap">
      <button className="btn" disabled={busy} onClick={() => out('local')}>Log out on this device</button>
      <button className="btn danger" disabled={busy} onClick={() => out('global')}>Log out everywhere</button>
    </div>
  );
}
