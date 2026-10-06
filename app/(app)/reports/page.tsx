import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { STAGES, istDay } from '@/lib/crm';
import { AutoFilterForm } from '@/components/AutoFilterForm';

export const metadata = { title: 'Reports' };

type L = { created_at: string; stage: string; max_stage: number; source: string | null; assigned_to: string | null; lost_reason: string | null; next_follow_up: string | null; call_attempts: number };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const istStart = (d: string) => new Date(d + 'T00:00:00+05:30').toISOString();
const fmtD = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Works out the period from the link: a preset (?p=today|7|30|month|lastmonth|90|all) or a custom ?from=&to= (IST days). */
function period(sp: { p?: string; days?: string; from?: string; to?: string }) {
  const today = istDay(new Date());
  if (sp.from && DAY.test(sp.from)) {
    let to = sp.to && DAY.test(sp.to) ? sp.to : today;
    let from = sp.from;
    if (from > to) [from, to] = [to, from];
    return { key: 'custom', from, to, label: from === to ? fmtD(from) : `${fmtD(from)} – ${fmtD(to)}` };
  }
  const p = sp.p ?? (sp.days === '7' ? '7' : sp.days === '90' ? '90' : sp.days === '0' ? 'all' : '30');
  const month = today.slice(0, 8) + '01';
  switch (p) {
    case 'today': return { key: p, from: today, to: today, label: 'Today' };
    case '7': return { key: p, from: addDays(today, -6), to: today, label: 'Last 7 days' };
    case 'month': return { key: p, from: month, to: today, label: 'This month' };
    case 'lastmonth': { const lmEnd = addDays(month, -1); return { key: p, from: lmEnd.slice(0, 8) + '01', to: lmEnd, label: 'Last month' }; }
    case '90': return { key: p, from: addDays(today, -89), to: today, label: 'Last 90 days' };
    case 'all': return { key: p, from: null, to: null, label: 'All time' };
    default: return { key: '30', from: addDays(today, -29), to: today, label: 'Last 30 days' };
  }
}

export default async function Reports({ searchParams }: { searchParams: { p?: string; days?: string; from?: string; to?: string } }) {
  const { supabase, org } = await requireOrg(['owner', 'manager']);
  const per = period(searchParams);
  let lq = supabase.from('leads').select('created_at, stage, max_stage, source, assigned_to, lost_reason, next_follow_up, call_attempts').eq('org_id', org.id).limit(10000);
  let vq = supabase.from('visits').select('status, agent_id, at').eq('org_id', org.id).limit(10000);
  if (per.from && per.to) {
    const a = istStart(per.from), b = istStart(addDays(per.to, 1));
    lq = lq.gte('created_at', a).lt('created_at', b); vq = vq.gte('at', a).lt('at', b);
  }
  // Calendar: the months of the chosen period (at most the last 3), with leads and visits per day.
  const calEnd = per.to ?? istDay(new Date());
  let calStart = (per.from ?? addDays(calEnd, -60)).slice(0, 8) + '01';
  const minStart = addDays(calEnd.slice(0, 8) + '01', -62).slice(0, 8) + '01';
  if (calStart < minStart) calStart = minStart;
  const calLast = (() => { const t = new Date(calEnd.slice(0, 8) + '01T00:00:00Z'); t.setUTCMonth(t.getUTCMonth() + 1); t.setUTCDate(0); return t.toISOString().slice(0, 10); })();
  const [{ data: calLeads }, { data: calVisits }] = await Promise.all([
    supabase.from('leads').select('created_at').eq('org_id', org.id).gte('created_at', istStart(calStart)).lt('created_at', istStart(addDays(calLast, 1))).limit(10000),
    supabase.from('visits').select('at, status').eq('org_id', org.id).gte('at', istStart(calStart)).lt('at', istStart(addDays(calLast, 1))).limit(10000),
  ]);
  const perDay = new Map<string, number>();
  (calLeads ?? []).forEach((l) => { const d = istDay(l.created_at); perDay.set(d, (perDay.get(d) ?? 0) + 1); });
  const visitDay = new Map<string, number>();
  (calVisits ?? []).filter((v) => v.status === 'done').forEach((v) => { const d = istDay(v.at); visitDay.set(d, (visitDay.get(d) ?? 0) + 1); });
  const maxDay = Math.max(1, ...perDay.values());
  const months: string[] = [];
  for (let m = calStart; m <= calLast; ) { months.push(m); const t = new Date(m + 'T00:00:00Z'); t.setUTCMonth(t.getUTCMonth() + 1); m = t.toISOString().slice(0, 10); }
  const todayIst = istDay(new Date());
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
        <div className="seg seg-wrap">{[['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['90', '90 days'], ['all', 'All time']].map(([k, l]) => <Link key={k} href={`/reports?p=${k}`} className={per.key === k ? 'on' : ''}>{l}</Link>)}</div>
      </div>
      <div className="report-range">
        <AutoFilterForm key={per.label} action="/reports" className="row-gap">
          <label className="field inline-field"><span className="label">From</span><input type="date" name="from" defaultValue={per.from ?? ''} max={istDay(new Date())} /></label>
          <label className="field inline-field"><span className="label">To</span><input type="date" name="to" defaultValue={per.to ?? ''} max={istDay(new Date())} /></label>
        </AutoFilterForm>
        <span className="hint">Showing <b>{per.label}</b>. Pick any dates, or tap a day in the calendar below.</span>
      </div>
      <section className="panel cal-panel">
        <div className="panel-h"><h2>Calendar</h2><span className="hint">Number = new leads that day · green dot = site visits done · tap a day to see its report</span></div>
        <div className="cal-months">
          {months.map((m) => {
            const first = new Date(m + 'T00:00:00Z');
            const pad = (first.getUTCDay() + 6) % 7; // Monday first
            const daysIn = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
            const cells = [...Array(pad).fill(null), ...Array.from({ length: daysIn }, (_, i) => addDays(m, i))];
            return (
              <div key={m} className="cal">
                <b className="cal-title">{first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b>
                <div className="cal-grid">
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="cal-dow">{d}</span>)}
                  {cells.map((d, i) => {
                    if (!d) return <span key={'p' + i} />;
                    const n = perDay.get(d) ?? 0;
                    const inRange = per.from && per.to ? d >= per.from && d <= per.to : true;
                    const future = d > todayIst;
                    const cls = `cal-day ${inRange ? 'in' : ''} ${d === todayIst ? 'today' : ''} ${future ? 'future' : ''}`;
                    const style = n ? { background: `color-mix(in srgb, var(--accent) ${Math.round(12 + (n / maxDay) * 58)}%, var(--surface))`, color: n / maxDay > 0.55 ? 'var(--accent-fg)' : undefined } : undefined;
                    const body = <><span className="cal-num">{Number(d.slice(8))}</span>{n > 0 && <b className="cal-n">{n}</b>}{visitDay.get(d) ? <i className="cal-dot" title={`${visitDay.get(d)} visit(s) done`} /> : null}</>;
                    return future ? <span key={d} className={cls}>{body}</span>
                      : <Link key={d} href={`/reports?from=${d}&to=${d}`} className={cls} style={style} title={`${fmtD(d)}: ${n} new lead${n === 1 ? '' : 's'}`}>{body}</Link>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
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
