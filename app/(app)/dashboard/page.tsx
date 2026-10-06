import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { PICK_HELP, PICK_LABEL, fmtPhone, isManager, memberRole, telHref } from '@/lib/roles';
import { recycleCall, recycleSnooze } from '@/app/crm-actions';
import { fmtBudget, fmtTime, fuState, fuText, istAt, istDay, rel, stageChip, stageLabel } from '@/lib/crm';

type Lead = { id: string; name: string; phone: string; stage: string; score: string; bhk: string | null; budget_min: number | null; budget_max: number | null; location: string | null; next_follow_up: string | null; created_at: string; source: string | null; assigned_to: string | null };
const COLS = 'id, name, phone, stage, score, bhk, budget_min, budget_max, location, next_follow_up, created_at, source, assigned_to';

export default async function Today({ searchParams }: { searchParams: { welcome?: string; joined?: string; denied?: string; scope?: string } }) {
  const { supabase, org, role, me, user } = await requireOrg();
  const mgr = isManager(role);
  const mine = !mgr || searchParams.scope === 'mine';
  const now = new Date().toISOString();
  const endToday = istAt(1, 0);
  const endTomorrow = istAt(2, 0);
  const monthStart = new Date(`${istDay(new Date()).slice(0, 8)}01T00:00:00+05:30`).toISOString();

  const scoped = <T,>(q: T) => (mine && role !== 'partner' ? (q as unknown as { eq: (c: string, v: string) => T }).eq('assigned_to', user.id) : q);

  const [due, fresh, noNext, booked, visits, people, team, sources, recycle, matches] = await Promise.all([
    scoped(supabase.from('leads').select(COLS).eq('org_id', org.id).lt('next_follow_up', endToday).not('stage', 'in', '(booked,lost)').order('next_follow_up').limit(40)),
    scoped(supabase.from('leads').select(COLS).eq('org_id', org.id).eq('stage', 'new').eq('call_attempts', 0).order('created_at', { ascending: false }).limit(20)),
    scoped(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('org_id', org.id).is('next_follow_up', null).not('stage', 'in', '(new,booked,lost)')),
    scoped(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('org_id', org.id).gte('booked_at', monthStart)),
    supabase.from('visits').select('id, at, status, lead_id, agent_id, project_id, leads(name, phone), projects(name)').eq('org_id', org.id).eq('status', 'scheduled').gte('at', istAt(0, 0)).lt('at', endTomorrow).order('at'),
    supabase.from('members').select('user_id, full_name').eq('org_id', org.id),
    mgr ? supabase.from('members').select('user_id', { count: 'exact', head: true }).eq('org_id', org.id).eq('active', true) : Promise.resolve({ count: 0 }),
    mgr ? supabase.from('lead_sources').select('id', { count: 'exact', head: true }).eq('org_id', org.id) : Promise.resolve({ count: 0 }),
    role === 'partner' ? Promise.resolve({ data: [] }) : scoped(supabase.from('leads').select('id, name, phone, lost_reason, recycle_step, assigned_to, bhk, budget_min, budget_max, location').eq('org_id', org.id).eq('stage', 'lost').lte('recycle_at', now).order('recycle_at').limit(10)),
    role === 'partner' ? Promise.resolve({ data: [] }) : supabase.from('project_matches').select('project_id, lead_id, created_at, projects(name), leads!inner(name, stage, assigned_to)').eq('org_id', org.id).is('dismissed_at', null).gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString()).order('created_at', { ascending: false }).limit(300),
  ]);
  // Chart + comparison data
  const chartFrom = new Date(`${istDay(new Date(Date.now() - 13 * 86400000))}T00:00:00+05:30`).toISOString();
  const lastMonthStart = (() => { const d = new Date(`${istDay(new Date()).slice(0, 8)}01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return new Date(`${d.toISOString().slice(0, 10)}T00:00:00+05:30`).toISOString(); })();
  const [recent, bookedPrev] = await Promise.all([
    scoped(supabase.from('leads').select('created_at, max_stage').eq('org_id', org.id).gte('created_at', chartFrom).limit(5000)),
    scoped(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('org_id', org.id).gte('booked_at', lastMonthStart).lt('booked_at', monthStart)),
  ]);
  const days = Array.from({ length: 14 }, (_, i) => istDay(new Date(Date.now() - (13 - i) * 86400000)));
  const perDay = new Map(days.map((d) => [d, { n: 0, reached: 0 }]));
  ((recent.data ?? []) as { created_at: string; max_stage: number }[]).forEach((l) => { const r = perDay.get(istDay(l.created_at)); if (r) { r.n++; if (l.max_stage >= 1) r.reached++; } });
  const series = days.map((d) => ({ d, ...perDay.get(d)! }));
  const total14 = series.reduce((a, b) => a + b.n, 0);
  const reached14 = series.reduce((a, b) => a + b.reached, 0);
  const top = Math.max(4, ...series.map((x) => x.n));
  const step = Math.ceil(top / 4);
  const yMax = step * 4;
  const bookedNow = booked.count ?? 0;
  const bookedBefore = bookedPrev.count ?? 0;
  const bookedTrend = bookedBefore ? Math.round(((bookedNow - bookedBefore) / bookedBefore) * 100) : null;
  type M = { project_id: string; lead_id: string; created_at: string; projects: { name: string } | null; leads: { name: string; stage: string; assigned_to: string | null } | null };
  const myMatches = ((matches.data ?? []) as unknown as M[]).filter((m) => !mine || m.leads?.assigned_to === user.id);
  const matchGroups = [...myMatches.reduce((acc, m) => { const g = acc.get(m.project_id) ?? { id: m.project_id, name: m.projects?.name ?? 'Project', n: 0, lost: 0, names: [] as string[] }; g.n++; if (m.leads?.stage === 'lost') g.lost++; if (g.names.length < 3) g.names.push(m.leads?.name ?? ''); acc.set(m.project_id, g); return acc; }, new Map<string, { id: string; name: string; n: number; lost: number; names: string[] }>()).values()];
  type R = { id: string; name: string; phone: string; lost_reason: string | null; recycle_step: number; assigned_to: string | null; bhk: string | null; budget_min: number | null; budget_max: number | null; location: string | null };
  const second = (recycle.data ?? []) as R[];
  const nameOf = new Map((people.data ?? []).map((p) => [p.user_id, p.full_name]));
  const dueList = (due.data ?? []) as Lead[];
  const overdue = dueList.filter((l) => l.next_follow_up! < now);
  const today = dueList.filter((l) => l.next_follow_up! >= now);
  const freshList = (fresh.data ?? []) as Lead[];
  type V = { id: string; at: string; agent_id: string | null; lead_id: string; leads: { name: string; phone: string } | null; projects: { name: string } | null };
  const allVisits = ((visits.data ?? []) as unknown as V[]).filter((v) => !mine || v.agent_id === user.id || role === 'partner');
  const visitsToday = allVisits.filter((v) => v.at < endToday);
  const first = me.full_name.split(' ')[0];
  const hour = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const steps = [
    { done: true, label: 'Create your company account', href: '' },
    { done: (team.count ?? 0) > 1, label: 'Invite your team', href: '/team' },
    { done: (sources.count ?? 0) > 0, label: 'Connect 99acres, MagicBricks, ads or your website', href: '/sources' },
    { done: dueList.length + freshList.length > 0, label: 'Add or receive your first lead', href: '/leads/new' },
  ];
  const done = steps.filter((s) => s.done).length;
  const req = (l: Lead) => [l.bhk, fmtBudget(l.budget_min, l.budget_max), l.location].filter(Boolean).join(' · ');

  return (
    <>
      <div className="top">
        <div className="top-title">
          <h1>{greet}{first ? `, ${first}` : ''}</h1>
          <p className="hint">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })} · Here is what needs your attention today.</p>
        </div>
        {mgr && (
          <div className="seg">
            <Link href="/dashboard?scope=mine" className={mine ? 'on' : ''}>My leads</Link>
            <Link href="/dashboard" className={!mine ? 'on' : ''}>Everyone</Link>
          </div>
        )}
        <Link className="btn primary" href="/leads/new">+ Add lead</Link>
      </div>
      {searchParams.welcome && <div className="banner">Your company account is ready. Next, invite your team.</div>}
      {searchParams.joined && <div className="banner">You joined {org.name} as {PICK_LABEL[memberRole(me)]}. {PICK_HELP[memberRole(me)]}</div>}
      {searchParams.denied && <div className="banner warn">That page is only for admins and managers.</div>}

      <div className="kpis">
        <Link className="kpi hero" href="/leads?fu=over">
          <div className="kpi-top"><i className="kpi-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></i>{overdue.length > 0 && <span className="trend bad">Call now</span>}</div>
          <span className="label">Overdue calls</span><span className="n">{overdue.length}</span>
          <span className="kpi-sub">Follow-up time has passed</span>
        </Link>
        <Link className="kpi" href="/leads?fu=today">
          <div className="kpi-top"><i className="kpi-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg></i></div>
          <span className="label">Calls due today</span><span className="n">{today.length}</span>
          <span className="kpi-sub">Planned for later today</span>
        </Link>
        <Link className="kpi" href="/leads?stage=new">
          <div className="kpi-top"><i className="kpi-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M19 8v6M16 11h6"/></svg></i>{freshList.length > 0 && <span className="trend warn">Waiting</span>}</div>
          <span className="label">New, not called</span><span className="n">{freshList.length}</span>
          <span className="kpi-sub">Call within 5 minutes</span>
        </Link>
        <Link className="kpi" href="/visits">
          <div className="kpi-top"><i className="kpi-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg></i></div>
          <span className="label">Site visits today</span><span className="n">{visitsToday.length}</span>
          <span className="kpi-sub">{allVisits.length - visitsToday.length} more tomorrow</span>
        </Link>
        <Link className="kpi" href="/leads?stage=booked">
          <div className="kpi-top"><i className="kpi-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg></i>{bookedTrend !== null && <span className={`trend ${bookedTrend >= 0 ? 'good' : 'bad'}`}>{bookedTrend >= 0 ? '+' : ''}{bookedTrend}%</span>}</div>
          <span className="label">Booked this month</span><span className="n">{bookedNow}</span>
          <span className="kpi-sub">{bookedBefore} last month</span>
        </Link>
      </div>

      <section className="panel chart-panel">
        <div className="panel-h">
          <div className="ph-title"><h2>Leads coming in</h2><span className="hint">Last 14 days{mine ? ' · your leads' : ''} · {total14} new, {total14 ? Math.round((reached14 / total14) * 100) : 0}% reached by phone</span></div>
          <div className="legend"><span><i className="lg grey" />New leads</span><span><i className="lg blue" />Reached</span></div>
        </div>
        <div className="bars" style={{ ['--rows' as string]: 4 }}>
          <div className="bars-y">{[4, 3, 2, 1, 0].map((k) => <span key={k}>{k * step}</span>)}</div>
          <div className="bars-plot">
            {series.map((x) => (
              <Link key={x.d} href={`/leads?from=${x.d}&to=${x.d}`} className="bar-day" aria-label={`${x.d}: ${x.n} new, ${x.reached} reached`}>
                <span className="bar-pair">
                  <span className="bar grey" style={{ height: `${(x.n / yMax) * 100}%` }} />
                  <span className="bar blue" style={{ height: `${(x.reached / yMax) * 100}%` }} />
                </span>
                <span className="bar-tip"><b>{new Date(x.d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</b><span><i className="lg grey" />{x.n} new</span><span><i className="lg blue" />{x.reached} reached</span></span>
                <span className="bar-x">{Number(x.d.slice(8))}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {role === 'owner' && done < steps.length && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-h"><h2>Get set up</h2><span className="hint">{done} of {steps.length} done</span></div>
          <div className="progress"><div style={{ width: `${(done / steps.length) * 100}%` }} /></div>
          <ol className="steps">
            {steps.map((s) => (
              <li key={s.label} className={s.done ? 'done' : ''}><span className="tick" aria-hidden="true">{s.done ? '✓' : ''}</span>{s.href && !s.done ? <Link href={s.href}>{s.label}</Link> : <span>{s.label}</span>}</li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid-main">
        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Call list</h2><span className="hint">Overdue first</span></div>
            {dueList.length ? (
              <div className="rows">
                {[...overdue, ...today].map((l) => (
                  <div key={l.id} className="callrow">
                    <Link href={`/leads/${l.id}`} className="cr-main">
                      <b><span className={`dot ${l.score}`} />{l.name} <span className={`chip ${stageChip(l.stage)}`}>{stageLabel(l.stage)}</span></b>
                      <span className="hint"><span className={`fu ${fuState(l.next_follow_up)}`}>{fuText(l.next_follow_up)}</span>{req(l) ? ' · ' + req(l) : ''}{!mine && l.assigned_to ? ' · ' + (nameOf.get(l.assigned_to) ?? '') : ''}</span>
                    </Link>
                    <a className="btn sm" href={telHref(l.phone)} aria-label={`Call ${l.name}`}>Call</a>
                  </div>
                ))}
              </div>
            ) : <p className="empty">No calls due. Set a follow-up time on any lead and it shows up here on that day.</p>}
          </section>
          <section className="panel">
            <div className="panel-h"><h2>New leads waiting for a first call</h2><span className="hint">Call within 5 minutes to win the lead</span></div>
            {freshList.length ? (
              <div className="rows">
                {freshList.map((l) => {
                  const mins = (Date.now() - new Date(l.created_at).getTime()) / 60000;
                  return (
                    <div key={l.id} className="callrow">
                      <Link href={`/leads/${l.id}`} className="cr-main">
                        <b>{l.name} {l.source && <span className="chip">{l.source}</span>}</b>
                        <span className="hint">Came in {rel(l.created_at)}{mins > 30 ? <span className="fu over"> · waiting too long</span> : null}{req(l) ? ' · ' + req(l) : ''}{!mine && l.assigned_to ? ' · ' + (nameOf.get(l.assigned_to) ?? '') : !l.assigned_to ? ' · not assigned' : ''}</span>
                      </Link>
                      <a className="btn sm" href={telHref(l.phone)}>Call</a>
                    </div>
                  );
                })}
              </div>
            ) : <p className="empty">Every new lead has been called.</p>}
          </section>
        </div>
        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Site visits</h2><Link className="btn sm ghost" href="/visits">All visits</Link></div>
            {allVisits.length ? (
              <div className="rows">
                {allVisits.map((v) => (
                  <Link key={v.id} href={`/leads/${v.lead_id}`} className="callrow">
                    <span className="cr-main"><b>{fmtTime(v.at)} · {v.leads?.name}</b><span className="hint">{v.at < endToday ? 'Today' : 'Tomorrow'} · {v.projects?.name ?? 'Project not set'}{v.agent_id ? ' · ' + (nameOf.get(v.agent_id) ?? '') : ''}</span></span>
                  </Link>
                ))}
              </div>
            ) : <p className="empty">No visits today or tomorrow.</p>}
          </section>
          {matchGroups.length > 0 && (
            <section className="panel">
              <div className="panel-h"><h2>🔔 New projects fit your leads</h2><span className="hint">Last 14 days</span></div>
              <div className="rows">
                {matchGroups.map((g) => (
                  <Link key={g.id} href={`/leads?match=${g.id}`} className="callrow">
                    <span className="cr-main"><b>{g.name}: {g.n} lead{g.n === 1 ? '' : 's'} wanted this</b><span className="hint">{g.names.join(', ')}{g.n > 3 ? ' and more' : ''}{g.lost ? ` · ${g.lost} were lost before` : ''}</span></span>
                    <span className="btn sm">See</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {second.length > 0 && (
            <section className="panel">
              <div className="panel-h"><h2>Second chance</h2><span className="hint">Lost a month ago. Plans change, call once more.</span></div>
              <div className="rows">
                {second.map((l) => (
                  <div key={l.id} className="callrow">
                    <Link href={`/leads/${l.id}`} className="cr-main">
                      <b>{l.name}</b>
                      <span className="hint">Lost: {l.lost_reason ?? 'no reason'}{l.recycle_step > 1 ? ` · try ${l.recycle_step}` : ''}{req(l as unknown as Lead) ? ' · ' + req(l as unknown as Lead) : ''}{!mine && l.assigned_to ? ' · ' + (nameOf.get(l.assigned_to) ?? '') : ''}</span>
                    </Link>
                    <span className="row-btns">
                      <form action={recycleCall}><input type="hidden" name="id" value={l.id} /><button className="btn sm">Reopen</button></form>
                      <form action={recycleSnooze}><input type="hidden" name="id" value={l.id} /><button className="btn sm ghost">Not now</button></form>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {(noNext.count ?? 0) > 0 && (
            <section className="panel">
              <div className="panel-h"><h2>Leads with no next step</h2><span className="chip tape">{noNext.count}</span></div>
              <div className="panel-b"><p className="hint">These leads are active but nobody has planned the next call.</p><Link className="btn sm" href="/leads?fu=none">Show them</Link></div>
            </section>
          )}
          {role === 'partner' && <section className="panel"><div className="panel-b" style={{ paddingTop: 16 }}><p className="hint">Add the clients you bring in. You will see their stage here as the team works on them. Your number: {fmtPhone(user.phone)}</p></div></section>}
        </div>
      </div>
    </>
  );
}
