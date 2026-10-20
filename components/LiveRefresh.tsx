'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/** Reloads the page data when the given tables change (Supabase Realtime), and every 15 seconds as a fallback. */
export function LiveRefresh({ tables, orgId }: { tables: string[]; orgId: string }) {
  const router = useRouter();
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = tables.join(',');
  useEffect(() => {
    const supabase = createClient();
    const soon = () => { if (t.current) clearTimeout(t.current); t.current = setTimeout(() => router.refresh(), 300); };
    let ch = supabase.channel(`live-${key}-${orgId}`);
    key.split(',').forEach((table) => { ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, soon); });
    ch.subscribe();
    const every = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, 15000);
    return () => { clearInterval(every); if (t.current) clearTimeout(t.current); supabase.removeChannel(ch); };
  }, [key, orgId, router]);
  return null;
}
