import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { STAGES } from '@/lib/crm';

export const metadata = { title: 'Reports' };

type L = { stage: string; max_stage: number; source: string | null; assigned_to: string | null; lost_reason: string | null; next_follow_up: string | null; call_attempts: number };

export default async function Reports({ searchParams }: { searchParams: { days?: string } }) {
  const { supabase, org } = await requireOrg(['owner', 'manager']);
  const days = [7, 30, 90, 0].includes(Number(searchParams.days)) ? Number(searchParams.days ?? 30) : 30;
  const since = days ? new Date(Date.now() - days * 86400000).toISOString() : null;
  let lq = supabase.from('leads').select('stage, max_stage, source, assigned_to, lost_reason, next_follow_up, call_attempts').eq('org_id', org.id).limit(10000);
  let vq = supabase.from('visits').select('status, agent_id').eq('org_id', org.id).limit(10000);
  if (since) { lq = lq.gte('created_at', since); vq = vq.gte('at', since); }
  const open = '(booked,lost)';
  const [{ data: leadsRaw }, { data: visitsRaw }, { data: people }, { count: openOverdue }, { count: noNext }, { count: unassigned }, { count: stale }] = await Promise.all([
    lq, vq,
    supabase.from('members').select('user_id, full_name, role, active').eq('org_id', org.id),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('org_id', org.id).lt('next_follow_up', new Date().toISOString()).not('stage', 'in', open),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('org_id', org.id).is('next_follow_up', null).not('stage', 'in', '(new,booked,lost)'),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('org_id', org.id).is('assigned_to', null).not('stage', 'in', open),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('org_id', org.id).or(`last_activity_at.lt.${new Date(Date.now() - 14 * 86400000).toISOString()},and(last_activity_at.is.null,created_at.lt.${new Date(Date.now() - 14 * 86400000).toISOString()})`).not('stage', 'in', open),
  ]);
  const cleanup = [
    { n: openOverdue ?? 0, label: 'Follow-up time has passed', href: '/leads?fu=over' },
    { n: noNext ?? 0, label: 'Active, but no next call planned', href: '/leads?fu=none' },
    { n: unassigned ?? 0, label: 'Not given to anyone', href: '/leads?agent=none' },
    { n: stale ?? 0, label: 'Nobody touched them in 14+ days', href: '/leads?fu=stale' },
  ];
  const leads = (leadsRaw ?? []) as L[];
  const visits = visitsRaw ?? [];
  const total = leads.length;
  const reached = (i: number) => leads.filter((l) => (l.stage === 'lost' ? l.max_stage : Math.max(l.max_stage, STAGES.findIndex((s) => s.k === l.stage))) >= i).length;
  const funnel = STAGES.map((s, i) => ({ ...s, n: reached(i) }));
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  const bySource = new Map<string, L[]>();
  leads.forEach((l) => { const k = l.source || 'Not set'; bySource.set(k, [...(bySource.get(k) ?? []), l]); });
  const srcRows = [...bySource.entries()].map(([k, ls]) => ({
    k, n: ls.length, contacted: ls.filter((l) => l.max_stage >= 1).length, visited: ls.filter((l) => l.max_stage >= 4).length, booked: ls.filter((l) => l.stage === 'booked').length,
  })).sort((a, b) => b.n - a.n);
  const maxSrc = Math.max(1, ...srcRows.map((r) => r.n));

  const team = (people ?? []).filter((p) => p.role !== 'partner').map((p) => {
    const ls = leads.filter((l) => l.assigned_to === p.user_id);
    return {
      name: p.full_name + (p.active ? '' : ' (removed)'), n: ls.length, contacted: ls.filter((l) => l.max_stage >= 1).length,
      calls: ls.reduce((s, l) => s + (l.call_attempts || 0), 0),
      visits: visits.filter((v) => v.agent_id === p.user_id && v.status === 'done').length,
      booked: ls.filter((l) => l.stage === 'booked').length,
    };
  }).filter((r) => r.n || r.visits);

  const lost = new Map<string, number>();
  leads.filter((l) => l.stage === 'lost').forEach((l) => lost.set(l.lost_reason || 'No reason', (lost.get(l.lost_reason || 'No reason') ?? 0) + 1));
  const lostRows = [...lost.entries()].sort((a, b) => b[1] - a[1]);
  const maxLost = Math.max(1, ...lostRows.map((r) => r[1]));
  const vDone = visits.filter((v) => v.status === 'done').length;
  const vNo = visits.filter((v) => v.status === 'noshow').length;

  return (
    <>
      <div className="top">
        <h1>Reports</h1>
        <div className="seg">{[[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All time']].map(([d, l]) => <Link key={d} href={`/reports?days=${d}`} className={days === d ? 'on' : ''}>{l}</Link>)}</div>
      </div>
      <div className="kpis">
        <div className="kpi"><span className="label">Leads in</span><span className="n">{total}</span></div>
        <div className="kpi"><span className="label">Reached by phone</span><span className="n">{pct(funnel[1].n, total)}</span></div>
        <div className="kpi"><span className="label">Visits done</span><span className="n">{vDone}</span><span className="hint">{vDone + vNo ? `${pct(vDone, vDone + vNo)} showed up` : ''}</span></div>
        <div className="kpi"><span className="label">Bookings</span><span className="n">{funnel[7].n}</span><span className="hint">{total ? `${((funnel[7].n / total) * 100).toFixed(1)}% of leads` : ''}</span></div>
        <div className={`kpi ${openOverdue ? 'alert' : ''}`}><span className="label">Overdue right now</span><span className="n">{openOverdue ?? 0}</span></div>
      </div>
      <div className="grid-main">
        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Where leads drop off</h2><span className="hint">How many reached each stage</span></div>
            <div className="panel-b funnel">
              {total ? funnel.map((s, i) => (
                <div key={s.k} className="fbar">
                  <span>{s.l}</span>
                  <span className="track"><span className={`fill ${s.k === 'booked' ? 'booked' : ''}`} style={{ width: `${(s.n / total) * 100}%` }} /></span>
                  <span className="num mono">{s.n}{i ? ` · ${pct(s.n, funnel[i - 1].n)}` : ''}</span>
                </div>
              )) : <p className="hint">No leads in this period.</p>}
              {total > 0 && <p className="hint">The % on the right is how many moved on from the stage above.</p>}
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Which source works</h2></div>
            <div className="table-wrap"><table className="tbl">
              <thead><tr><th>Source</th><th className="n">Leads</th><th></th><th className="n">Reached</th><th className="n">Visited</th><th className="n">Booked</th></tr></thead>
              <tbody>{srcRows.length ? srcRows.map((r) => (
                <tr key={r.k}><td>{r.k}</td><td className="n">{r.n}</td><td style={{ width: 90 }}><span className="hbar" style={{ width: `${(r.n / maxSrc) * 100}%` }} /></td><td className="n">{pct(r.contacted, r.n)}</td><td className="n">{r.visited}</td><td className="n">{r.booked}</td></tr>
              )) : <tr><td colSpan={6} className="hint">No leads in this period.</td></tr>}</tbody>
            </table></div>
          </section>
        </div>
        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Clean-up list</h2><span className="hint">Right now, all open leads</span></div>
            <div className="rows">
              {cleanup.map((c) => (
                <Link key={c.href} href={c.href} className="callrow">
                  <span className="cr-main"><b>{c.label}</b></span>
                  <span className={`chip ${c.n ? 'tape' : ''}`}>{c.n}</span>
                </Link>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Team</h2></div>
            <div className="table-wrap"><table className="tbl">
              <thead><tr><th>Name</th><th className="n">Leads</th><th className="n">Reached</th><th className="n">Calls</th><th className="n">Visits</th><th className="n">Booked</th></tr></thead>
              <tbody>{team.length ? team.map((r) => (
                <tr key={r.name}><td>{r.name}</td><td className="n">{r.n}</td><td className="n">{pct(r.contacted, r.n)}</td><td className="n">{r.calls}</td><td className="n">{r.visits}</td><td className="n">{r.booked}</td></tr>
              )) : <tr><td colSpan={6} className="hint">No assigned leads in this period.</td></tr>}</tbody>
            </table></div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Why leads were lost</h2></div>
            <div className="panel-b funnel">
              {lostRows.length ? lostRows.map(([k, n]) => (
                <div key={k} className="fbar"><span>{k}</span><span className="track"><span className="fill lost" style={{ width: `${(n / maxLost) * 100}%` }} /></span><span className="num mono">{n}</span></div>
              )) : <p className="hint">No lost leads in this period.</p>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
