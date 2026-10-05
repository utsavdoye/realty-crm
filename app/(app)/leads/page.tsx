import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { fmtPhone, isManager } from '@/lib/roles';
import { BHKS, PTYPES, PURPOSES, SOURCES, STAGES, STAGE_IDX, fmtBudget, fuState, fuText, istAt, stageChip, stageLabel } from '@/lib/crm';
import { AREAS } from '@/lib/places';
import { LeadBoard } from '@/components/LeadBoard';
import { AutoFilterForm } from '@/components/AutoFilterForm';
import { dismissMatches } from '@/app/crm-actions';

export const metadata = { title: 'Leads' };

type SP = { q?: string; stage?: string; score?: string; source?: string; agent?: string; project?: string; fu?: string; view?: string; page?: string;
  from?: string; to?: string; bmin?: string; bmax?: string; bhk?: string; ptype?: string; area?: string; purpose?: string; req?: string; match?: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: string) => v.replace(/[%_,()."']/g, '').slice(0, 60);
const PAGE = 50;

export default async function Leads({ searchParams: sp }: { searchParams: SP }) {
  const { supabase, org, role } = await requireOrg();
  const mgr = isManager(role);
  const board = sp.view === 'board';
  const page = Math.max(1, Number(sp.page) || 1);

  let q = supabase.from('leads')
    .select('id, name, phone, source, stage, score, assigned_to, bhk, budget_min, budget_max, location, next_follow_up, created_at, project_id', { count: 'exact' })
    .eq('org_id', org.id);
  if (sp.stage && (STAGE_IDX[sp.stage] != null || sp.stage === 'lost')) q = q.eq('stage', sp.stage);
  if (sp.score && ['hot', 'warm', 'cold'].includes(sp.score)) q = q.eq('score', sp.score);
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
  const term = (sp.q ?? '').trim();
  if (term) {
    const digits = term.replace(/\D/g, '');
    if (digits.length >= 3) q = q.ilike('phone', `%${digits}%`); else ors.push(`name.ilike.%${clean(term)}%,location.ilike.%${clean(term)}%`);
  }
  // date the lead came in (India time)
  if (sp.from && DAY.test(sp.from)) q = q.gte('created_at', `${sp.from}T00:00:00+05:30`);
  if (sp.to && DAY.test(sp.to)) q = q.lte('created_at', `${sp.to}T23:59:59+05:30`);
  // budget in lakh: show leads whose budget range touches the range asked for
  const bmin = Number(sp.bmin), bmax = Number(sp.bmax);
  if (bmin > 0) q = q.gte('budget_max', bmin);
  if (bmax > 0) ors.push(`budget_min.lte.${bmax},and(budget_min.is.null,budget_max.lte.${bmax})`);
  if (sp.bhk) q = q.eq('bhk', sp.bhk);
  if (sp.ptype) q = q.eq('property_type', sp.ptype);
  if (sp.purpose) q = q.eq('purpose', sp.purpose);
  if (sp.area) q = q.ilike('location', `%${clean(sp.area)}%`);
  let matchName = '';
  if (sp.match && /^[0-9a-f-]{36}$/.test(sp.match)) {
    const [{ data: ms }, { data: mp }] = await Promise.all([
      supabase.from('project_matches').select('lead_id').eq('project_id', sp.match).is('dismissed_at', null).limit(1000),
      supabase.from('projects').select('name').eq('id', sp.match).eq('org_id', org.id).maybeSingle(),
    ]);
    matchName = mp?.name ?? 'this project';
    q = q.in('id', (ms ?? []).map((m) => m.lead_id).concat(['00000000-0000-0000-0000-000000000000']));
  }
  if (sp.req === 'full') q = q.not('budget_max', 'is', null).not('bhk', 'is', null).not('location', 'is', null);
  if (sp.req === 'missing') ors.push('budget_max.is.null,bhk.is.null,location.is.null');
  if (ors.length === 1) q = q.or(ors[0]);
  else if (ors.length > 1) q = q.or(`and(${ors.map((o) => `or(${o})`).join(',')})`);
  q = board ? q.order('created_at', { ascending: false }).limit(600) : q.order('created_at', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);

  const [{ data: leads, count }, { data: people }, { data: projects }] = await Promise.all([
    q,
    supabase.from('members').select('user_id, full_name, role, active').eq('org_id', org.id),
    supabase.from('projects').select('id, name').eq('org_id', org.id).order('name'),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const agents = (people ?? []).filter((p) => p.active && p.role !== 'partner');
  const list = leads ?? [];
  const keep = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    Object.entries({ ...sp, ...extra }).forEach(([k, v]) => { if (v) p.set(k, v); });
    return `/leads?${p.toString()}`;
  };
  const anyFilter = ['match', 'q', 'stage', 'score', 'source', 'agent', 'project', 'fu', 'from', 'to', 'bmin', 'bmax', 'bhk', 'ptype', 'area', 'purpose', 'req'].some((k) => sp[k as keyof SP]);
  const moreOn = ['from', 'to', 'bmin', 'bmax', 'bhk', 'ptype', 'area', 'purpose', 'req'].filter((k) => sp[k as keyof SP]).length;

  return (
    <>
      <div className="top">
        <h1>Leads</h1>
        <AutoFilterForm className="search" action="/leads">
          {Object.entries(sp).filter(([k, v]) => v && k !== 'q' && k !== 'page').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="search" name="q" defaultValue={term} placeholder="Search name, mobile or area" aria-label="Search leads" />
        </AutoFilterForm>
        {mgr && <Link className="btn" href="/leads/import">Import</Link>}
        {role === 'owner' && <a className="btn" href="/api/export">Export</a>}
        <Link className="btn primary" href="/leads/new">+ Add lead</Link>
      </div>
      {matchName && (
        <div className="banner match-banner">
          <span><b>🔔 These leads wanted something like {matchName}.</b> Their budget fits, plus the home type or area. Call them or send the project from the lead page.</span>
          <form action={dismissMatches}><input type="hidden" name="project_id" value={sp.match} /><button className="btn sm ghost">Hide this list</button></form>
        </div>
      )}
      {!mgr && <div className="banner">{role === 'partner' ? 'You see only the leads you brought in.' : 'You see only the leads assigned to you.'}</div>}

      <AutoFilterForm className="filters" action="/leads">
        {sp.match && <input type="hidden" name="match" value={sp.match} />}
        {sp.view && <input type="hidden" name="view" value={sp.view} />}
        {term && <input type="hidden" name="q" value={term} />}
        <div className="seg">
          <Link href={keep({ view: undefined, page: undefined })} className={!board ? 'on' : ''}>List</Link>
          <Link href={keep({ view: 'board', page: undefined })} className={board ? 'on' : ''}>Board</Link>
        </div>
        <select name="stage" defaultValue={sp.stage ?? ''} aria-label="Stage"><option value="">All stages</option>{STAGES.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}<option value="lost">Lost</option></select>
        <select name="fu" defaultValue={sp.fu ?? ''} aria-label="Follow-up"><option value="">Any follow-up</option><option value="over">Overdue</option><option value="today">Due today</option><option value="due">Overdue + today</option><option value="none">No next step</option><option value="stale">Untouched 14+ days</option></select>
        <select name="score" defaultValue={sp.score ?? ''} aria-label="Interest"><option value="">Hot, warm, cold</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
        <select name="source" defaultValue={sp.source ?? ''} aria-label="Source"><option value="">All sources</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
        {(projects ?? []).length > 0 && <select name="project" defaultValue={sp.project ?? ''} aria-label="Project"><option value="">All projects</option>{(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        {mgr && <select name="agent" defaultValue={sp.agent ?? ''} aria-label="Assigned to"><option value="">Anyone</option><option value="none">Not assigned</option>{agents.map((a) => <option key={a.user_id} value={a.user_id}>{a.full_name}</option>)}</select>}
        <details className="more-filters" open={moreOn > 0}>
          <summary className="btn sm ghost">More filters{moreOn ? ` (${moreOn})` : ''}</summary>
          <div className="mf-grid">
            <label className="field"><span className="label">Came in from</span><input type="date" name="from" defaultValue={sp.from ?? ''} /></label>
            <label className="field"><span className="label">to</span><input type="date" name="to" defaultValue={sp.to ?? ''} /></label>
            <label className="field"><span className="label">Budget from (₹ lakh)</span><input type="number" name="bmin" min="0" step="5" defaultValue={sp.bmin ?? ''} placeholder="e.g. 60" /></label>
            <label className="field"><span className="label">Budget up to (₹ lakh)</span><input type="number" name="bmax" min="0" step="5" defaultValue={sp.bmax ?? ''} placeholder="e.g. 120" /></label>
            <label className="field"><span className="label">BHK / type</span><select name="bhk" defaultValue={sp.bhk ?? ''}><option value="">Any</option>{BHKS.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="field"><span className="label">Property</span><select name="ptype" defaultValue={sp.ptype ?? ''}><option value="">Any</option>{PTYPES.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="field"><span className="label">Area</span><input name="area" list="areas" defaultValue={sp.area ?? ''} placeholder="e.g. Whitefield" /></label>
            <label className="field"><span className="label">Purpose</span><select name="purpose" defaultValue={sp.purpose ?? ''}><option value="">Any</option>{PURPOSES.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label className="field"><span className="label">Requirement</span><select name="req" defaultValue={sp.req ?? ''}><option value="">Any</option><option value="full">Filled (budget, BHK, area)</option><option value="missing">Something missing</option></select></label>
          </div>
          <datalist id="areas">{Object.keys(AREAS).map((a) => <option key={a} value={a} />)}</datalist>
        </details>
        <button className="sr-only" tabIndex={-1}>Apply</button>
        {anyFilter && <Link className="btn sm ghost" href={board ? '/leads?view=board' : '/leads'}>Clear</Link>}
        <span className="hint" style={{ marginLeft: 'auto' }}>{count ?? 0} lead{count === 1 ? '' : 's'}</span>
      </AutoFilterForm>

      {board ? (
        <LeadBoard leads={list.map((l) => ({ ...l, agent: mgr && l.assigned_to ? nameOf.get(l.assigned_to) : undefined }))} />
      ) : (
        <section className="panel">
          {list.length ? (
            <div className="rows">
              <div className="lrow head"><span>Lead</span><span>Looking for</span><span>Stage</span><span>Source</span><span>Next follow-up</span></div>
              {list.map((l) => {
                const fs = fuState(l.next_follow_up);
                const closed = ['booked', 'lost'].includes(l.stage);
                return (
                  <Link key={l.id} href={`/leads/${l.id}`} className="lrow">
                    <span className="c-name"><b><span className={`dot ${l.score}`} />{l.name}</b><span className="hint mono">{fmtPhone(l.phone)}{mgr && l.assigned_to ? <span className="ff"> · {nameOf.get(l.assigned_to)}</span> : mgr ? <span className="ff"> · Not assigned</span> : null}</span></span>
                    <span className="c-req hint">{[l.bhk, fmtBudget(l.budget_min, l.budget_max), l.location].filter(Boolean).join(' · ') || 'Requirement not filled'}</span>
                    <span className="c-stage"><span className={`chip ${stageChip(l.stage)}`}>{stageLabel(l.stage)}</span></span>
                    <span className="c-src hint">{l.source ?? ''}</span>
                    <span className={`c-fu fu ${closed ? '' : fs}`}>{closed ? '' : fs ? fuText(l.next_follow_up) : 'No next step'}</span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="empty">{anyFilter ? 'No leads match these filters.' : <>No leads yet. <Link href="/leads/new">Add your first lead</Link>{mgr ? <> or <Link href="/sources">connect a lead source</Link></> : null}.</>}</div>
          )}
          {(count ?? 0) > PAGE && (
            <div className="pager">
              {page > 1 && <Link className="btn sm" href={keep({ page: String(page - 1) })}>Previous</Link>}
              <span className="hint">Page {page} of {Math.ceil((count ?? 0) / PAGE)}</span>
              {page * PAGE < (count ?? 0) && <Link className="btn sm" href={keep({ page: String(page + 1) })}>Next</Link>}
            </div>
          )}
        </section>
      )}
    </>
  );
}
