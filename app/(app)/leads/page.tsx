import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { fmtPhone, isManager } from '@/lib/roles';
import { OUTCOMES, BHKS, BUDGETS, CATEGORIES, FUNDING, PTYPES, PURPOSES, RAIPUR_AREAS, SCORES, SCORE_KEYS, SOURCES, STAGE_IDX, STATUS_LIST, fmtBudget, istAt } from '@/lib/crm';
import { LeadsTable, type LeadRow } from '@/components/LeadsTable';
import { AutoFilterForm } from '@/components/AutoFilterForm';
import { dismissMatches } from '@/app/crm-actions';

export const metadata = { title: 'Leads' };

type SP = { broker?: string; sort?: string; per?: string; oc?: string; q?: string; stage?: string; score?: string; source?: string; agent?: string; project?: string; fu?: string; view?: string; page?: string;
  from?: string; to?: string; bmin?: string; bmax?: string; budget?: string; bhk?: string; ptype?: string; cat?: string; fund?: string; area?: string; purpose?: string; req?: string; match?: string; found?: string; seg?: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: string) => v.replace(/[%_,()."']/g, '').slice(0, 60);

const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function Leads({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  // A link like ?q=a&q=b gives a list; keep only the first value so the page never breaks.
  const sp = Object.fromEntries(Object.entries(searchParams).map(([k, v]) => [k, (Array.isArray(v) ? v[0] : v)?.slice(0, 200)])) as SP;
  if (sp.project && !UUIDRE.test(sp.project)) delete sp.project;
  if (sp.agent && sp.agent !== 'none' && !UUIDRE.test(sp.agent)) delete sp.agent;
  const { supabase, org, role } = await requireOrg();
  const mgr = isManager(role);
  const page = Math.min(5000, Math.max(1, Math.floor(Number(sp.page)) || 1));
  const PAGE = [25, 50, 100].includes(Number(sp.per)) ? Number(sp.per) : 50;
  const SORTS: Record<string, [string, boolean]> = { new: ['created_at', false], old: ['created_at', true], touched: ['last_activity_at', false], fu: ['next_follow_up', true], name: ['name', true] };
  const sort = SORTS[sp.sort ?? ''] ? sp.sort! : 'new';

  const BASE = 'id, name, phone, source, stage, score, assigned_to, category, bhk, property_type, budget_min, budget_max, location, next_follow_up, created_at, project_id, last_activity_at';
  const seg = sp.seg === 'secondary' ? 'secondary' : sp.seg === 'all' ? '' : 'primary';
  const term = (sp.q ?? '').trim();
  const br = BUDGETS.find((b) => b.k === sp.budget);
  let matchName = '';
  let matchIds: string[] | null = null;
  if (sp.match && /^[0-9a-f-]{36}$/.test(sp.match)) {
    const [{ data: ms }, { data: mp }] = await Promise.all([
      supabase.from('project_matches').select('lead_id').eq('project_id', sp.match).is('dismissed_at', null).limit(1000),
      supabase.from('projects').select('name').eq('id', sp.match).eq('org_id', org.id).maybeSingle(),
    ]);
    matchName = mp?.name ?? 'this project';
    matchIds = (ms ?? []).map((m) => m.lead_id as string).concat(['00000000-0000-0000-0000-000000000000']);
  }
  const build = (withNew: boolean) => {
  let q = supabase.from('leads')
    .select(withNew ? BASE + ', last_outcome, last_outcome_at' : BASE, { count: 'exact' })
    .eq('org_id', org.id);
  if (withNew && sp.oc && /^[a-z]{2,12}$/.test(sp.oc)) q = q.eq('last_outcome', sp.oc);
  if (sp.broker && UUIDRE.test(sp.broker)) q = q.eq('broker_id', sp.broker);
  if (seg && !sp.match && !sp.q) q = q.eq('segment', seg);
  if (sp.stage && (STAGE_IDX[sp.stage] != null || sp.stage === 'lost')) q = q.eq('stage', sp.stage);
  if (sp.score && SCORE_KEYS.includes(sp.score)) q = q.eq('score', sp.score);
  if (sp.source) q = q.eq('source', sp.source);
  if (sp.project) q = q.eq('project_id', sp.project);
  if (mgr && sp.agent === 'none') q = q.is('assigned_to', null);
  else if (mgr && sp.agent) q = q.eq('assigned_to', sp.agent);
  const now = new Date().toISOString();
  if (sp.fu === 'over') q = q.lt('next_follow_up', now).not('stage', 'in', '(booked,lost)');
  if (sp.fu === 'today') q = q.gte('next_follow_up', now).lt('next_follow_up', istAt(1, 0)).not('stage', 'in', '(booked,lost)');
  if (sp.fu === 'due') q = q.lt('next_follow_up', istAt(1, 0)).not('stage', 'in', '(booked,lost)');
  if (sp.fu === 'none') q = q.is('next_follow_up', null).not('stage', 'in', '(new,booked,lost)');
  const ors: string[] = [];   // several "either/or" filters are combined into one
  if (sp.fu === 'stale') {
    const t = new Date(Date.now() - 14 * 86400000).toISOString();
    ors.push(`last_activity_at.lt.${t},and(last_activity_at.is.null,created_at.lt.${t})`);
    q = q.not('stage', 'in', '(booked,lost)');
  }
  if (term) {
    let digits = term.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);   // +91 98450 12345
    else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1); // 098450 12345
    if (digits.length >= 3) q = q.ilike('phone', `%${digits}%`); else ors.push(`name.ilike.%${clean(term)}%,location.ilike.%${clean(term)}%`);
  }
  // date the lead came in (India time)
  if (sp.from && DAY.test(sp.from)) q = q.gte('created_at', `${sp.from}T00:00:00+05:30`);
  if (sp.to && DAY.test(sp.to)) q = q.lte('created_at', `${sp.to}T23:59:59+05:30`);
  // budget in lakh: show leads whose budget range touches the range asked for
  if (br) { sp.bmin = br.min != null ? String(br.min + 0.01) : undefined; sp.bmax = br.max != null ? String(br.max) : undefined; }
  const bmin = Number(sp.bmin), bmax = Number(sp.bmax);
  if (bmin > 0) q = q.gte('budget_max', bmin);
  if (bmax > 0) ors.push(`budget_min.lte.${bmax},and(budget_min.is.null,budget_max.lte.${bmax})`);
  if (sp.bhk) q = q.eq('bhk', sp.bhk);
  if (sp.ptype) q = q.eq('property_type', sp.ptype);
  if (sp.cat) q = q.eq('category', sp.cat);
  if (sp.fund) q = q.eq('funding', sp.fund);
  if (sp.purpose) q = q.eq('purpose', sp.purpose);
  if (sp.area) q = q.ilike('location', `%${clean(sp.area)}%`);
  if (matchIds) q = q.in('id', matchIds);
  // Commercial leads have no configuration, so they count as filled without one.
  if (sp.req === 'full') { q = q.not('budget_max', 'is', null).not('location', 'is', null); ors.push('bhk.not.is.null,category.eq.Commercial'); }
  if (sp.req === 'missing') ors.push('budget_max.is.null,location.is.null,and(bhk.is.null,or(category.is.null,category.neq.Commercial))');
  if (ors.length === 1) q = q.or(ors[0]);
  else if (ors.length > 1) q = q.or(`and(${ors.map((o) => `or(${o})`).join(',')})`);
  const [col, asc] = SORTS[sort];
  q = q.order(col, { ascending: asc, nullsFirst: false });
  if (col !== 'created_at') q = q.order('created_at', { ascending: false });
  return q.range((page - 1) * PAGE, page * PAGE - 1);
  };
  let res = await build(true);
  if (res.error && /last_outcome/.test(res.error.message)) res = await build(false); // patch-042 not run yet
  const [{ data: people }, { data: projects }] = await Promise.all([
    supabase.from('members').select('user_id, full_name, role, active').eq('org_id', org.id),
    supabase.from('projects').select('id, name').eq('org_id', org.id).order('name'),
  ]);
  const { data: leads, count, error: listErr } = res as unknown as { data: (Record<string, any>)[] | null; count: number | null; error: { message: string } | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const nameOf = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const projName = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));
  const agents = (people ?? []).filter((p) => p.active && p.role !== 'partner');
  const list = leads ?? [];
  const keep = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    Object.entries({ ...sp, ...extra }).forEach(([k, v]) => { if (v && !(br && (k === 'bmin' || k === 'bmax'))) p.set(k, v); });
    return `/leads?${p.toString()}`;
  };
  const anyFilter = ['broker', 'oc', 'match', 'q', 'stage', 'score', 'source', 'agent', 'project', 'fu', 'from', 'to', 'budget', 'bmin', 'bmax', 'bhk', 'ptype', 'cat', 'fund', 'area', 'purpose', 'req'].some((k) => sp[k as keyof SP]);
  const moreOn = ['from', 'to', 'budget', 'bhk', 'ptype', 'cat', 'fund', 'area', 'purpose', 'req'].filter((k) => sp[k as keyof SP]).length;
  const segHref = (v: string) => { const p = new URLSearchParams(); Object.entries(sp).forEach(([k, x]) => { if (x && k !== 'page' && k !== 'seg' && !(br && (k === 'bmin' || k === 'bmax'))) p.set(k, x); }); if (v !== 'primary') p.set('seg', v); return `/leads?${p}`; };

  return (
    <>
      <div className="top">
        <h1>Leads</h1>
        <AutoFilterForm className="search" action="/leads">
          {Object.entries(sp).filter(([k, v]) => v && k !== 'q' && k !== 'page' && k !== 'found').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="search" name="q" defaultValue={term} placeholder="Search name, mobile or area" aria-label="Search leads" />
        </AutoFilterForm>
        {mgr && <Link className="btn" href="/leads/import">Import</Link>}
        {mgr && <Link className="btn" href="/leads/export">Export to Excel</Link>}
        <Link className="btn" href="/profile#form" title="Send a link where the client fills their own requirement">Client form</Link>
        <Link className="btn primary" href="/leads/new">+ Add lead</Link>
      </div>
      {matchName && sp.found === 'err' && <div className="banner">Could not check the leads just now. Please try again.</div>}
      {matchName && sp.found === '0' && (
        <div className="banner match-banner">
          <span><b>No leads fit {matchName} yet.</b> A lead fits when the budget matches, plus the home type or area. Leads without a budget cannot be matched, so add budgets to old leads. Click “Find matching leads” again any time.</span>
          <Link className="btn sm ghost" href="/projects">Back to projects</Link>
        </div>
      )}
      {matchName && sp.found !== '0' && sp.found !== 'err' && (
        <div className="banner match-banner">
          <span><b>{sp.found ? `${sp.found} lead${sp.found === '1' ? '' : 's'}` : 'These leads'} wanted something like {matchName}.</b> Their budget fits, plus the home type or area. Call them or send the project from the lead page.</span>
          <form action={dismissMatches}><input type="hidden" name="project_id" value={sp.match} /><button className="btn sm ghost">Hide this list</button></form>
        </div>
      )}
      <div className="seg seg-sm" role="tablist" aria-label="Lead type">
        <Link href={segHref('primary')} className={seg === 'primary' ? 'on' : ''}>Primary</Link>
        <Link href={segHref('secondary')} className={seg === 'secondary' ? 'on' : ''}>Secondary (resale)</Link>
        <Link href={segHref('all')} className={!seg ? 'on' : ''}>All</Link>
      </div>
      {!mgr && <div className="banner">{role === 'partner' ? 'You see only the leads you brought in.' : 'You see only the leads assigned to you.'}</div>}

      <AutoFilterForm key={JSON.stringify(sp)} className="filters" action="/leads">
        {sp.match && <input type="hidden" name="match" value={sp.match} />}
        {sp.view && <input type="hidden" name="view" value={sp.view} />}
        {sp.seg && <input type="hidden" name="seg" value={sp.seg} />}
        {term && <input type="hidden" name="q" value={term} />}
        {mgr && <Link href="/pipeline" className="btn sm">Journey board</Link>}
        {role === 'owner' && <Link href="/leads/duplicates" className="btn sm ghost">Duplicates</Link>}
        {role === 'owner' && <Link href="/leads/deleted" className="btn sm ghost">Deleted</Link>}
        <select name="stage" defaultValue={sp.stage ?? ''} aria-label="Status"><option value="">All statuses</option>{STATUS_LIST.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}<option value="lost">Lost</option></select>
        <select name="fu" defaultValue={sp.fu ?? ''} aria-label="Follow-up"><option value="">Any follow-up</option><option value="over">Overdue</option><option value="today">Due today</option><option value="due">Overdue + today</option><option value="none">No next step</option><option value="stale">Untouched 14+ days</option></select>
        <select name="score" defaultValue={sp.score ?? ''} aria-label="Interest"><option value="">Any interest</option>{SCORES.map((x) => <option key={x.k} value={x.k}>{x.l}</option>)}</select>
        <select name="source" defaultValue={sp.source ?? ''} aria-label="Source"><option value="">All sources</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
        {(projects ?? []).length > 0 && <select name="project" defaultValue={sp.project ?? ''} aria-label="Project"><option value="">All projects</option>{(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        {mgr && <select name="agent" defaultValue={sp.agent ?? ''} aria-label="Assigned to"><option value="">Anyone</option><option value="none">Not assigned</option>{agents.map((a) => <option key={a.user_id} value={a.user_id}>{a.full_name}</option>)}</select>}
        <select name="oc" defaultValue={sp.oc ?? ''} aria-label="Last call"><option value="">Any last call</option>{OUTCOMES.map((o) => <option key={o.k} value={o.k}>{o.l}</option>)}</select>
        <select name="sort" defaultValue={sp.sort ?? ''} aria-label="Sort"><option value="">Newest first</option><option value="touched">Recently updated</option><option value="fu">Follow-up soonest</option><option value="old">Oldest first</option><option value="name">Name A–Z</option></select>
        <select name="per" defaultValue={sp.per ?? ''} aria-label="Rows per page"><option value="">50 per page</option><option value="25">25 per page</option><option value="100">100 per page</option></select>
        <details className="more-filters" open={moreOn > 0}>
          <summary className="btn sm ghost">More filters{moreOn ? ` (${moreOn})` : ''}</summary>
          <div className="mf-grid">
            <label className="field"><span className="label">Came in from</span><input type="date" name="from" defaultValue={sp.from ?? ''} /></label>
            <label className="field"><span className="label">to</span><input type="date" name="to" defaultValue={sp.to ?? ''} /></label>
            <label className="field"><span className="label">Budget</span><select name="budget" defaultValue={sp.budget ?? ''}><option value="">Any</option>{BUDGETS.map((b) => <option key={b.k} value={b.k}>{b.l}</option>)}</select></label>
            <label className="field"><span className="label">Category</span><select name="cat" defaultValue={sp.cat ?? ''}><option value="">Any</option>{CATEGORIES.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="field"><span className="label">Configuration</span><select name="bhk" defaultValue={sp.bhk ?? ''}><option value="">Any</option>{BHKS.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="field"><span className="label">Property type</span><select name="ptype" defaultValue={sp.ptype ?? ''}><option value="">Any</option>{PTYPES.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="field"><span className="label">Area</span><input name="area" list="areas" defaultValue={sp.area ?? ''} placeholder="e.g. Shankar Nagar" /></label>
            <label className="field"><span className="label">Purpose</span><select name="purpose" defaultValue={sp.purpose ?? ''}><option value="">Any</option>{PURPOSES.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="field"><span className="label">Funding</span><select name="fund" defaultValue={sp.fund ?? ''}><option value="">Any</option>{FUNDING.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="field"><span className="label">Requirement</span><select name="req" defaultValue={sp.req ?? ''}><option value="">Any</option><option value="full">Filled (budget, configuration, area)</option><option value="missing">Something missing</option></select></label>
          </div>
          <datalist id="areas">{RAIPUR_AREAS.map((a) => <option key={a} value={a} />)}</datalist>
        </details>
        <button className="sr-only" tabIndex={-1}>Apply</button>
        {anyFilter && <Link className="btn sm ghost" href="/leads">Clear</Link>}
        <span className="hint" style={{ marginLeft: 'auto' }}>{count ?? 0} lead{count === 1 ? '' : 's'}</span>
      </AutoFilterForm>

      <section className="panel">
          {list.length ? (
            <LeadsTable
              role={role} voice={Boolean(process.env.GEMINI_API_KEY)}
              agents={agents.map((x) => ({ id: x.user_id as string, name: x.full_name as string }))}
              rows={list.map((l): LeadRow => ({
                id: l.id, name: l.name, phone: l.phone, phoneText: fmtPhone(l.phone), stage: l.stage, score: l.score, source: l.source ?? null,
                req: [l.bhk ?? (l.category === 'Commercial' ? l.property_type ?? 'Commercial' : l.property_type), fmtBudget(l.budget_min, l.budget_max), l.location].filter(Boolean).join(' · '),
                project: l.project_id ? projName.get(l.project_id) ?? null : null, agent: l.assigned_to ? nameOf.get(l.assigned_to) ?? null : null,
                next_follow_up: l.next_follow_up, last_outcome: l.last_outcome ?? null, last_outcome_at: l.last_outcome_at ?? null, last_activity_at: l.last_activity_at ?? null, created_at: l.created_at,
              }))}
            />
          ) : (
            <div className="empty">{listErr && page > 1 ? <>This page is past the end. <Link href="/leads">Go to page 1</Link>.</> : listErr ? 'Could not load leads. Please refresh the page.' : anyFilter ? 'No leads match these filters.' : <>No leads yet. <Link href="/leads/new">Add your first lead</Link>{role === 'owner' ? <> or <Link href="/sources">connect a lead source</Link></> : null}.</>}</div>
          )}
          {(count ?? 0) > PAGE && (
            <div className="pager">
              {page > 1 && <Link className="btn sm" href={keep({ page: String(page - 1) })}>Previous</Link>}
              <span className="hint">Page {page} of {Math.ceil((count ?? 0) / PAGE)}</span>
              {page * PAGE < (count ?? 0) && <Link className="btn sm" href={keep({ page: String(page + 1) })}>Next</Link>}
            </div>
          )}
        </section>
    </>
  );
}
