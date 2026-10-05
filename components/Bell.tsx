'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/** Shows how many unread alerts you have. Checks again every 30 seconds and when you come back to the tab. */
export function Bell({ userId, initial, floating = false }: { userId: string; initial: number; floating?: boolean }) {
  const [n, setN] = useState(initial);
  const path = usePathname();

  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    async function check() {
      if (document.visibilityState !== 'visible') return;
      const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null);
      if (alive && count != null) setN(count);
    }
    check();
    const t = setInterval(check, 30000);
    document.addEventListener('visibilitychange', check);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', check); };
  }, [userId, path]);

  const label = n ? `${n} new alert${n === 1 ? '' : 's'}` : 'Alerts';
  return (
    <Link href="/notifications" className={floating ? 'bell-float' : `bell ${path.startsWith('/notifications') ? 'on' : ''}`} aria-label={label}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
      </svg>
      {!floating && <span>Alerts</span>}
      {n > 0 && <span className="badge">{n > 99 ? '99+' : n}</span>}
    </Link>
  );
}
