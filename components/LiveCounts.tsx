'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Counts = { votes: Record<string, number>; saves: Record<string, number> };
const Ctx = createContext<Counts>({ votes: {}, saves: {} });

function tally(rows: { project_id: string }[] | null) {
  const m: Record<string, number> = {};
  (rows ?? []).forEach((r) => { m[r.project_id] = (m[r.project_id] ?? 0) + 1; });
  return m;
}

/** Upvotes and saves from the website, updated live: a change shows here within about a second (Supabase Realtime, patch-028).
 *  If Realtime is not on, it still checks every 10 seconds and whenever you come back to the tab. */
export function LiveCounts({ orgId, initial, children }: { orgId: string; initial: Counts; children: React.ReactNode }) {
  const [counts, setCounts] = useState<Counts>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    const load = async () => {
      const [v, s] = await Promise.all([
        supabase.from('project_votes').select('project_id').limit(50000),
        supabase.from('website_saves').select('project_id').eq('org_id', orgId).limit(50000),
      ]);
      if (!alive) return;
      setCounts((c) => ({ votes: v.error ? c.votes : tally(v.data), saves: s.error ? c.saves : tally(s.data) }));
    };
    const soon = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(load, 150); };
    const channel = supabase.channel(`live-counts-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_votes' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'website_saves' }, soon)
      .subscribe();
    const every = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 10000);
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false; clearInterval(every); if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus);
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  return <Ctx.Provider value={counts}>{children}</Ctx.Provider>;
}

export function LiveCount({ kind, id }: { kind: 'votes' | 'saves'; id: string }) {
  const c = useContext(Ctx);
  return <>{c[kind][id] ?? 0}</>;
}
