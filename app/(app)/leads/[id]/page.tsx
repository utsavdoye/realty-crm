import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/context';
import { fmtPhone, isManager, normPhone, siteUrl, telHref } from '@/lib/roles';
import { websiteUrl } from '@/lib/website';
import { ShortlistPanel } from '@/components/ShortlistPanel';
import { CallButton } from '@/components/CallButton';
import { CheckInButton } from '@/components/CheckInButton';
import { inrShort } from '@/lib/money';
import { completeStep, undoStep } from '@/app/crm-actions';
import { STEPS, clientSummary, clientSummaryHi, currentStep, peopleWhoSpoke, stepLabel, type StepRow } from '@/lib/journey';
import { dismissMatches, recycleCall, addNote, assignLead, deleteLead, markLost, scheduleVisit, setFollowUp, setScore, setStage, updateLead, visitResult } from '@/app/crm-actions';
import { ActionForm, Submit } from '@/components/forms';
import { CopyButton } from '@/components/CopyButton';
import { LeadFields } from '@/components/LeadFields';
import { LogCallForm } from '@/components/LogCallForm';
import { WhatsAppComposer } from '@/components/WhatsAppComposer';
import { LOST_REASONS, SCORES, fmtBudget, fmtDT, fmtDate, fuState, fuText, istAt, istDay, scoreLabel, stageChip, stageLabel, toLocalInput } from '@/lib/crm';
import { ProjectPick } from '@/components/LeadPick';
import { Timeline } from '@/components/Timeline';

export const metadata = { title: 'Lead' };


export default async function LeadPage({ params }: { params: { id: string } }) {
  const { supabase, org, role, user } = await requireOrg();
  const { data: lead } = await supabase.from('leads').select('*').eq('id', params.id).eq('org_id', org.id).maybeSingle();
  if (!lead) notFound();

  const [{ data: acts }, { data: visits }, { data: projects }, { data: people }, { data: templates }] = await Promise.all([
    supabase.from('activities').select('id, type, body, by_user, created_at').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(150),
    supabase.from('visits').select('id, at, status, feedback, interest, agent_id, project_id, checkin_at, checkin_address, checkin_distance_m, checkin_lat, checkin_lng, checkin_accuracy').eq('lead_id', lead.id).order('at', { ascending: false }),
    supabase.from('projects').select('id, name, location, price_from, price_to, configs, type, status, photos').eq('org_id', org.id).order('name'),
    supabase.from('members').select('user_id, full_name, phone, role, active').eq('org_id', org.id),
    supabase.from('templates').select('id, name, use_for, body').eq('org_id', org.id).order('use_for'),
  ]);
  const web = await websiteUrl(supabase, org.id);
  // Website account of this client (patch-027): matched by mobile or email, and the homes they saved there.
  const leadPhone = normPhone(lead.phone);
  const [{ data: wcByLead }, { data: wcByPhone }, { data: wcByEmail }] = await Promise.all([
    supabase.from('website_clients').select('id, name, email, phone, created_at, last_seen_at').eq('org_id', org.id).eq('lead_id', lead.id).limit(1), // patch-029
    leadPhone ? supabase.from('website_clients').select('id, name, email, phone, created_at, last_seen_at').eq('org_id', org.id).eq('phone', leadPhone).limit(1) : Promise.resolve({ data: [] }),
    lead.email ? supabase.from('website_clients').select('id, name, email, phone, created_at, last_seen_at').eq('org_id', org.id).ilike('email', String(lead.email).replace(/[%_]/g, '')).limit(1) : Promise.resolve({ data: [] }),
  ]);
  const webClient = ((wcByLead ?? [])[0] ?? (wcByPhone ?? [])[0] ?? (wcByEmail ?? [])[0] ?? null) as { id: string; name: string | null; email: string | null; phone: string | null; created_at: string; last_seen_at: string } | null;
  const { data: webSaves } = webClient
    ? await supabase.from('website_saves').select('project_id, created_at').eq('client_id', webClient.id).order('created_at', { ascending: false })
    : { data: [] as { project_id: string; created_at: string }[] };
  const [{ data: shortlists }, { data: deal }, { data: leadMatches }, { data: stepRows }, { data: teams }] = await Promise.all([
    supabase.from('shortlists').select('id, token, project_ids, views, last_viewed_at, reactions, created_at').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(10),
    role === 'owner' ? supabase.from('deals').select('id, agreement_value, commission_amount, status').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('project_matches').select('project_id, reasons, projects(name)').eq('lead_id', lead.id).is('dismissed_at', null).order('created_at', { ascending: false }).limit(5),
    supabase.from('lead_steps').select('step, done_at, done_by, summary, details').eq('lead_id', lead.id),
    supabase.from('step_teams').select('step, user_id').eq('org_id', org.id),
  ]);
  // Money for this client (admin only): what the buyer paid and what commission came in.
  const [{ data: inst }, { data: moneyIn }] = deal ? await Promise.all([
    supabase.from('deal_installments').select('amount, paid_amount').eq('deal_id', deal.id),
    supabase.from('money_entries').select('amount, category').eq('deal_id', deal.id).eq('direction', 'in'),
  ]) : [{ data: [] }, { data: [] }];
  const buyerDue = (inst ?? []).reduce((a, i) => a + Number(i.amount), 0);
  const buyerPaid = (inst ?? []).reduce((a, i) => a + Number(i.paid_amount), 0);
  const commIn = (moneyIn ?? []).filter((e) => e.category === 'Commission').reduce((a, e) => a + Number(e.amount), 0);
  const otherIn = (moneyIn ?? []).filter((e) => e.category !== 'Commission').reduce((a, e) => a + Number(e.amount), 0);
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
  const fs = fuState(lead.next_follow_up);
  const closed = ['booked', 'lost'].includes(lead.stage);
  const assignable = (people ?? []).filter((p) => p.active && p.role !== 'partner');
  const tel = telHref(lead.phone);
  const admin = role === 'owner';
  const steps = (stepRows ?? []) as StepRow[];
  const stepOf = new Map(steps.map((x) => [x.step, x]));
  const cur = lead.stage === 'lost' ? null : currentStep(new Set(steps.map((x) => x.step)), admin);
  const teamFor = (k: string) => (teams ?? []).filter((t) => t.step === k).map((t) => nameOf.get(t.user_id)).filter(Boolean) as string[];
  const canDoStep = admin || role === 'manager' || lead.assigned_to === user.id;
  const visibleSteps = STEPS.filter((x) => x.k !== 'payment' || admin);
  const summary = clientSummary(lead, steps, (acts ?? []) as never, nameOf, project?.name, cur);
  const summaryHi = clientSummaryHi(lead, steps, (acts ?? []) as never, nameOf, project?.name, cur);
  const spoke = peopleWhoSpoke((acts ?? []) as never, steps, nameOf);
  // A call can finish these steps (from the "How did the call go?" form).
  const callStep = cur && ['call', 'presentation', 'followup'].includes(cur) && (admin || role === 'manager' || lead.assigned_to === user.id)
    ? { k: cur, label: stepLabel(cur), next: (() => { const n = ({ call: 'presentation', presentation: 'visit', followup: null } as Record<string, string | null>)[cur]; return n ? (teamFor(n).join(' / ') || null) : null; })() }
    : null;
  const nextAfter = (k: string) => { const order = ['call', 'presentation', 'visit', 'followup']; const i = order.indexOf(k); return i >= 0 && i < 3 ? order[i + 1] : null; };

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
              {(lead.other_phones ?? []).length > 0 && <span className="hint">Also: {(lead.other_phones as string[]).map((x) => fmtPhone(x)).join(', ')}</span>}
              {lead.email && <span className="hint">{lead.email}</span>}
            </div>
            <div className="row-gap" style={{ marginTop: 6 }}>
              <span className={`chip ${stageChip(lead.stage)}`}>{lead.stage === 'lost' ? 'Lost' : lead.stage === 'booked' ? 'Booked' : cur ? `Now: ${stepLabel(cur)}` : stageLabel(lead.stage)}</span>
              <span className={`chip ${lead.score}`}>{scoreLabel(lead.score)}</span>
              {lead.segment === 'secondary' && <span className="chip">Secondary</span>}
              {lead.source && <span className="chip">{lead.source}</span>}
              <span className="hint">{lead.assigned_to ? `Assigned to ${nameOf.get(lead.assigned_to) ?? '—'}` : 'Not assigned'} · came in {fmtDT(lead.created_at)}</span>
            </div>
          </div>
          {canEdit && (
            <div className="row-gap">
              <CallButton leadId={lead.id} name={lead.name} tel={tel} step={callStep}>Call</CallButton>
              <a className="btn wa" href="#whatsapp">WhatsApp</a>
              <a className="btn" href="#visit">Book visit</a>
              {admin && <a className="btn" href="#money">₹ Payments</a>}
            </div>
          )}
        </div>
      </div>

      {(leadMatches ?? []).length > 0 && (
        <div className="banner match-banner">
          <span><b>New project fits this client:</b> {(leadMatches as unknown as { projects: { name: string } | null; reasons: string[] }[]).map((m) => `${m.projects?.name ?? 'Project'} (${m.reasons.join(', ')})`).join(' · ')}</span>
          {!closed && <a className="btn sm primary" href="#shortlist">Send it to them</a>}
          {lead.stage === 'lost' && canEdit && <form action={recycleCall}><input type="hidden" name="id" value={lead.id} /><button className="btn sm primary">Reopen and call</button></form>}
          <form action={dismissMatches}><input type="hidden" name="lead_id" value={lead.id} /><button className="btn sm ghost">Hide</button></form>
        </div>
      )}
      <div className="grid-main">
        <div className="stack">
          <section className="panel" id="journey">
            <div className="panel-h"><h2>Client journey</h2><span className="hint">{visibleSteps.filter((x) => stepOf.has(x.k)).length} of {visibleSteps.length} done</span></div>
            <div className="panel-b">
              <div className="journey">
                {visibleSteps.map((x, i) => {
                  const row = stepOf.get(x.k);
                  const now = !row && x.k === cur;
                  const nxt = nextAfter(x.k);
                  return (
                    <div key={x.k} className={`jstep ${row ? 'done' : now ? 'now' : 'later'}`}>
                      <span className="jdot" aria-hidden="true">{row ? '✓' : i + 1}</span>
                      <div>
                        <div className="jt">{x.l}{now && <span className="chip acc" style={{ marginLeft: 8 }}>Now</span>}</div>
                        {row && <div className="hint">{row.done_by ? (nameOf.get(row.done_by) ?? 'Former team member') : 'Automatic'} · {fmtDT(row.done_at)}</div>}
                        {row?.summary && <div className="jsum">{row.summary}</div>}
                        {row && admin && x.k !== 'received' && (
                          <form action={undoStep}><input type="hidden" name="id" value={lead.id} /><input type="hidden" name="step" value={x.k} /><button className="linkbtn small">Undo this tick</button></form>
                        )}
                        {now && x.k !== 'payment' && (
                          <div className="hint">With {lead.assigned_to ? nameOf.get(lead.assigned_to) ?? '—' : 'nobody yet'}{nxt && teamFor(nxt).length ? ` · then goes to ${teamFor(nxt).join(' / ')} for ${stepLabel(nxt).toLowerCase()}` : ''}</div>
                        )}
                        {now && x.k === 'payment' && <div className="hint">Ticks by itself when you record money from this client. <a href="#money">Open payments</a></div>}
                        {!row && (now || admin) && x.k !== 'payment' && x.k !== 'received' && canDoStep && !closed && (
                          <details open={now} className="jdetails">
                            <summary className="linkbtn small">{now ? `Finish ${x.l.toLowerCase()}` : `Mark ${x.l.toLowerCase()} done`}</summary>
                            <ActionForm action={completeStep} className="jform">
                              <input type="hidden" name="id" value={lead.id} /><input type="hidden" name="step" value={x.k} />
                              {(x.k === 'presentation' || x.k === 'visit') && (
                                <ProjectPick projects={(projects ?? []).map((p) => ({ id: p.id, name: p.name }))} projectId={lead.project_id} label={null}
                                  required={x.k === 'presentation'} placeholder={x.k === 'presentation' ? 'Which project did you present?' : 'Which project did they see?'} />
                              )}
                              <textarea name="said" rows={3} required minLength={3} placeholder={
                                x.k === 'call' ? 'What did you discuss? Budget, family, loan, timeline, doubts…'
                                : x.k === 'presentation' ? 'What did you show and explain? Units, prices, offers…'
                                : x.k === 'visit' ? 'How did the visit go? What did they like or not like?'
                                : 'What was discussed in the follow-up?'} />
                              {x.k === 'presentation' && <input name="extra" placeholder="How did the client react? (e.g. liked the view, worried about price)" />}
                              {x.k === 'followup' && <input name="extra" placeholder="Decision so far (e.g. will book this week, needs loan approval)" />}
                              <div><Submit className="btn sm primary">{nxt && teamFor(nxt).length ? 'Save and hand over' : 'Save'}</Submit></div>
                            </ActionForm>
                          </details>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {lead.stage === 'lost' && <p className="hint">This client is marked lost, so the journey is paused.</p>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Status</h2><span className={`chip ${stageChip(lead.stage)}`}>{stageLabel(lead.stage)}</span>{lead.stage === 'lost' && lead.lost_reason && <span className="chip bad">{lead.lost_reason}</span>}</div>
            <div className={`panel-b stack ${fs === 'over' && !closed ? 'warnline-in' : ''}`}>
              <p className="hint">The status follows the client journey above by itself. {lead.stage === 'booked' ? 'This client has booked.' : ''}</p>
              {canEdit && !closed && (
                <form action={setFollowUp} className="fu-row">
                  <input type="hidden" name="id" value={lead.id} />
                  <span className="label">Next follow-up</span>
                  {lead.next_follow_up ? <span className={`fu ${fs}`}>{fuText(lead.next_follow_up)}</span> : <span className="chip tape">Not planned</span>}
                  <span className="row-gap">
                    <button className="btn sm" name="preset" value="eod">By end of day</button>
                    <button className="btn sm" name="preset" value="tomorrow">Tomorrow</button>
                    <button className="btn sm" name="preset" value="3d">In 3 days</button>
                    <details className="fu-custom">
                      <summary className="btn sm">Custom</summary>
                      <span className="row-gap">
                        <input type="datetime-local" name="at" defaultValue={toLocalInput(lead.next_follow_up) || toLocalInput(istAt(1, 11))} aria-label="Pick a time" className="dt" />
                        <button className="btn sm primary" name="preset" value="custom">Set</button>
                      </span>
                    </details>
                    {lead.next_follow_up && <button className="btn sm ghost" name="preset" value="clear">Clear</button>}
                  </span>
                </form>
              )}
              {admin && !['booked', 'lost'].includes(lead.stage) && (
                <form action={setStage}><input type="hidden" name="id" value={lead.id} /><input type="hidden" name="stage" value="booked" />
                  <button className="btn sm">Mark as booked</button></form>
              )}
              {lead.stage === 'lost' && canEdit && (
                <form action={recycleCall}><input type="hidden" name="id" value={lead.id} /><button className="btn sm">Reopen this client</button></form>
              )}
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
                    {SCORES.map((x) => <button key={x.k} name="score" value={x.k} className={`btn sm ${lead.score === x.k ? 'primary' : ''}`}>{x.l}</button>)}
                  </form>
                </div>
              )}
              {admin && (
                <form action={assignLead} className="row-gap">
                  <input type="hidden" name="id" value={lead.id} />
                  <span className="label">Assigned to</span>
                  <select name="assigned_to" defaultValue={lead.assigned_to ?? ''} className="auto"><option value="">Not assigned</option>{assignable.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select>
                  <input name="reason" placeholder="Reason (optional)" maxLength={200} className="auto" />
                  <button className="btn sm">Save</button>
                </form>
              )}
            </div>
          </section>

          {canEdit && (
            <section className="panel">
              <div className="panel-h"><h2>Log a call</h2>{lead.call_attempts ? <span className="hint">{lead.call_attempts} call{lead.call_attempts === 1 ? '' : 's'} so far</span> : null}</div>
              <div className="panel-b"><LogCallForm leadId={lead.id} voice={Boolean(process.env.GEMINI_API_KEY)} /></div>
            </section>
          )}

          <section className="panel">
            <div className="panel-h"><h2>Timeline</h2><span className="hint">Everything that happened, newest first</span></div>
            <div className="panel-b stack">
              {canEdit && (
                <ActionForm action={addNote} className="stack" resetOnOk>
                  <input type="hidden" name="id" value={lead.id} />
                  <textarea name="body" rows={2} placeholder="Example: Wants east facing, loan pre-approved, wife will come on Sunday." />
                  <div><Submit className="btn sm">Save note</Submit></div>
                </ActionForm>
              )}
              <Timeline items={(acts ?? []).map((a) => ({ id: a.id, type: a.type, body: a.body, at: a.created_at, day: istDay(a.created_at), who: a.by_user ? nameOf.get(a.by_user) ?? 'Former team member' : null, time: fmtDT(a.created_at) }))} />
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Client summary</h2><span className="hint">Made from what the team saved</span></div>
            <div className="panel-b stack">
              <p className="sumbox" data-hi={summaryHi}>{summary}</p>
              {spoke.length > 0 && (
                <div className="spoke">
                  <span className="label">Who spoke to the client</span>
                  {spoke.map((p) => (
                    <div key={p.id} className="spoke-p">
                      <b>{p.name}</b>
                      <div className="hint">{[p.steps.length ? p.steps.join(', ') : null, p.calls ? `${p.calls} call${p.calls === 1 ? '' : 's'}` : null, `last ${fmtDT(p.last)}`].filter(Boolean).join(' · ')}</div>
                      {p.notes.length > 0 && <ul>{p.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>What they want</h2></div>
            <div className="panel-b">
              <dl className="kv">
                <div><dt className="label">Category</dt><dd>{lead.category || '—'}</dd></div>
                <div><dt className="label">Configuration</dt><dd>{lead.category === 'Commercial' ? 'Not needed' : lead.bhk || '—'}</dd></div>
                <div><dt className="label">Property type</dt><dd>{lead.property_type || '—'}</dd></div>
                <div><dt className="label">Budget</dt><dd>{fmtBudget(lead.budget_min, lead.budget_max) || '—'}</dd></div>
                <div><dt className="label">Area they want</dt><dd>{lead.location || '—'}</dd></div>
                <div><dt className="label">Project</dt><dd>{project?.name || lead.project_other || '—'}</dd></div>
                <div><dt className="label">Purpose</dt><dd>{lead.purpose || '—'}</dd></div>
                <div><dt className="label">Funding</dt><dd>{lead.funding || '—'}</dd></div>
                <div><dt className="label">Best time to talk</dt><dd>{lead.preferred_slot || '—'}</dd></div>
                <div><dt className="label">Source</dt><dd>{lead.source || '—'}{lead.segment === 'secondary' ? ' · Secondary' : ''}</dd></div>
                {(lead.city || lead.pincode) && <div><dt className="label">Lives in</dt><dd>{[lead.city, lead.pincode].filter(Boolean).join(' ')}</dd></div>}
                {lead.occupation && <div><dt className="label">Occupation</dt><dd>{lead.occupation}</dd></div>}
                {lead.dob && <div><dt className="label">Date of birth</dt><dd>{fmtDate(lead.dob)}</dd></div>}
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

          {webClient && (
            <section className="panel" id="website-account">
              <div className="panel-h"><h2>On your website</h2><span className="hint">Account since {fmtDate(webClient.created_at)} · last seen {fmtDT(webClient.last_seen_at)}</span></div>
              <div className="panel-b stack" style={{ gap: 8 }}>
                <span className="hint">{[webClient.name, webClient.email, webClient.phone ? fmtPhone(webClient.phone) : ''].filter(Boolean).join(' · ')}</span>
                {(webSaves ?? []).length ? (
                  <div className="amen">{(webSaves ?? []).map((w) => {
                    const pr = (projects ?? []).find((x) => x.id === w.project_id);
                    return <span key={w.project_id}>{pr?.name ?? 'Project'}</span>;
                  })}</div>
                ) : <span className="hint">No saved homes yet.</span>}
              </div>
            </section>
          )}

          {(canEdit || mgr) && !closed && (
            <section className="panel" id="shortlist">
              <div className="panel-h"><h2>Send homes to the client</h2><span className="hint">One link with photos, price and map</span></div>
              <div className="panel-b">
                <ShortlistPanel leadId={lead.id} firstName={lead.name.split(' ')[0]} phone={lead.phone} base={siteUrl()} web={web}
                  projects={(projects ?? []).map((p) => ({ ...p, match: matchOf(p) })).sort((a, b) => Number(b.match) - Number(a.match))}
                  past={(shortlists ?? []) as never} />
              </div>
            </section>
          )}
          {admin && (
            <section className="panel" id="money">
              <div className="panel-h"><h2>Payments</h2><span className="chip tape">Only admins see this</span></div>
              <div className="panel-b">
                {deal ? (
                  <div className="stack">
                    <dl className="kv">
                      <div><dt className="label">Home price</dt><dd>{inrShort(deal.agreement_value)}{deal.status === 'cancelled' ? ' (cancelled)' : ''}</dd></div>
                      <div><dt className="label">Buyer has paid</dt><dd>{inrShort(buyerPaid)}{buyerDue ? ` of ${inrShort(buyerDue)}` : ''}</dd></div>
                      <div><dt className="label">Our commission</dt><dd>{inrShort(commIn)} received of {inrShort(deal.commission_amount)}</dd></div>
                      {otherIn > 0 && <div><dt className="label">Other money in</dt><dd>{inrShort(otherIn)}</dd></div>}
                    </dl>
                    <Link className="btn sm" href={`/money/deals/${deal.id}`}>Open full payment details</Link>
                  </div>
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
                  {v.checkin_at ? (
                    <div className="hint">Checked in {fmtDT(v.checkin_at)}{v.checkin_distance_m != null ? ` · ${v.checkin_distance_m < 1000 ? v.checkin_distance_m + ' m' : (v.checkin_distance_m / 1000).toFixed(1) + ' km'} from the project` : ''}{v.checkin_address ? ` · ${v.checkin_address}` : ''}
                      {(admin || role === 'manager') && v.checkin_lat != null && <> · <a href={`https://www.google.com/maps?q=${v.checkin_lat},${v.checkin_lng}`} target="_blank" rel="noopener noreferrer">see on map</a></>}
                      {v.checkin_distance_m != null && v.checkin_distance_m > 1500 && <span className="chip bad" style={{ marginLeft: 6 }}>Far from the project</span>}
                    </div>
                  ) : v.status === 'scheduled' && canEdit && (Math.abs(new Date(v.at).getTime() - Date.now()) < 12 * 3600000) ? <CheckInButton visitId={v.id} /> : null}
                  {v.status === 'scheduled' && canEdit && (
                    <details>
                      <summary className="btn sm">How did it go?</summary>
                      <ActionForm action={visitResult} className="stack inline-box">
                        <input type="hidden" name="visit_id" value={v.id} />
                        <select name="status" defaultValue="done"><option value="done">Came and saw the site</option><option value="noshow">Did not come</option><option value="cancelled">Cancelled</option></select>
                        <textarea name="feedback" rows={2} placeholder="What did they say?" />
                        <label className="field"><span className="label">Next follow-up</span><input type="datetime-local" name="next" defaultValue={toLocalInput(istAt(1, 11))} /></label>
                        <Submit className="btn sm primary">Save</Submit>
                      </ActionForm>
                    </details>
                  )}
                </div>
              ))}
              {canEdit && (
                <ActionForm action={scheduleVisit} className="stack" resetOnOk>
                  <input type="hidden" name="lead_id" value={lead.id} />
                  <span className="label">Book a site visit</span>
                  <select name="project_id" defaultValue={lead.project_id ?? ''} aria-label="Project"><option value="">Choose project</option>{(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  <input type="datetime-local" name="at" required defaultValue={toLocalInput(istAt(1, 11))} aria-label="Date and time" />
                  {mgr && <select name="agent_id" defaultValue={lead.assigned_to ?? ''} aria-label="Who will meet them"><option value="">Assigned agent</option>{assignable.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}{(people ?? []).filter((p) => p.active && p.role === 'partner').map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name} (channel partner)</option>)}</select>}
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
                <p className="hint">The lead leaves every list. The admin can see who deleted it and bring it back from Leads → Deleted.</p>
                <input name="reason" placeholder="Why? (e.g. duplicate, test entry)" maxLength={200} />
                <button className="btn sm danger">Yes, delete</button>
              </form>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
