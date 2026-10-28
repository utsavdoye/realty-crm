import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { isManager } from '@/lib/roles';
import { istAt } from '@/lib/crm';
import { FollowupList, type FuRow } from '@/components/FollowupList';

export const metadata = { title: 'Follow-ups' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = [['over', 'Overdue'], ['today', 'Today'], ['week', 'Next 7 days'], ['done', 'Done']] as const;

export default async function Followups({ searchParams }: { searchParams: { tab?: string; agent?: string } }) {
  const { supabase, org, role, user } = await requireOrg();
  const mgr = isManager(role);
  const tab = TABS.some(([k]) => k === searchParams.tab) ? searchParams.tab! : 'today';
  const agent = mgr ? (searchParams.agent === 'me' ? user.id : UUID.test(searchParams.agent ?? '') ? searchParams.agent! : '') : '';
  const now = new Date().toISOString(), endToday = istAt(1, 0), endWeek = istAt(8, 0);

  // Follow-up tasks
  let t = supabase.from('followups').select('id, lead_id, title, kind, due_at, done_at, assigned_to, leads(name, phone, stage)').eq('org_id', org.id);
  if (tab === 'done') t = t.not('done_at', 'is', null).order('done_at', { ascending: false }).limit(100);
  else {
    t = t.is('done_at', null);
    t = tab === 'over' ? t.lt('due_at', now) : tab === 'today' ? t.gte('due_at', now).lt('due_at', endToday) : t.gte('due_at', endToday).lt('due_at', endWeek);
    t = t.order('due_at').limit(300);
  }
  if (agent) t = t.eq('assigned_to', agent);

  // The lead's own "call back" reminders (from the call popup)
  let l = supabase.from('leads').select('id, name, phone, next_follow_up, assigned_to').eq('org_id', org.id).not('stage', 'in', '(booked,lost)').not('next_follow_up', 'is', null);
  l = tab === 'over' ? l.lt('next_follow_up', now) : tab === 'today' ? l.gte('next_follow_up', now).lt('next_follow_up', endToday) : l.gte('next_follow_up', endToday).lt('next_follow_up', endWeek);
  if (agent) l = l.eq('assigned_to', agent);
  l = l.order('next_follow_up').limit(300);

  const [{ data: tasks, error: tErr }, { data: leads }, { data: people }, counts] = await Promise.all([
    t, tab === 'done' ? Promise.resolve({ data: [] as { id: string; name: string; phone: string; next_follow_up: string; assigned_to: string | null }[] }) : l,
    supabase.from('members').select('user_id, full_name, role, active').eq('org_id', org.id),
    Promise.all([
      supabase.from('followups').select('id', { count: 'exact', head: true }).eq('org_id', org.id).is('done_at', null).lt('due_at', now),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('org_id', org.id).not('stage', 'in', '(booked,lost)').lt('next_follow_up', now),
    ]),
  ]);
  const who = new Map((people ?? []).map((p) => [p.user_id, p.full_name as string]));
  type T = { id: string; lead_id: string; title: string; kind: string; due_at: string; done_at: string | null; assigned_to: string | null; leads: { name: string; phone: string } | null };
  const taskRows: FuRow[] = ((tasks ?? []) as unknown as T[]).map((x) => ({ id: x.id, leadId: x.lead_id, leadName: x.leads?.name ?? 'Lead', phone: x.leads?.phone ?? '', title: x.title, kind: x.kind, due_at: x.due_at, done_at: x.done_at, agent: x.assigned_to ? who.get(x.assigned_to) ?? null : null, isTask: true }));
  // a lead whose next follow-up IS one of its tasks shows only once
  const taskKey = new Set(taskRows.map((r) => `${r.leadId}|${Date.parse(r.due_at)}`));
  const leadRows: FuRow[] = (leads ?? []).filter((x) => !taskKey.has(`${x.id}|${Date.parse(x.next_follow_up)}`))
    .map((x) => ({ id: x.id, leadId: x.id, leadName: x.name, phone: x.phone, title: 'Next call', kind: 'call', due_at: x.next_follow_up, done_at: null, agent: x.assigned_to ? who.get(x.assigned_to) ?? null : null, isTask: false }));
  const rows = [...taskRows, ...leadRows].sort((a, b) => tab === 'done' ? 0 : Date.parse(a.due_at) - Date.parse(b.due_at));
  const overdue = (counts[0].count ?? 0) + (counts[1].count ?? 0);
  const href = (k: string) => `/followups?tab=${k}${agent && mgr ? `&agent=${agent === user.id ? 'me' : agent}` : ''}`;

  return (
    <>
      <div className="top">
        <div className="top-title"><h1>Follow-ups</h1><span className="muted">Every call back, meeting and task, by day.{overdue ? ` ${overdue} overdue.` : ''}</span></div>
        {mgr && (
          <form className="row-btns" action="/followups">
            <input type="hidden" name="tab" value={tab} />
            <select name="agent" defaultValue={searchParams.agent ?? ''} aria-label="Person">
              <option value="">Everyone</option><option value="me">Mine</option>
              {(people ?? []).filter((p) => p.active && p.role !== 'partner').map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
            </select>
            <button className="btn sm">Show</button>
          </form>
        )}
      </div>
      {tErr && /followups/.test(tErr.message) && <p className="msg err" style={{ marginBottom: 12 }}>Run <b>supabase/patch-042-followups-call-status.sql</b> in Supabase to use follow-up tasks. Call-back reminders still show below.</p>}
      <div className="seg" role="tablist" style={{ marginBottom: 14 }}>
        {TABS.map(([k, label]) => <Link key={k} href={href(k)} className={tab === k ? 'on' : ''}>{label}</Link>)}
      </div>
      <section className="panel">
        <FollowupList rows={rows} voice={Boolean(process.env.GEMINI_API_KEY)} showAgent={mgr} />
      </section>
    </>
  );
}
