import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/context';
import { fmtPhone, isManager, siteUrl, telHref } from '@/lib/roles';
import { ShortlistPanel } from '@/components/ShortlistPanel';
import { inrShort } from '@/lib/money';
import { dismissMatches, recycleCall, addNote, assignLead, deleteLead, markLost, scheduleVisit, setFollowUp, setScore, setStage, updateLead, visitResult } from '@/app/crm-actions';
import { ActionForm, Submit } from '@/components/forms';
import { CopyButton } from '@/components/CopyButton';
import { LeadFields } from '@/components/LeadFields';
import { LogCallForm } from '@/components/LogCallForm';
import { WhatsAppComposer } from '@/components/WhatsAppComposer';
import { LOST_REASONS, STAGES, STAGE_IDX, fmtBudget, fmtDT, fmtDate, fuState, fuText, istAt, stageChip, stageLabel, toLocalInput } from '@/lib/crm';

export const metadata = { title: 'Lead' };

const ICON: Record<string, string> = { call: '☎', whatsapp: '✉', stage: '⚑', visit: '⌂', enquiry: '★', assign: '→', created: '+', note: '✎' };

export default async function LeadPage({ params }: { params: { id: string } }) {
  const { supabase, org, role, user } = await requireOrg();
  const { data: lead } = await supabase.from('leads').select('*').eq('id', params.id).eq('org_id', org.id).maybeSingle();
  if (!lead) notFound();

  const [{ data: acts }, { data: visits }, { data: projects }, { data: people }, { data: templates }] = await Promise.all([
    supabase.from('activities').select('id, type, body, by_user, created_at').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(150),
    supabase.from('visits').select('id, at, status, feedback, interest, agent_id, project_id').eq('lead_id', lead.id).order('at', { ascending: false }),
    supabase.from('projects').select('id, name, location, price_from, price_to, configs').eq('org_id', org.id).order('name'),
    supabase.from('members').select('user_id, full_name, phone, role, active').eq('org_id', org.id),
    supabase.from('templates').select('id, name, use_for, body').eq('org_id', org.id).order('use_for'),
  ]);
  const [{ data: shortlists }, { data: deal }, { data: leadMatches }] = await Promise.all([
    supabase.from('shortlists').select('id, token, project_ids, views, last_viewed_at, reactions, created_at').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(10),
    role === 'owner' ? supabase.from('deals').select('id, agreement_value, commission_amount, status').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('project_matches').select('project_id, reasons, projects(name)').eq('lead_id', lead.id).is('dismissed_at', null).order('created_at', { ascending: false }).limit(5),
  ]);
  const bhkNum = String(lead.bhk ?? '').match(/\d/)?.[0];
  const matchOf = (p: { price_from: number | null; price_to: number | null; configs: string | null; location: string | null }) => {
    const budgetOk = !lead.budget_max || !p.price_from || (Number(p.price_from) <= Number(lead.budget_max) * 1.1 && (!lead.budget_min || !p.price_to || Number(p.price_to) >= Number(lead.budget_min)));
    const bhkOk = !bhkNum || !p.configs || p.configs.includes(bhkNum);
    return budgetOk && bhkOk && Boolean(lead.budget_max || lead.bhk);
  };

  const mgr = isManager(role);
  const canEdit = mgr || lead.assigned_to === user.id;
  const nameOf = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const projectOf = new Map((projects ?? []).map((p) => [p.id, p]));
  const agent = (people ?? []).find((p) => p.user_id === (lead.assigned_to ?? user.id));
  const project = lead.project_id ? projectOf.get(lead.project_id) : undefined;
  const nextVisit = (visits ?? []).filter((v) => v.status === 'scheduled').sort((a, b) => a.at.localeCompare(b.at))[0];
  const idx = lead.stage === 'lost' ? -1 : STAGE_IDX[lead.stage] ?? 0;
  const fs = fuState(lead.next_follow_up);
  const closed = ['booked', 'lost'].includes(lead.stage);
  const assignable = (people ?? []).filter((p) => p.active && p.role !== 'partner');
  const tel = telHref(lead.phone);

  return (
    <>
      <div className="lead-head">
        <Link href="/leads" className="hint">← All leads</Link>
        <div className="lead-title">
          <div>
            <h1>{lead.name}</h1>
            <div className="row-gap">
              <span className="mono big">{fmtPhone(lead.phone)}</span>
              <CopyButton text={lead.phone} label="Copy number" />
              {lead.email && <span className="hint">{lead.email}</span>}
            </div>
            <div className="row-gap" style={{ marginTop: 6 }}>
              <span className={`chip ${stageChip(lead.stage)}`}>{stageLabel(lead.stage)}</span>
              <span className={`chip ${lead.score}`}>{lead.score[0].toUpperCase() + lead.score.slice(1)}</span>
              {lead.source && <span className="chip">{lead.source}</span>}
              <span className="hint">{lead.assigned_to ? `Assigned to ${nameOf.get(lead.assigned_to) ?? '—'}` : 'Not assigned'} · came in {fmtDT(lead.created_at)}</span>
            </div>
          </div>
          {canEdit && (
            <div className="row-gap">
              <a className="btn primary" href={tel}>Call</a>
              <a className="btn wa" href="#whatsapp">WhatsApp</a>
              <a className="btn" href="#visit">Book visit</a>
            </div>
          )}
        </div>
      </div>

      {(leadMatches ?? []).length > 0 && (
        <div className="banner match-banner">
          <span><b>🔔 New project fits this client:</b> {(leadMatches as unknown as { projects: { name: string } | null; reasons: string[] }[]).map((m) => `${m.projects?.name ?? 'Project'} (${m.reasons.join(', ')})`).join(' · ')}</span>
          {!closed && <a className="btn sm primary" href="#shortlist">Send it to them</a>}
          {lead.stage === 'lost' && canEdit && <form action={recycleCall}><input type="hidden" name="id" value={lead.id} /><button className="btn sm primary">Reopen and call</button></form>}
          <form action={dismissMatches}><input type="hidden" name="lead_id" value={lead.id} /><button className="btn sm ghost">Hide</button></form>
        </div>
      )}
      <div className="grid-main">
        <div className="stack">
          {canEdit && !closed && (
            <section className={`panel ${fs === 'over' ? 'warnline' : ''}`}>
              <div className="panel-h"><h2>Next follow-up</h2>{lead.next_follow_up ? <span className={`fu ${fs}`}>{fuText(lead.next_follow_up)}</span> : <span className="chip tape">Not planned</span>}</div>
              <div className="panel-b">
                <form action={setFollowUp} className="row-gap">
                  <input type="hidden" name="id" value={lead.id} />
                  <button className="btn sm" name="preset" value="2h">In 2 hours</button>
                  <button className="btn sm" name="preset" value="tomorrow">Tomorrow 11 AM</button>
                  <button className="btn sm" name="preset" value="3d">In 3 days</button>
                  <button className="btn sm" name="preset" value="week">Next week</button>
                  <input type="datetime-local" name="at" defaultValue={toLocalInput(lead.next_follow_up) || toLocalInput(istAt(1, 11))} aria-label="Pick a time" className="dt" />
                  <button className="btn sm" name="preset" value="custom">Set</button>
                  {lead.next_follow_up && <button className="btn sm ghost" name="preset" value="clear">Clear</button>}
                </form>
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-h"><h2>Stage</h2>{lead.stage === 'lost' && lead.lost_reason && <span className="chip bad">{lead.lost_reason}</span>}</div>
            <div className="panel-b stack">
              <div className="stages">
                {STAGES.map((s, i) => {
                  const cls = lead.stage === s.k ? 'cur' : i <= (lead.max_stage ?? idx) && lead.stage !== 'lost' ? 'done' : '';
                  if (!canEdit) return <span key={s.k} className={`stg ${cls}`}>{s.l}</span>;
                  if (s.k === 'visit') return <a key={s.k} href="#visit" className={`stg ${cls}`}>{s.l}</a>;
                  return (
                    <form key={s.k} action={setStage}><input type="hidden" name="id" value={lead.id} /><input type="hidden" name="stage" value={s.k} />
                      <button className={`stg ${cls}`} disabled={lead.stage === s.k}>{s.l}</button></form>
                  );
                })}
              </div>
              {canEdit && lead.stage !== 'lost' && (
                <details>
                  <summary className="btn sm ghost danger">Mark as lost</summary>
                  <ActionForm action={markLost} className="stack inline-box">
                    <input type="hidden" name="id" value={lead.id} />
                    <label className="field"><span className="label">Why was this lead lost?</span><select name="reason" required defaultValue=""><option value="" disabled>Pick a reason</option>{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
                    <input name="note" placeholder="Note (optional)" />
                    <Submit className="btn sm danger">Mark lost</Submit>
                  </ActionForm>
                </details>
              )}
              {canEdit && (
                <div className="row-gap">
                  <span className="label">Interest</span>
                  <form action={setScore} className="row-gap"><input type="hidden" name="id" value={lead.id} />
                    {['hot', 'warm', 'cold'].map((s) => <button key={s} name="score" value={s} className={`btn sm ${lead.score === s ? 'primary' : ''}`}>{s[0].toUpperCase() + s.slice(1)}</button>)}
                  </form>
                </div>
              )}
              {mgr && (
                <form action={assignLead} className="row-gap">
                  <input type="hidden" name="id" value={lead.id} />
                  <span className="label">Assigned to</span>
                  <select name="assigned_to" defaultValue={lead.assigned_to ?? ''} className="auto"><option value="">Not assigned</option>{assignable.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select>
                  <button className="btn sm">Save</button>
                </form>
              )}
            </div>
          </section>

          {canEdit && (
            <section className="panel">
              <div className="panel-h"><h2>Log a call</h2>{lead.call_attempts ? <span className="hint">{lead.call_attempts} call{lead.call_attempts === 1 ? '' : 's'} so far</span> : null}</div>
              <div className="panel-b"><LogCallForm leadId={lead.id} /></div>
            </section>
          )}

          <section className="panel">
            <div className="panel-h"><h2>Notes and history</h2></div>
            <div className="panel-b stack">
              {canEdit && (
                <ActionForm action={addNote} className="stack">
                  <input type="hidden" name="id" value={lead.id} />
                  <textarea name="body" rows={2} placeholder="Example: Wants east facing, loan pre-approved, wife will come on Sunday." />
                  <div><Submit className="btn sm">Save note</Submit></div>
                </ActionForm>
              )}
              <ol className="timeline">
                {(acts ?? []).map((a) => (
                  <li key={a.id}>
                    <span className="tl-ic" aria-hidden="true">{ICON[a.type] ?? '•'}</span>
                    <div><div className="tl-t">{a.body}</div><div className="hint">{fmtDT(a.created_at)}{a.by_user && nameOf.get(a.by_user) ? ' · ' + nameOf.get(a.by_user) : a.by_user ? '' : ' · automatic'}</div></div>
                  </li>
                ))}
                {!(acts ?? []).length && <li className="hint">Nothing logged yet.</li>}
              </ol>
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>What they want</h2></div>
            <div className="panel-b">
              <dl className="kv">
                <div><dt className="label">Budget</dt><dd>{fmtBudget(lead.budget_min, lead.budget_max) || '—'}</dd></div>
                <div><dt className="label">Looking for</dt><dd>{[lead.bhk, lead.property_type].filter(Boolean).join(', ') || '—'}</dd></div>
                <div><dt className="label">Location</dt><dd>{lead.location || '—'}</dd></div>
                <div><dt className="label">Project</dt><dd>{project?.name || '—'}</dd></div>
                <div><dt className="label">Purpose</dt><dd>{lead.purpose || '—'}</dd></div>
                <div><dt className="label">Best time to talk</dt><dd>{lead.preferred_slot || '—'}</dd></div>
                <div><dt className="label">Date of birth</dt><dd>{fmtDate(lead.dob) || '—'}</dd></div>
                <div><dt className="label">Source</dt><dd>{lead.source || '—'}</dd></div>
              </dl>
              {canEdit && (
                <details>
                  <summary className="btn sm">Edit details</summary>
                  <ActionForm action={updateLead} className="stack inline-box">
                    <LeadFields lead={lead} projects={projects ?? []} />
                    <div><Submit className="btn sm primary">Save changes</Submit></div>
                  </ActionForm>
                </details>
              )}
            </div>
          </section>

          {canEdit && (
            <section className="panel" id="whatsapp">
              <div className="panel-h"><h2>WhatsApp the client</h2></div>
              <div className="panel-b">
                <WhatsAppComposer
                  leadId={lead.id}
                  phone={lead.phone}
                  templates={templates ?? []}
                  defaultUse={lead.stage === 'new' ? 'Welcome' : nextVisit ? 'Visit reminder' : 'Follow-up'}
                  ctx={{
                    name: lead.name, agent: agent?.full_name, agent_phone: agent?.phone ? fmtPhone(agent.phone) : '', company: org.name,
                    project: project?.name, visit_time: nextVisit ? fmtDT(nextVisit.at) : '', budget: fmtBudget(lead.budget_min, lead.budget_max),
                    location: lead.location, bhk: lead.bhk,
                  }}
                />
              </div>
            </section>
          )}

          {(canEdit || mgr) && !closed && (
            <section className="panel" id="shortlist">
              <div className="panel-h"><h2>Send homes to the client</h2><span className="hint">One link with photos, price and map</span></div>
              <div className="panel-b">
                <ShortlistPanel leadId={lead.id} firstName={lead.name.split(' ')[0]} phone={lead.phone} base={siteUrl()}
                  projects={(projects ?? []).map((p) => ({ ...p, match: matchOf(p) })).sort((a, b) => Number(b.match) - Number(a.match))}
                  past={(shortlists ?? []) as never} />
              </div>
            </section>
          )}
          {role === 'owner' && (['token', 'booked'].includes(lead.stage) || deal) && (
            <section className="panel">
              <div className="panel-h"><h2>Deal and money</h2><span className="chip tape">Admins only</span></div>
              <div className="panel-b">
                {deal ? (
                  <div className="stack"><p>Value {inrShort(deal.agreement_value)} · commission {inrShort(deal.commission_amount)}{deal.status === 'cancelled' ? ' · cancelled' : ''}</p><Link className="btn sm" href={`/money/deals/${deal.id}`}>Open deal and payments</Link></div>
                ) : (
                  <div className="stack"><p className="hint">Add the deal value, commission and buyer payment plan.</p><Link className="btn sm primary" href={`/money/deals/new?lead=${lead.id}`}>Add deal details</Link></div>
                )}
              </div>
            </section>
          )}
          <section className="panel" id="visit">
            <div className="panel-h"><h2>Site visits</h2></div>
            <div className="panel-b stack">
              {(visits ?? []).map((v) => (
                <div key={v.id} className="visit">
                  <div className="row-gap">
                    <b>{fmtDT(v.at)}</b>
                    <span className={`chip ${v.status === 'done' ? 'good' : v.status === 'scheduled' ? 'acc' : 'bad'}`}>{v.status === 'done' ? 'Done' : v.status === 'scheduled' ? 'Booked' : v.status === 'noshow' ? 'Did not come' : 'Cancelled'}</span>
                  </div>
                  <div className="hint">{(v.project_id && projectOf.get(v.project_id)?.name) || 'Project not set'}{v.agent_id ? ' · ' + (nameOf.get(v.agent_id) ?? '') : ''}</div>
                  {v.feedback && <div className="hint">“{v.feedback}”</div>}
                  {v.status === 'scheduled' && canEdit && (
                    <details>
                      <summary className="btn sm">How did it go?</summary>
                      <ActionForm action={visitResult} className="stack inline-box">
                        <input type="hidden" name="visit_id" value={v.id} />
                        <select name="status" defaultValue="done"><option value="done">Came and saw the site</option><option value="noshow">Did not come</option><option value="cancelled">Cancelled</option></select>
                        <select name="interest" defaultValue="warm" aria-label="Interest after visit"><option value="hot">Hot after visit</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
                        <textarea name="feedback" rows={2} placeholder="What did they say?" />
                        <label className="field"><span className="label">Next follow-up</span><input type="datetime-local" name="next" defaultValue={toLocalInput(istAt(1, 11))} /></label>
                        <Submit className="btn sm primary">Save</Submit>
                      </ActionForm>
                    </details>
                  )}
                </div>
              ))}
              {canEdit && (
                <ActionForm action={scheduleVisit} className="stack">
                  <input type="hidden" name="lead_id" value={lead.id} />
                  <span className="label">Book a site visit</span>
                  <select name="project_id" defaultValue={lead.project_id ?? ''} aria-label="Project"><option value="">Choose project</option>{(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  <input type="datetime-local" name="at" required defaultValue={toLocalInput(istAt(1, 11))} aria-label="Date and time" />
                  {mgr && <select name="agent_id" defaultValue={lead.assigned_to ?? ''} aria-label="Who will meet them"><option value="">Assigned agent</option>{assignable.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select>}
                  <Submit className="btn sm primary">Book visit</Submit>
                </ActionForm>
              )}
              {!(visits ?? []).length && !canEdit && <p className="hint">No visits yet.</p>}
            </div>
          </section>

          {mgr && (
            <details className="danger-zone">
              <summary className="btn sm ghost danger">Delete this lead</summary>
              <form action={deleteLead} className="stack inline-box">
                <input type="hidden" name="id" value={lead.id} />
                <p className="hint">This removes the lead, its history and visits for good.</p>
                <button className="btn sm danger">Yes, delete for good</button>
              </form>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
