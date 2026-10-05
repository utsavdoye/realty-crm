import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { isManager } from '@/lib/roles';
import { fmtTime, istAt, istDay } from '@/lib/crm';

export const metadata = { title: 'Site visits' };

type V = { id: string; at: string; status: string; feedback: string | null; agent_id: string | null; lead_id: string; leads: { name: string } | null; projects: { name: string } | null };

export default async function Visits({ searchParams }: { searchParams: { tab?: string } }) {
  const { supabase, org, role } = await requireOrg();
  const past = searchParams.tab === 'past';
  let q = supabase.from('visits').select('id, at, status, feedback, agent_id, lead_id, leads(name), projects(name)').eq('org_id', org.id);
  q = past ? q.neq('status', 'scheduled').order('at', { ascending: false }).limit(200) : q.eq('status', 'scheduled').order('at').limit(300);
  const [{ data }, { data: people }, done, noshow] = await Promise.all([
    q,
    supabase.from('members').select('user_id, full_name').eq('org_id', org.id),
    supabase.from('visits').select('id', { count: 'exact', head: true }).eq('org_id', org.id).eq('status', 'done').gte('at', istAt(-30, 0)),
    supabase.from('visits').select('id', { count: 'exact', head: true }).eq('org_id', org.id).eq('status', 'noshow').gte('at', istAt(-30, 0)),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const list = (data ?? []) as unknown as V[];
  const groups = new Map<string, V[]>();
  list.forEach((v) => { const k = istDay(v.at); groups.set(k, [...(groups.get(k) ?? []), v]); });
  const showRate = (done.count ?? 0) + (noshow.count ?? 0);
  const todayKey = istDay(new Date());
  return (
    <>
      <div className="top">
        <h1>Site visits</h1>
        <div className="seg"><Link href="/visits" className={!past ? 'on' : ''}>Upcoming</Link><Link href="/visits?tab=past" className={past ? 'on' : ''}>Done and missed</Link></div>
      </div>
      <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
        Last 30 days: {done.count ?? 0} done, {noshow.count ?? 0} did not come{showRate ? ` · ${Math.round(((done.count ?? 0) / showRate) * 100)}% showed up` : ''}. To book a visit, open the lead.
        {!isManager(role) && ' You see visits for your own leads.'}
      </p>
      <section className="panel">
        {groups.size ? [...groups.entries()].map(([day, vs]) => (
          <div key={day}>
            <div className="day-h">{day === todayKey ? 'Today · ' : ''}{new Date(day + 'T00:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}</div>
            <div className="rows">
              {vs.map((v) => (
                <Link key={v.id} href={`/leads/${v.lead_id}#visit`} className="callrow">
                  <span className="vtime mono">{fmtTime(v.at)}</span>
                  <span className="cr-main">
                    <b>{v.leads?.name ?? 'Lead'}</b>
                    <span className="hint">{v.projects?.name ?? 'Project not set'}{v.agent_id ? ' · ' + (nameOf.get(v.agent_id) ?? '') : ''}{v.feedback ? ` · “${v.feedback}”` : ''}</span>
                  </span>
                  {v.status !== 'scheduled' && <span className={`chip ${v.status === 'done' ? 'good' : 'bad'}`}>{v.status === 'done' ? 'Done' : v.status === 'noshow' ? 'Did not come' : 'Cancelled'}</span>}
                  {v.status === 'scheduled' && v.at < new Date().toISOString() && <span className="chip tape">Update result</span>}
                </Link>
              ))}
            </div>
          </div>
        )) : <p className="empty">{past ? 'No finished visits yet.' : 'No visits booked. Open a lead and press Book visit.'}</p>}
      </section>
    </>
  );
}
