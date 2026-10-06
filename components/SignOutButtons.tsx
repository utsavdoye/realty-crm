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
  if (compact) return (
    <button className="btn ghost sm side-out" disabled={busy} onClick={() => out('local')} data-label="Log out">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" /></svg>
      <span>Log out</span>
    </button>
  );
  return (
    <div className="row-gap">
      <button className="btn" disabled={busy} onClick={() => out('local')}>Log out on this device</button>
      <button className="btn danger" disabled={busy} onClick={() => out('global')}>Log out everywhere</button>
    </div>
  );
}
