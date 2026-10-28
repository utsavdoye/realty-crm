import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { fmtPhone, isManager } from '@/lib/roles';
import { ColdImport, ColdList, type ColdRow } from '@/components/ColdTools';

export const metadata = { title: 'Cold data' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = [['todo', 'To call'], ['due', 'Call back due'], ['interested', 'Interested'], ['done', 'Closed'], ['all', 'All']] as const;

export default async function Cold({ searchParams }: { searchParams: { tab?: string; list?: string; agent?: string } }) {
  const { supabase, org, role, user } = await requireOrg();
  const mgr = isManager(role);
  const tab = TABS.some(([k]) => k === searchParams.tab) ? searchParams.tab! : 'todo';
  const list = (searchParams.list ?? '').slice(0, 80);
  const agent = mgr && UUID.test(searchParams.agent ?? '') ? searchParams.agent! : '';
  const now = new Date().toISOString();

  let q = supabase.from('cold_contacts').select('id, name, phone, area, note, list_name, status, attempts, called_at, callback_at, lead_id, assigned_to').eq('org_id', org.id);
  if (!mgr) q = q.eq('assigned_to', user.id);
  if (agent) q = q.eq('assigned_to', agent);
  if (list) q = q.eq('list_name', list);
  if (tab === 'todo') q = q.or(`status.eq.new,and(status.in.(noanswer,callback),callback_at.lte.${now})`).order('status').order('created_at');
  else if (tab === 'due') q = q.in('status', ['noanswer', 'callback']).order('callback_at', { nullsFirst: false });
  else if (tab === 'interested') q = q.eq('status', 'interested').order('called_at', { ascending: false });
  else if (tab === 'done') q = q.in('status', ['notint', 'wrong']).order('called_at', { ascending: false });
  else q = q.order('created_at', { ascending: false });
  q = q.limit(200);

  const [{ data, error }, { data: people }, { data: stats }] = await Promise.all([
    q,
    supabase.from('members').select('user_id, full_name, role, active').eq('org_id', org.id).eq('active', true).neq('role', 'partner').order('full_name'),
    supabase.from('cold_contacts').select('list_name, status').eq('org_id', org.id).limit(20000),
  ]);
  const notRun = !!error && /cold_contacts/.test(error.message);
  const who = new Map((people ?? []).map((p) => [p.user_id, p.full_name as string]));
  const agents = (people ?? []).map((p) => ({ id: p.user_id as string, name: p.full_name as string }));
  const lists = [...new Set((stats ?? []).map((s) => s.list_name as string))].sort();
  const st = (stats ?? []) as { list_name: string; status: string }[];
  const total = st.length, called = st.filter((s) => s.status !== 'new').length, interested = st.filter((s) => s.status === 'interested').length;
  const rows: ColdRow[] = (data ?? []).map((c) => ({ id: c.id, name: c.name, phone: c.phone, phoneText: fmtPhone(c.phone), area: c.area, note: c.note, list: c.list_name, status: c.status, attempts: c.attempts, called_at: c.called_at, callback_at: c.callback_at, lead_id: c.lead_id, agent: c.assigned_to ? who.get(c.assigned_to) ?? null : null }));
  const href = (k: string) => `/cold?tab=${k}${list ? `&list=${encodeURIComponent(list)}` : ''}${agent ? `&agent=${agent}` : ''}`;

  return (
    <>
      <div className="top">
        <div className="top-title"><h1>Cold data</h1><span className="muted">Numbers to call that are not leads yet. Interested ones become leads in one tap.</span></div>
      </div>
      {notRun && <p className="msg err" style={{ marginBottom: 16 }}>Run <b>supabase/patch-045-attendance-cold-docs.sql</b> in Supabase → SQL Editor first.</p>}
      {mgr && total > 0 && (
        <div className="kpis" style={{ marginBottom: 14 }}>
          <div className="kpi"><span className="label">Numbers</span><span className="n">{total}</span></div>
          <div className="kpi"><span className="label">Called</span><span className="n">{called}</span><span className="hint">{total ? Math.round((called / total) * 100) : 0}%</span></div>
          <div className="kpi"><span className="label">Became leads</span><span className="n">{interested}</span><span className="hint">{called ? ((interested / called) * 100).toFixed(1) : 0}% of called</span></div>
        </div>
      )}
      {mgr && (
        <details className="panel" style={{ marginBottom: 14 }} open={!total}>
          <summary className="panel-h" style={{ cursor: 'pointer' }}><h2>Upload numbers</h2><span className="hint">Excel or CSV</span></summary>
          <div className="panel-b"><ColdImport agents={agents} /></div>
        </details>
      )}
      <div className="row-btns" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="seg" role="tablist">{TABS.map(([k, l]) => <Link key={k} href={href(k)} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
        {(lists.length > 1 || (mgr && agents.length)) && (
          <form action="/cold" className="row-btns">
            <input type="hidden" name="tab" value={tab} />
            {lists.length > 1 && <select name="list" defaultValue={list} aria-label="List"><option value="">All lists</option>{lists.map((l) => <option key={l}>{l}</option>)}</select>}
            {mgr && <select name="agent" defaultValue={agent} aria-label="Caller"><option value="">Every caller</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
            <button className="btn sm">Show</button>
          </form>
        )}
      </div>
      <section className="panel">{rows.length ? <ColdList rows={rows} agents={agents} mgr={mgr} /> : <p className="empty">{tab === 'todo' ? 'Nothing to call right now.' : 'Nothing here.'}</p>}</section>
    </>
  );
}
