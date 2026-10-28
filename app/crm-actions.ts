'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOrg } from '@/lib/context';
import { PHONE_HELP, isManager, normPhone, validPhone } from '@/lib/roles';
import { FURNISHING, POSSESSION_PREFS, WANTS, BHKS, CATEGORIES, fmtBudget, FUNDING, OCCUPATIONS, OUTCOMES, PTYPES, PURPOSES, SCORE_KEYS, STAGE_IDX, fmtDT, fromLocalInput, istAt, parseBudget, readBudget, stageLabel } from '@/lib/crm';
import { notifyLeadAssigned } from '@/lib/whatsapp';
import type { FormState } from '@/app/actions';
import { parseLatLng } from '@/lib/places';
import { downloadUrl, syncProjectInventory } from '@/lib/inventorySync';
import { translateMissing, translateProject } from '@/lib/projectHindi';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const orNull = (v: string) => (v ? v : null);

function friendly(msg?: string) {
  if (!msg) return 'Something went wrong. Please try again.';
  if (msg.includes('duplicate key') && msg.includes('leads')) return 'This mobile number is already in your CRM.';
  if (msg.includes('row-level security')) return 'You do not have permission to do that.';
  return msg;
}

function refresh(leadId?: string) {
  revalidatePath('/leads');
  revalidatePath('/dashboard');
  revalidatePath('/visits');
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

async function ctx() {
  const c = await requireOrg();
  async function activity(leadId: string, type: string, body: string) {
    await c.supabase.from('activities').insert({ org_id: c.org.id, lead_id: leadId, type, body });
  }
  async function getLead(id: string) {
    const { data } = await c.supabase.from('leads').select('*').eq('id', id).eq('org_id', c.org.id).maybeSingle();
    return data as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  return { ...c, activity, getLead };
}

// ---------- Leads ----------

/** A value from a fixed list, or "Other: what they typed" kept short. */
const pickOf = (v: string, list: string[]) => (!v ? null : list.includes(v) ? v : v.slice(0, 40));

function readLeadFields(fd: FormData, isNew: boolean) {
  const bv = str(fd, 'budget');
  const b = bv === 'keep' ? undefined : readBudget(bv);
  const proj = str(fd, 'project_id');
  const pin = str(fd, 'pincode').replace(/\s/g, '');
  const category = pickOf(str(fd, 'category'), CATEGORIES);
  const f: Record<string, unknown> = {
    name: str(fd, 'name').slice(0, 120),
    phone: normPhone(str(fd, 'phone')),
    email: orNull(str(fd, 'email').slice(0, 160)),
    dob: /^\d{4}-\d{2}-\d{2}$/.test(str(fd, 'dob')) ? str(fd, 'dob') : null,
    category,
    bhk: category === 'Commercial' ? null : pickOf(str(fd, 'bhk'), BHKS),
    property_type: pickOf(str(fd, 'property_type'), PTYPES),
    location: orNull(str(fd, 'location').slice(0, 200)),
    city: orNull(str(fd, 'city').slice(0, 80)),
    pincode: /^[1-9]\d{5}$/.test(pin) ? pin : null,
    occupation: pickOf(str(fd, 'occupation'), OCCUPATIONS),
    funding: pickOf(str(fd, 'funding'), FUNDING),
    purpose: pickOf(str(fd, 'purpose'), PURPOSES),
    ...(fd.has('want') ? {
      want: pickOf(str(fd, 'want'), WANTS), furnishing: pickOf(str(fd, 'furnishing'), FURNISHING), possession_pref: pickOf(str(fd, 'possession_pref'), POSSESSION_PREFS),
      size_min: Number(str(fd, 'size_min')) > 0 ? Math.round(Number(str(fd, 'size_min'))) : null, size_max: Number(str(fd, 'size_max')) > 0 ? Math.round(Number(str(fd, 'size_max'))) : null,
    } : {}),
    preferred_slot: orNull(str(fd, 'preferred_slot').slice(0, 120)),
    source: orNull(str(fd, 'source').slice(0, 60)),
    project_id: proj && proj !== '__other' && /^[0-9a-f-]{36}$/.test(proj) ? proj : null,
    project_other: proj === '__other' ? orNull(str(fd, 'project_other').slice(0, 120)) : null,
    segment: str(fd, 'segment') === 'secondary' ? 'secondary' : 'primary',
  };
  if (b !== undefined) { f.budget_min = b?.min ?? null; f.budget_max = b?.max ?? null; }
  if (isNew) f.score = SCORE_KEYS.includes(str(fd, 'score')) ? str(fd, 'score') : 'warm';
  return f as Record<string, unknown> & { name: string; phone: string; source: string | null };
}

export async function createLeadFull(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, role, user, activity } = await ctx();
  const f = readLeadFields(fd, true);
  if (str(fd, 'pincode') && !f.pincode) return { error: 'Pincode should be 6 digits, e.g. 492001.' };
  if (!f.name) return { error: 'Enter the client name.' };
  if (!validPhone(f.phone)) return { error: PHONE_HELP };
  let assigned: string | null = null;
  if (isManager(role)) {
    assigned = str(fd, 'assigned_to') || null;
    if (!assigned) {
      const { data: o } = await supabase.from('organizations').select('auto_assign').eq('id', org.id).single();
      if ((o as { auto_assign?: boolean } | null)?.auto_assign) {
        const { data: pick } = await supabase.rpc('pick_assignee', { p_org: org.id });
        assigned = (pick as string | null) ?? null;
      }
    }
  } else if (role === 'agent') assigned = user.id;

  let { data, error } = await supabase.from('leads')
    .insert({ org_id: org.id, ...f, assigned_to: assigned, next_follow_up: new Date().toISOString() })
    .select('id').single();
  if (error && /want|furnishing|possession_pref|size_m/.test(error.message)) { // patch-043 not run yet
    for (const k of ['want', 'furnishing', 'possession_pref', 'size_min', 'size_max']) delete f[k];
    ({ data, error } = await supabase.from('leads').insert({ org_id: org.id, ...f, assigned_to: assigned, next_follow_up: new Date().toISOString() }).select('id').single());
  }
  if (error) {
    if (error.code === '23505') {
      const { data: ex } = await supabase.from('leads').select('id').eq('org_id', org.id).eq('phone', f.phone).maybeSingle();
      return { error: ex ? 'This mobile number is already in your CRM.' : 'This mobile number is already in your CRM under another agent. Ask your manager.', link: ex ? `/leads/${ex.id}` : undefined };
    }
    return { error: friendly(error.message) };
  }
  if (!data) return { error: 'Could not save. Please try again.' };
  await activity(data.id, 'created', `Lead added${f.source ? ' from ' + f.source : ''}`);
  const note = str(fd, 'note').slice(0, 300);
  if (note) await activity(data.id, 'note', note);
  if (assigned && assigned !== user.id) {
    const { data: a } = await supabase.from('members').select('full_name, phone').eq('org_id', org.id).eq('user_id', assigned).single();
    if (a) await notifyLeadAssigned({ agentPhone: a.phone, agentName: a.full_name, leadName: f.name, leadPhone: f.phone, source: f.source });
  }
  refresh();
  redirect(`/leads/${data.id}`);
}

export async function updateLead(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, activity } = await ctx();
  const id = str(fd, 'id');
  const f = readLeadFields(fd, false);
  if (str(fd, 'pincode') && !f.pincode) return { error: 'Pincode should be 6 digits, e.g. 492001.' };
  if (!f.name) return { error: 'Enter the client name.' };
  if (!validPhone(f.phone)) return { error: PHONE_HELP };
  let { error, count } = await supabase.from('leads').update(f, { count: 'exact' }).eq('id', id).eq('org_id', org.id);
  if (error && /want|furnishing|possession_pref|size_m/.test(error.message)) { // patch-043 not run yet
    for (const k of ['want', 'furnishing', 'possession_pref', 'size_min', 'size_max']) delete f[k];
    ({ error, count } = await supabase.from('leads').update(f, { count: 'exact' }).eq('id', id).eq('org_id', org.id));
  }
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: 'You can only edit leads assigned to you.' };
  await activity(id, 'note', 'Details updated');
  refresh(id);
  return { ok: 'Saved' };
}

export async function setStage(fd: FormData) {
  const { supabase, org, activity, getLead } = await ctx();
  const id = str(fd, 'id'); const stage = str(fd, 'stage');
  if (STAGE_IDX[stage] == null) return;
  const lead = await getLead(id);
  if (!lead || lead.stage === stage) return;
  const { error } = await supabase.from('leads').update({ stage }).eq('id', id).eq('org_id', org.id);
  if (!error) await activity(id, 'stage', `Stage: ${stageLabel(lead.stage)} → ${stageLabel(stage)}`);
  refresh(id);
}

/** Called from the drag-and-drop board. */
export async function moveStage(id: string, stage: string): Promise<{ error?: string }> {
  const { supabase, org, activity, getLead } = await ctx();
  if (STAGE_IDX[stage] == null) return { error: 'Use the lead page to mark a lead as lost.' };
  const lead = await getLead(id);
  if (!lead) return { error: 'Lead not found' };
  if (lead.stage === stage) return {};
  const { error } = await supabase.from('leads').update({ stage }).eq('id', id).eq('org_id', org.id);
  if (error) return { error: friendly(error.message) };
  await activity(id, 'stage', `Stage: ${stageLabel(lead.stage)} → ${stageLabel(stage)}`);
  refresh(id);
  return {};
}

export async function markLost(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, activity, getLead } = await ctx();
  const id = str(fd, 'id'); const reason = str(fd, 'reason');
  if (!reason) return { error: 'Pick a reason.' };
  const lead = await getLead(id);
  if (!lead) return { error: 'Lead not found' };
  const { error } = await supabase.from('leads').update({ stage: 'lost', lost_reason: reason }).eq('id', id).eq('org_id', org.id);
  if (error) return { error: friendly(error.message) };
  await activity(id, 'stage', `Marked lost: ${reason}${str(fd, 'note') ? '\n' + str(fd, 'note') : ''}`);
  refresh(id);
  return { ok: 'Marked as lost' };
}

export async function setFollowUp(fd: FormData) {
  const { supabase, org } = await ctx();
  const id = str(fd, 'id'); const preset = str(fd, 'preset');
  let at: string | null = null;
  // "By end of day" = 6 PM today (or 2 hours from now if it is already late)
  if (preset === 'eod') { const six = istAt(0, 18); at = new Date(six).getTime() - Date.now() > 30 * 60000 ? six : new Date(Date.now() + 2 * 3600000).toISOString(); }
  else if (preset === 'tomorrow') at = istAt(1, 11);
  else if (preset === '3d') at = istAt(3, 11);
  else if (preset === 'custom') at = fromLocalInput(str(fd, 'at'));
  else if (preset === 'clear') at = null;
  if (preset === 'custom' && !at) return;
  await supabase.from('leads').update({ next_follow_up: at }).eq('id', id).eq('org_id', org.id);
  refresh(id);
}

export async function logCall(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, user, activity, getLead } = await ctx();
  const id = str(fd, 'id');
  const o = OUTCOMES.find((x) => x.k === str(fd, 'outcome'));
  if (!o) return { error: 'Pick what happened on the call.' };
  const lead = await getLead(id);
  if (!lead) return { error: 'Lead not found' };
  const note = str(fd, 'note');
  const patch: Record<string, unknown> = { call_attempts: (lead.call_attempts ?? 0) + 1 };
  const idx = STAGE_IDX[lead.stage] ?? -1;
  const connected = ['interested', 'callback', 'notint'].includes(o.k);
  if (o.k === 'notint' || o.k === 'wrong') {
    patch.stage = 'lost';
    patch.lost_reason = o.k === 'wrong' ? 'Wrong number' : str(fd, 'reason') || 'Just exploring';
  } else {
    if (connected && ['new', 'noresponse'].includes(lead.stage)) patch.stage = 'contacted';
    if (!connected && lead.stage === 'new') patch.stage = 'noresponse'; // we tried, they did not pick up
    if (o.k === 'interested' && idx < 2) patch.stage = 'qualified';
    if (o.k === 'interested' && ['cold', 'junk', 'later'].includes(lead.score)) patch.score = 'warm';
    patch.next_follow_up = fromLocalInput(str(fd, 'next')) ?? (o.hours ? new Date(Date.now() + o.hours * 3600000).toISOString() : null);
  }
  // New needs said on the call (typed or filled by voice)
  const changed: string[] = [];
  const bhk = str(fd, 'upd_bhk');
  if (bhk && BHKS.includes(bhk) && bhk !== lead.bhk) { patch.bhk = bhk; changed.push(bhk); }
  const b = readBudget(str(fd, 'upd_budget'));
  if (b && (b.min !== lead.budget_min || b.max !== lead.budget_max)) { patch.budget_min = b.min; patch.budget_max = b.max; changed.push(`budget ${fmtBudget(b.min, b.max)}`); }
  const loc = str(fd, 'upd_location').slice(0, 200);
  if (loc && loc !== lead.location) { patch.location = loc; changed.push(loc); }
  const visitAt = o.k === 'notint' || o.k === 'wrong' ? null : fromLocalInput(str(fd, 'visit_at'));
  if (visitAt) {
    if ((STAGE_IDX[String(patch.stage ?? lead.stage)] ?? -1) < 3) patch.stage = 'visit';
    const dayBefore = new Date(new Date(visitAt).getTime() - 20 * 3600000);
    if (dayBefore.getTime() > Date.now()) patch.next_follow_up = dayBefore.toISOString();
  }
  let { error } = await supabase.from('leads').update({ ...patch, last_outcome: o.k, last_outcome_at: new Date().toISOString() }).eq('id', id).eq('org_id', org.id);
  if (error && /last_outcome/.test(error.message)) ({ error } = await supabase.from('leads').update(patch).eq('id', id).eq('org_id', org.id)); // patch-042 not run yet
  if (error) return { error: friendly(error.message) };
  await activity(id, 'call', `Call: ${o.l}${note ? '\n' + note : ''}${changed.length ? '\nUpdated: ' + changed.join(', ') : ''}`);
  if (visitAt) {
    await supabase.from('visits').insert({ org_id: org.id, lead_id: id, project_id: lead.project_id || null, at: visitAt, agent_id: lead.assigned_to || user.id, status: 'scheduled' });
    await activity(id, 'visit', `Site visit booked on ${fmtDT(visitAt)}`);
  }
  if (patch.stage && patch.stage !== lead.stage) await activity(id, 'stage', `Stage: ${stageLabel(lead.stage)} → ${stageLabel(String(patch.stage))}`);
  // "This call finishes my step": tick it and hand the client to the next person.
  const fin = str(fd, 'finish_step');
  let handed = '';
  if (fin && ['call', 'presentation', 'followup'].includes(fin) && ['interested', 'callback'].includes(o.k)) {
    const { data: d, error: e2 } = await supabase.rpc('complete_step', {
      p_lead: id, p_step: fin, p_summary: `${o.l}.${note ? ' ' + note : ''}`, p_details: { said: note, outcome: o.k }, p_interest: null, p_project: null,
    });
    if (e2) return { error: `Call saved, but the step was not finished: ${friendly(e2.message)}` };
    handed = (d as { handed_to?: string | null } | null)?.handed_to ?? '';
  }
  refresh(id);
  const tail = handed ? ` ${handed} has the client now.` : fin ? ' Step finished.' : '';
  if (visitAt) return { ok: `Saved. Site visit on ${fmtDT(visitAt)}; a reminder call is set for the day before.${tail}` };
  return { ok: (patch.next_follow_up ? `Saved. Next call ${fmtDT(String(patch.next_follow_up))}.` : 'Saved.') + tail };
}

export async function addNote(_: FormState, fd: FormData): Promise<FormState> {
  const { activity } = await ctx();
  const id = str(fd, 'id'); const body = str(fd, 'body');
  if (!body) return { error: 'Write a note first.' };
  await activity(id, 'note', body.slice(0, 4000));
  refresh(id);
  return { ok: 'Note saved' };
}

export async function setScore(fd: FormData) {
  const { supabase, org } = await ctx();
  const s = str(fd, 'score');
  if (!SCORE_KEYS.includes(s)) return;
  await supabase.from('leads').update({ score: s }).eq('id', str(fd, 'id')).eq('org_id', org.id);
  refresh(str(fd, 'id'));
}

export async function assignLead(fd: FormData) {
  const { supabase, org, role, user, activity, getLead } = await ctx();
  if (role !== 'owner') return; // only the admin hands leads to people
  const id = str(fd, 'id'); const to = str(fd, 'assigned_to') || null;
  const reason = str(fd, 'reason').slice(0, 200);
  const lead = await getLead(id);
  if (!lead || lead.assigned_to === to) return;
  const { data: from } = lead.assigned_to ? await supabase.from('members').select('full_name').eq('org_id', org.id).eq('user_id', lead.assigned_to).maybeSingle() : { data: null };
  const { error } = await supabase.from('leads').update({ assigned_to: to }).eq('id', id).eq('org_id', org.id);
  if (error) return;
  let name = '';
  if (to) {
    const { data: a } = await supabase.from('members').select('full_name, phone').eq('org_id', org.id).eq('user_id', to).single();
    name = a?.full_name ?? '';
    if (a && to !== user.id) await notifyLeadAssigned({ agentPhone: a.phone, agentName: a.full_name, leadName: lead.name, leadPhone: lead.phone, source: lead.source });
  }
  // Who moved it is saved with the note (by_user); from whom and why too.
  await activity(id, 'assign', `${to ? `Assigned to ${name}` : 'Unassigned'}${from?.full_name ? ` (was ${from.full_name})` : ''}${reason ? `\nReason: ${reason}` : ''}`);
  refresh(id);
}

export async function logWhatsApp(leadId: string, templateName: string) {
  const { activity } = await ctx();
  await activity(leadId, 'whatsapp', `WhatsApp opened${templateName ? ` with “${templateName}”` : ''}`);
  refresh(leadId);
}

export async function deleteLead(fd: FormData) {
  const { supabase, org, role } = await ctx();
  if (!isManager(role)) return;
  // A copy is kept (who, when, why) so the admin can see it and bring it back.
  const { error } = await supabase.rpc('delete_lead', { p_id: str(fd, 'id'), p_reason: str(fd, 'reason').slice(0, 200) });
  if (error) await supabase.from('leads').delete().eq('id', str(fd, 'id')).eq('org_id', org.id);
  refresh();
  redirect('/leads');
}

export async function restoreLead(fd: FormData) {
  const { supabase, role } = await ctx();
  if (role !== 'owner') return;
  const { data, error } = await supabase.rpc('restore_lead', { p_id: str(fd, 'id') });
  if (error) redirect(`/leads/deleted?err=${encodeURIComponent(friendly(error.message).slice(0, 160))}`);
  refresh();
  revalidatePath('/leads/deleted');
  redirect(`/leads/deleted?ok=${data}`);
}

// ---------- Site visits ----------

export async function scheduleVisit(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, user, activity, getLead } = await ctx();
  const leadId = str(fd, 'lead_id');
  const at = fromLocalInput(str(fd, 'at'));
  if (!at) return { error: 'Pick the date and time.' };
  const lead = await getLead(leadId);
  if (!lead) return { error: 'Lead not found' };
  const projectId = str(fd, 'project_id') || lead.project_id || null;
  const vrow: Record<string, unknown> = { org_id: org.id, lead_id: leadId, project_id: projectId, at, agent_id: str(fd, 'agent_id') || lead.assigned_to || user.id, status: 'scheduled' };
  const brokerId = /^[0-9a-f-]{36}$/.test(str(fd, 'broker_id')) ? str(fd, 'broker_id') : lead.broker_id ?? null;
  let { error } = await supabase.from('visits').insert(brokerId ? { ...vrow, broker_id: brokerId } : vrow);
  if (error && /broker_id/.test(error.message)) ({ error } = await supabase.from('visits').insert(vrow)); // patch-044 not run yet
  if (error) return { error: friendly(error.message) };
  const patch: Record<string, unknown> = {};
  if ((STAGE_IDX[lead.stage] ?? -1) < 3 || lead.stage === 'lost') patch.stage = 'visit';
  if (projectId && !lead.project_id) patch.project_id = projectId;
  const dayBefore = new Date(new Date(at).getTime() - 20 * 3600000);
  if (dayBefore.getTime() > Date.now()) patch.next_follow_up = dayBefore.toISOString();
  if (Object.keys(patch).length) await supabase.from('leads').update(patch).eq('id', leadId).eq('org_id', org.id);
  const { data: p } = projectId ? await supabase.from('projects').select('name').eq('id', projectId).single() : { data: null };
  await activity(leadId, 'visit', `Site visit booked${p?.name ? ': ' + p.name : ''} on ${fmtDT(at)}`);
  refresh(leadId);
  return { ok: 'Visit booked. A reminder call is set for the day before.' };
}

export async function visitResult(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, activity, getLead } = await ctx();
  const id = str(fd, 'visit_id');
  const status = str(fd, 'status');
  if (!['done', 'noshow', 'cancelled'].includes(status)) return { error: 'Pick what happened.' };
  const { data: v } = await supabase.from('visits').select('*, projects(name)').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!v) return { error: 'Visit not found' };
  const interest = ['hot', 'warm', 'cold'].includes(str(fd, 'interest')) ? str(fd, 'interest') : null;
  const feedback = str(fd, 'feedback').slice(0, 1500);
  const { error } = await supabase.from('visits').update({ status, feedback: feedback || null, interest }).eq('id', id);
  if (error) return { error: friendly(error.message) };
  const lead = await getLead(v.lead_id);
  if (lead) {
    const patch: Record<string, unknown> = { next_follow_up: fromLocalInput(str(fd, 'next')) ?? istAt(1, 11) };
    if (status === 'done' && (STAGE_IDX[lead.stage] ?? -1) < 4) patch.stage = 'visited';
    if (status === 'done' && interest) patch.score = interest;
    await supabase.from('leads').update(patch).eq('id', lead.id).eq('org_id', org.id);
    const pname = (v as { projects?: { name?: string } }).projects?.name ?? 'the site';
    await activity(lead.id, 'visit', `${status === 'done' ? 'Visited' : status === 'noshow' ? 'Did not come to' : 'Cancelled visit to'} ${pname}${feedback ? '\n' + feedback : ''}`);
  }
  refresh(v.lead_id);
  return { ok: 'Saved' };
}

// ---------- Projects ----------

function whole(v: string) {
  const n = Math.round(Number(v.replace(/[, ]/g, '')));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? n : null;
}
function coord(v: string, max: number) {
  const n = Number(v);
  return v && Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

/** Show / hide a project on the client website, or turn its CRM client link on / off.
 *  The page updates on the spot (no waiting for the whole Projects page to reload). */
export async function setProjectFlag(id: string, flag: 'on_website' | 'is_public', on: boolean): Promise<{ error?: string; token?: string }> {
  const { supabase, org, role } = await ctx();
  if (!isManager(role)) return { error: 'Only an admin or a manager can change this.' };
  if (flag !== 'on_website' && flag !== 'is_public') return { error: 'Not allowed.' };
  const { data, error } = await supabase.from('projects').update({ [flag]: on === true }).eq('id', id).eq('org_id', org.id).select('share_token').maybeSingle();
  if (error) return { error: friendly(error.message) };
  if (!data) return { error: 'Project not found.' };
  return { token: data.share_token ?? undefined };
}

/** The spot in a Google Maps link. Short links (maps.app.goo.gl) are followed to the full link first. */
async function pinFromMapLink(link: string): Promise<[number, number] | null> {
  const direct = parseLatLng(link);
  if (direct) return direct;
  let url = link;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      const next = r.headers.get('location');
      if (next) { const p = parseLatLng(next); if (p) return p; url = new URL(next, url).toString(); continue; }
      if (r.ok) { const html = (await r.text()).slice(0, 200000); const m = html.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || html.match(/center=(-?\d+\.\d+)%2C(-?\d+\.\d+)/); if (m) return parseLatLng(`${m[1]},${m[2]}`); }
      return null;
    } catch { return null; }
  }
  return null;
}

export async function saveProject(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, role } = await ctx();
  if (!isManager(role)) return { error: 'Only an admin or a manager can change projects.' };
  const name = str(fd, 'name');
  const from = Number(str(fd, 'price_from'));
  if (!name) return { error: 'Enter the project name.' };
  if (str(fd, 'inventory_url') && !downloadUrl(str(fd, 'inventory_url'))) return { error: 'The inventory link must be a sheet link starting with https:// (best: a Google Sheets link).' };
  const row = {
    org_id: org.id, name, developer: orNull(str(fd, 'developer')), location: orNull(str(fd, 'location')), rera_no: orNull(str(fd, 'rera_no')),
    type: orNull(str(fd, 'type')), configs: orNull(str(fd, 'configs')), price_from: from || null, price_to: Number(str(fd, 'price_to')) || null,
    status: orNull(str(fd, 'status')), possession: orNull(str(fd, 'possession')), highlights: orNull(str(fd, 'highlights')), link: orNull(str(fd, 'link')),
    lat: coord(str(fd, 'lat'), 90), lng: coord(str(fd, 'lng'), 180),
    size_from: whole(str(fd, 'size_from')), size_to: whole(str(fd, 'size_to')), units: whole(str(fd, 'units')),
    towers: orNull(str(fd, 'towers').slice(0, 120)), amenities: orNull(str(fd, 'amenities').slice(0, 600)), banks: orNull(str(fd, 'banks').slice(0, 200)),
    map_url: /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps)/.test(str(fd, 'map_url')) ? str(fd, 'map_url').slice(0, 300) : null,
    payment_plan: orNull(str(fd, 'payment_plan').slice(0, 2000)), terms: orNull(str(fd, 'terms').slice(0, 4000)),
    ...(fd.has('inventory_url') ? { inventory_url: orNull(str(fd, 'inventory_url').slice(0, 500)) } : {}),
    ...(fd.has('deal') ? { deal: ['sale', 'lease', 'both'].includes(str(fd, 'deal')) ? str(fd, 'deal') : 'sale' } : {}),
  };
  // No pin picked: read it from the Google Maps link (short links are opened to find the spot).
  if ((row.lat == null || row.lng == null) && row.map_url) {
    const pin = await pinFromMapLink(row.map_url);
    if (pin) { row.lat = pin[0]; row.lng = pin[1]; }
  }
  const id = str(fd, 'id');
  const newId = /^[0-9a-f-]{36}$/i.test(str(fd, 'new_id')) ? str(fd, 'new_id') : undefined;
  const write = (r: Record<string, unknown>) => (id
    ? supabase.from('projects').update(r).eq('id', id).eq('org_id', org.id)
    : supabase.from('projects').insert({ ...r, ...(newId ? { id: newId } : {}) }));
  let { error } = await write(row);
  let noLinkColumn = false;
  if (error && /inventory_url/.test(error.message) && 'inventory_url' in row) {
    // patch-038 not run yet: save everything else
    const rest: Record<string, unknown> = { ...row }; delete rest.inventory_url;
    ({ error } = await write(rest)); noLinkColumn = true;
  }
  if (error) return { error: friendly(error.message) };
  if (noLinkColumn && row.inventory_url) return { ok: (id ? 'Project saved.' : 'Project added.') + ' The inventory link was not saved: run supabase/patch-038-inventory-sheet-sync.sql in Supabase first.' };
  // A sheet link was given: read the inventory from it now.
  let inv = '';
  const savedId = id || newId;
  if (savedId && 'inventory_url' in row && row.inventory_url) {
    const r = await syncProjectInventory(org.id, savedId);
    inv = r.ok ? ` Inventory synced: ${r.flats ?? 0} flats.` : ` Inventory not synced: ${r.error}`;
  }
  if (savedId) await translateProject(savedId); // Hindi copy for the website
  revalidatePath('/projects', 'layout');
  return { ok: (id ? 'Project saved.' : 'Project added.') + inv };
}

export async function deleteProject(fd: FormData) {
  const { supabase, org, role } = await ctx();
  if (!isManager(role)) return;
  await supabase.from('projects').delete().eq('id', str(fd, 'id')).eq('org_id', org.id);
  revalidatePath('/projects');
}

// ---------- Message templates ----------

export async function saveTemplate(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, role } = await ctx();
  if (!isManager(role)) return { error: 'Only an admin or a manager can change templates.' };
  const body = str(fd, 'body'); const name = str(fd, 'name');
  if (!name || !body) return { error: 'Add a name and the message.' };
  const row = { org_id: org.id, name, use_for: str(fd, 'use_for') || 'Other', body: body.slice(0, 2000) };
  const id = str(fd, 'id');
  const { error } = id ? await supabase.from('templates').update(row).eq('id', id).eq('org_id', org.id) : await supabase.from('templates').insert(row);
  if (error) return { error: friendly(error.message) };
  revalidatePath('/messages');
  return { ok: 'Template saved' };
}

export async function deleteTemplate(fd: FormData) {
  const { supabase, org, role } = await ctx();
  if (!isManager(role)) return;
  await supabase.from('templates').delete().eq('id', str(fd, 'id')).eq('org_id', org.id);
  revalidatePath('/messages');
}

// ---------- Second chance for lost leads ----------

export async function recycleCall(fd: FormData) {
  const { supabase, org, activity, getLead } = await ctx();
  const id = str(fd, 'id');
  const lead = await getLead(id);
  if (!lead || lead.stage !== 'lost') return;
  const { error } = await supabase.from('leads').update({ stage: 'contacted', next_follow_up: new Date().toISOString() }).eq('id', id).eq('org_id', org.id);
  if (error) return;
  await activity(id, 'stage', `Second chance: reopened after being lost (${lead.lost_reason ?? 'no reason'})`);
  refresh(id);
  redirect(`/leads/${id}`);
}

export async function recycleSnooze(fd: FormData) {
  const { supabase } = await ctx();
  await supabase.rpc('snooze_recycle', { p_lead: str(fd, 'id') });
  refresh();
}

// ---------- Excel / CSV import ----------

export type ImportRow = { name: string; phone: string; email?: string; location?: string; budget_min?: number | null; budget_max?: number | null; bhk?: string; source?: string; note?: string };

export async function importLeads(rows: ImportRow[], source: string, assign: string, project: string): Promise<{ added?: number; updated?: number; skipped?: number; error?: string }> {
  const { supabase, org } = await requireOrg(['owner', 'manager']);
  if (!Array.isArray(rows) || rows.length === 0) return { error: 'No rows to import.' };
  if (rows.length > 1000) return { error: 'Send at most 1000 rows at a time.' };
  if (rows.some((r) => !r || typeof r !== 'object')) return { error: 'Some rows could not be read.' };
  const clean = rows.map((r) => ({
    name: String(r.name ?? '').slice(0, 120), phone: String(r.phone ?? ''), email: String(r.email ?? '').slice(0, 200),
    location: String(r.location ?? '').slice(0, 200), budget_min: r.budget_min ?? '', budget_max: r.budget_max ?? '',
    bhk: String(r.bhk ?? '').slice(0, 20), source: String(r.source ?? '').slice(0, 60), note: String(r.note ?? '').slice(0, 1000),
  }));
  const { data, error } = await supabase.rpc('import_leads', { p_org: org.id, p_rows: clean, p_source: source, p_assign: assign, p_project: project || null });
  if (error) return { error: friendly(error.message) };
  refresh();
  return data as { added: number; updated: number; skipped: number };
}

// ---------- Project photos ----------

const MAX_PHOTOS = 20;
function photoOk(url: string, orgId: string) {
  if (/^\/demo\/projects\/[\w-]+\.(jpg|png|webp)$/.test(url)) return true;
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/project-photos/${orgId}/`;
  return url.startsWith(base) && !url.includes('..');
}
async function projectPhotos(id: string) {
  const c = await ctx();
  if (!isManager(c.role)) return null;
  const { data } = await c.supabase.from('projects').select('photos').eq('id', id).eq('org_id', c.org.id).maybeSingle();
  return data ? { ...c, photos: (data.photos ?? []) as string[] } : null;
}

export async function addProjectPhotos(id: string, urls: string[]): Promise<{ error?: string }> {
  const p = await projectPhotos(id);
  if (!p) return { error: 'Only an admin or a manager can add photos.' };
  const good = (Array.isArray(urls) ? urls : []).filter((u) => typeof u === 'string' && photoOk(u, p.org.id));
  const photos = [...p.photos, ...good].slice(0, MAX_PHOTOS);
  const { error } = await p.supabase.from('projects').update({ photos }).eq('id', id).eq('org_id', p.org.id);
  revalidatePath('/projects');
  return error ? { error: friendly(error.message) } : {};
}

export async function removeProjectPhoto(id: string, url: string): Promise<{ error?: string }> {
  const p = await projectPhotos(id);
  if (!p) return { error: 'Only an admin or a manager can remove photos.' };
  const { error } = await p.supabase.from('projects').update({ photos: p.photos.filter((u) => u !== url) }).eq('id', id).eq('org_id', p.org.id);
  const marker = '/storage/v1/object/public/project-photos/';
  if (!error && url.includes(marker)) await p.supabase.storage.from('project-photos').remove([url.split(marker)[1]]);
  return error ? { error: friendly(error.message) } : {};
}

export async function setCoverPhoto(id: string, url: string): Promise<{ error?: string }> {
  const p = await projectPhotos(id);
  if (!p || !p.photos.includes(url)) return { error: 'Photo not found.' };
  const { error } = await p.supabase.from('projects').update({ photos: [url, ...p.photos.filter((u) => u !== url)] }).eq('id', id).eq('org_id', p.org.id);
  return error ? { error: friendly(error.message) } : {};
}

export type FloorPlan = { url: string; label: string };
const MAX_PLANS = 20;

/** Floor plans: pictures with a short label like "2 BHK · 1,150 sq ft". */
export async function addFloorPlans(id: string, plans: FloorPlan[]): Promise<{ error?: string }> {
  const c = await ctx();
  if (!isManager(c.role)) return { error: 'Only an admin or a manager can add floor plans.' };
  const { data } = await c.supabase.from('projects').select('floor_plans').eq('id', id).eq('org_id', c.org.id).maybeSingle();
  if (!data) return { error: 'Project not found.' };
  const good = (Array.isArray(plans) ? plans : []).filter((p) => p && typeof p.url === 'string' && photoOk(p.url, c.org.id))
    .map((p) => ({ url: p.url, label: String(p.label ?? '').trim().slice(0, 60) }));
  const floor_plans = [...((data.floor_plans ?? []) as FloorPlan[]), ...good].slice(0, MAX_PLANS);
  const { error } = await c.supabase.from('projects').update({ floor_plans }).eq('id', id).eq('org_id', c.org.id);
  revalidatePath('/projects');
  return error ? { error: friendly(error.message) } : {};
}

export async function removeFloorPlan(id: string, url: string): Promise<{ error?: string }> {
  const c = await ctx();
  if (!isManager(c.role)) return { error: 'Only an admin or a manager can remove floor plans.' };
  const { data } = await c.supabase.from('projects').select('floor_plans').eq('id', id).eq('org_id', c.org.id).maybeSingle();
  if (!data) return { error: 'Project not found.' };
  const floor_plans = ((data.floor_plans ?? []) as FloorPlan[]).filter((p) => p.url !== url);
  const { error } = await c.supabase.from('projects').update({ floor_plans }).eq('id', id).eq('org_id', c.org.id);
  const marker = '/storage/v1/object/public/project-photos/';
  if (!error && url.includes(marker)) await c.supabase.storage.from('project-photos').remove([url.split(marker)[1]]);
  revalidatePath('/projects');
  return error ? { error: friendly(error.message) } : {};
}

/** Brochure PDF uploaded to our storage becomes the project's brochure link (hidden until the client unlocks). */
export async function setBrochure(id: string, url: string): Promise<{ error?: string }> {
  const c = await ctx();
  if (!isManager(c.role)) return { error: 'Only an admin or a manager can add a brochure.' };
  if (!photoOk(url, c.org.id) || !/\.pdf$/i.test(url)) return { error: 'Upload a PDF file.' };
  const { error } = await c.supabase.from('projects').update({ link: url }).eq('id', id).eq('org_id', c.org.id);
  revalidatePath('/projects');
  return error ? { error: friendly(error.message) } : {};
}

// ---------- Project videos (up to 5, 10 MB in total) ----------

export type ProjectVideo = { url: string; size: number; name: string };
const MAX_VIDEOS = 5;
const MAX_VIDEO_BYTES = 10 * 1024 * 1024;

/** The real size of an uploaded file (asks the file store), or the size the browser told us. */
async function fileSize(url: string, told: number) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const n = Number(r.headers.get('content-length'));
    if (r.ok && Number.isFinite(n) && n > 0) return n;
  } catch { /* use the size we were told */ }
  return Number.isFinite(told) && told > 0 ? told : MAX_VIDEO_BYTES;
}

export async function addProjectVideo(id: string, video: ProjectVideo): Promise<{ error?: string; videos?: ProjectVideo[] }> {
  const c = await ctx();
  if (!isManager(c.role)) return { error: 'Only an admin or a manager can add videos.' };
  if (!video || typeof video.url !== 'string' || !photoOk(video.url, c.org.id) || !/\.(mp4|webm|mov)$/i.test(video.url)) return { error: 'Upload an MP4, WebM or MOV video.' };
  const { data, error: readErr } = await c.supabase.from('projects').select('videos').eq('id', id).eq('org_id', c.org.id).maybeSingle();
  if (readErr) return { error: /videos/.test(readErr.message) ? 'Run supabase/patch-036-project-videos.sql in Supabase first.' : friendly(readErr.message) };
  if (!data) return { error: 'Project not found.' };
  const list = (Array.isArray(data.videos) ? data.videos : []) as ProjectVideo[];
  const size = await fileSize(video.url, Number(video.size));
  const used = list.reduce((a, v) => a + (Number(v.size) || 0), 0);
  const marker = '/storage/v1/object/public/project-photos/';
  const drop = async () => { await c.supabase.storage.from('project-photos').remove([video.url.split(marker)[1]]); };
  if (list.length >= MAX_VIDEOS) { await drop(); return { error: 'A project can have up to 5 videos. Remove one first.' }; }
  if (used + size > MAX_VIDEO_BYTES) { await drop(); return { error: `Videos can be 10 MB in total per project. ${mb(MAX_VIDEO_BYTES - used)} is left.` }; }
  const videos = [...list, { url: video.url, size, name: String(video.name ?? '').replace(/\.[a-z0-9]+$/i, '').trim().slice(0, 80) || 'Video' }];
  const { error } = await c.supabase.from('projects').update({ videos }).eq('id', id).eq('org_id', c.org.id);
  revalidatePath('/projects');
  return error ? { error: friendly(error.message) } : { videos };
}

export async function removeProjectVideo(id: string, url: string): Promise<{ error?: string }> {
  const c = await ctx();
  if (!isManager(c.role)) return { error: 'Only an admin or a manager can remove videos.' };
  const { data } = await c.supabase.from('projects').select('videos').eq('id', id).eq('org_id', c.org.id).maybeSingle();
  if (!data) return { error: 'Project not found.' };
  const videos = ((Array.isArray(data.videos) ? data.videos : []) as ProjectVideo[]).filter((v) => v.url !== url);
  const { error } = await c.supabase.from('projects').update({ videos }).eq('id', id).eq('org_id', c.org.id);
  const marker = '/storage/v1/object/public/project-photos/';
  if (!error && url.includes(marker)) await c.supabase.storage.from('project-photos').remove([url.split(marker)[1]]);
  revalidatePath('/projects');
  return error ? { error: friendly(error.message) } : {};
}

const mb = (b: number) => `${Math.max(0, b / 1024 / 1024).toFixed(1)} MB`;

// ---------- Client journey ----------

const STEP_KEYS = ['call', 'presentation', 'visit', 'followup', 'payment'];

/** The person handling the client finishes their step; the client moves on to the next person by itself. */
export async function completeStep(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await ctx();
  const id = str(fd, 'id'); const step = str(fd, 'step');
  if (!STEP_KEYS.includes(step)) return { error: 'Unknown step.' };
  const said = str(fd, 'said').slice(0, 1500);
  const extra = str(fd, 'extra').slice(0, 300);
  const projectId = /^[0-9a-f-]{36}$/.test(str(fd, 'project_id')) ? str(fd, 'project_id') : null;
  // "Other (not in the list)": the typed project name goes into the summary
  let projectName = str(fd, 'project_id') === '__other' ? str(fd, 'project_other').slice(0, 120) : '';
  if (projectId) {
    const { data: p } = await supabase.from('projects').select('name').eq('id', projectId).eq('org_id', org.id).maybeSingle();
    projectName = p?.name ?? '';
  }
  if (step === 'presentation' && !projectId && !projectName) return { error: 'Pick the project you presented.' };
  const summary = step === 'presentation'
    ? `Presented ${projectName}: ${said}${extra ? ` · Client said: ${extra}` : ''}`
    : step === 'visit' ? `${projectName ? `Visited ${projectName}: ` : ''}${said}`
    : step === 'followup' ? `${said}${extra ? ` · Decision: ${extra}` : ''}`
    : said;
  const interest = null; // interest is changed in one place only: the Status box
  const { data, error } = await supabase.rpc('complete_step', {
    p_lead: id, p_step: step, p_summary: summary, p_interest: interest, p_project: projectId,
    p_details: { said, extra: extra || null, project: projectName || null },
  });
  if (error) return { error: friendly(error.message) };
  refresh(id);
  const to = (data as { handed_to?: string | null } | null)?.handed_to;
  return { ok: to ? `Saved. ${to} has the client now for the next step.` : 'Saved.' };
}

export async function undoStep(fd: FormData) {
  const { supabase, role } = await ctx();
  if (role !== 'owner') return;
  const id = str(fd, 'id');
  await supabase.rpc('undo_step', { p_lead: id, p_step: str(fd, 'step') });
  refresh(id);
}

// ---------- Flats (unit inventory) ----------

export async function setUnitStatus(fd: FormData) {
  const { supabase, org, role } = await ctx();
  if (!isManager(role)) return;
  const status = str(fd, 'status');
  if (!['open', 'hold', 'booked', 'mortgage'].includes(status)) return;
  await supabase.from('project_units').update({ status, note: str(fd, 'note').slice(0, 200) || null }).eq('id', str(fd, 'id')).eq('org_id', org.id);
  revalidatePath('/projects', 'layout');
}

export type UnitIn = { tower: string; floor: number | null; unit_no: string; bhk: string | null; sba: number | null; carpet: number | null; rate: number | null; status: string };

/** Flats from an Excel sheet. "replace" removes the old list first; otherwise flats are added or updated by flat number. */
export async function importUnits(projectId: string, units: UnitIn[], replace: boolean, rateCard: { floors: string; rate: number }[]): Promise<{ ok?: string; error?: string }> {
  const { supabase, org, role } = await ctx();
  if (!isManager(role)) return { error: 'Only an admin or a manager can change flats.' };
  if (!/^[0-9a-f-]{36}$/.test(String(projectId))) return { error: 'Project not found.' };
  const { data: p } = await supabase.from('projects').select('id').eq('id', projectId).eq('org_id', org.id).maybeSingle();
  if (!p) return { error: 'Project not found.' };
  if (!Array.isArray(units) || !units.length) return { error: 'No flats to save.' };
  if (units.length > 5000) return { error: 'At most 5,000 flats at a time.' };
  const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < max ? v : null);
  const clean = units.filter((u) => u && typeof u.unit_no === 'string' && u.unit_no.trim()).map((u) => ({
    org_id: org.id, project_id: projectId,
    tower: String(u.tower ?? '').slice(0, 20) || 'A', floor: typeof u.floor === 'number' && Number.isFinite(u.floor) ? Math.round(u.floor) : null,
    unit_no: String(u.unit_no).trim().slice(0, 30), bhk: u.bhk ? String(u.bhk).slice(0, 30) : null,
    sba: n(u.sba, 100000), carpet: n(u.carpet, 100000), rate: n(u.rate, 1000000),
    status: ['open', 'hold', 'booked', 'mortgage'].includes(u.status) ? u.status : 'open',
  }));
  if (replace) {
    const { error } = await supabase.from('project_units').delete().eq('project_id', projectId).eq('org_id', org.id);
    if (error) return { error: friendly(error.message) };
  }
  for (let i = 0; i < clean.length; i += 500) {
    const { error } = await supabase.from('project_units').upsert(clean.slice(i, i + 500), { onConflict: 'project_id,unit_no' });
    if (error) return { error: `${friendly(error.message)} (${i} saved before this stopped)` };
  }
  const card = (Array.isArray(rateCard) ? rateCard : []).filter((b) => b && typeof b.rate === 'number' && b.rate > 0).slice(0, 30)
    .map((b) => ({ floors: String(b.floors).slice(0, 12), rate: Math.round(b.rate) }));
  if (card.length) await supabase.from('projects').update({ rate_card: card }).eq('id', projectId).eq('org_id', org.id);
  revalidatePath('/projects', 'layout');
  return { ok: `${clean.length} flat${clean.length === 1 ? '' : 's'} saved.` };
}

// ---------- Inventory from a sheet link ----------

/** "Sync now": anyone in the team can refresh the flats from the project's sheet. */
export async function syncInventoryNow(projectId: string): Promise<{ ok?: string; error?: string }> {
  const { org } = await ctx();
  if (!/^[0-9a-f-]{36}$/.test(String(projectId))) return { error: 'Project not found.' };
  const r = await syncProjectInventory(org.id, projectId, 0);
  revalidatePath('/projects', 'layout');
  if (r.skipped) return { ok: 'A sync is already running. Refresh in a few seconds.' };
  return r.ok ? { ok: `Synced. ${r.flats ?? 0} flats${r.changed ? ', changes saved' : ', no changes'}.` } : { error: r.error };
}

/** Runs by itself when someone opens the CRM: refreshes every project that has a sheet link (at most every 3 minutes). */
export async function autoSyncInventory(): Promise<{ changed: boolean }> {
  try {
    const { supabase, org } = await ctx();
    const { data, error } = await supabase.from('projects').select('id').eq('org_id', org.id).not('inventory_url', 'is', null);
    if (error || !data?.length) return { changed: false };
    let changed = false;
    const ids = data.map((p) => p.id as string);
    for (let i = 0; i < ids.length; i += 3) {
      const res = await Promise.all(ids.slice(i, i + 3).map((id) => syncProjectInventory(org.id, id, 3 * 60_000).catch(() => ({ changed: false }))));
      if (res.some((r) => r.changed)) changed = true;
    }
    if (changed) revalidatePath('/projects', 'layout');
    return { changed };
  } catch { return { changed: false }; }
}

/** Save (or remove) the project's sheet link, then sync. */
export async function setInventoryLink(projectId: string, link: string): Promise<{ ok?: string; error?: string }> {
  const { supabase, org, role } = await ctx();
  if (!isManager(role)) return { error: 'Only an admin or a manager can change the sheet link.' };
  const url = String(link ?? '').trim().slice(0, 500);
  if (url && !downloadUrl(url)) return { error: 'Paste a sheet link that starts with https:// (best: a Google Sheets link).' };
  const { error } = await supabase.from('projects').update({ inventory_url: url || null, inventory_sync_error: null }).eq('id', projectId).eq('org_id', org.id);
  if (error) return { error: /inventory_url/.test(error.message) ? 'Run supabase/patch-038-inventory-sheet-sync.sql in Supabase first.' : friendly(error.message) };
  if (!url) { revalidatePath('/projects', 'layout'); return { ok: 'Sheet link removed. The flats stay as they are.' }; }
  return syncInventoryNow(projectId);
}

// ---------- Site-visit check-in (GPS) ----------

/** Turns GPS into a readable address (free OpenStreetMap service). Empty if it does not answer quickly. */
async function addressFor(lat: number, lng: number) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`, {
      headers: { 'User-Agent': 'TrustArcEstatesCRM/1.0 (trustarcestates@gmail.com)', 'Accept-Language': 'en-IN,en' }, signal: ctl.signal, cache: 'no-store',
    });
    clearTimeout(t);
    if (!res.ok) return '';
    const j = (await res.json()) as { display_name?: string };
    return (j.display_name ?? '').split(',').slice(0, 5).join(',').trim().slice(0, 300);
  } catch { return ''; }
}

export async function visitCheckin(visitId: string, lat: number, lng: number, accuracy: number): Promise<{ ok?: string; error?: string }> {
  const { supabase } = await ctx();
  if (!/^[0-9a-f-]{36}$/.test(String(visitId))) return { error: 'Visit not found.' };
  if (![lat, lng, accuracy].every((n) => typeof n === 'number' && Number.isFinite(n))) return { error: 'Location not found. Turn on location and try again.' };
  const address = await addressFor(lat, lng);
  const { data, error } = await supabase.rpc('visit_checkin', { p_visit: visitId, p_lat: lat, p_lng: lng, p_accuracy: Math.round(accuracy), p_address: address });
  if (error) return { error: friendly(error.message) };
  revalidatePath('/', 'layout');
  const d = data as number | null;
  return { ok: `Checked in${d != null ? ` · ${d < 1000 ? d + ' m' : (d / 1000).toFixed(1) + ' km'} from the project` : ''}${address ? ` · ${address}` : ''}` };
}

// ---------- Duplicate clients ----------

export async function mergeLeads(fd: FormData) {
  const { supabase, role } = await ctx();
  if (role !== 'owner') return;
  await supabase.rpc('merge_leads', { p_keep: str(fd, 'keep'), p_drop: str(fd, 'drop') });
  revalidatePath('/leads', 'layout');
}

export async function ignoreDuplicate(fd: FormData) {
  const { supabase, role } = await ctx();
  if (role !== 'owner') return;
  await supabase.rpc('ignore_duplicate', { p_a: str(fd, 'a'), p_b: str(fd, 'b') });
  revalidatePath('/leads/duplicates');
}

// ---------- Client shortlists ----------

export async function createShortlist(leadId: string, projectIds: string[], note: string): Promise<{ token?: string; error?: string }> {
  const { supabase, org, user, activity, getLead } = await ctx();
  const lead = await getLead(leadId);
  if (!lead) return { error: 'Lead not found' };
  const ids = [...new Set(Array.isArray(projectIds) ? projectIds.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x)) : [])].slice(0, 8);
  if (!ids.length) return { error: 'Pick at least one project.' };
  const { data: ok } = await supabase.from('projects').select('id, name').eq('org_id', org.id).in('id', ids);
  if (!ok || ok.length !== ids.length) return { error: 'Some projects were not found. Refresh and try again.' };
  const { data, error } = await supabase.from('shortlists').insert({ org_id: org.id, lead_id: leadId, project_ids: ids, note: String(note ?? '').trim().slice(0, 400) || null, created_by: user.id }).select('token').single();
  if (error) return { error: friendly(error.message) };
  await activity(leadId, 'whatsapp', `Shortlist link made: ${ok.map((p) => p.name).join(', ')}`);
  refresh(leadId);
  return { token: data.token };
}

// ---------- "A lead wanted this" matches ----------

export async function dismissMatches(fd: FormData) {
  const { supabase } = await ctx();
  const projectId = str(fd, 'project_id'); const leadId = str(fd, 'lead_id');
  let q = supabase.from('project_matches').update({ dismissed_at: new Date().toISOString() }).is('dismissed_at', null);
  if (projectId) q = q.eq('project_id', projectId);
  if (leadId) q = q.eq('lead_id', leadId);
  if (!projectId && !leadId) return;
  await q;
  refresh(leadId || undefined);
  revalidatePath('/projects');
  if (projectId) redirect('/leads');
}

export async function rematchProject(fd: FormData) {
  const { supabase, role } = await ctx();
  if (!isManager(role)) return;
  const id = str(fd, 'id');
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  const { data, error } = await supabase.rpc('rematch_project', { p_project: id });
  revalidatePath('/projects');
  if (error) redirect(`/leads?match=${id}&found=err`);
  redirect(`/leads?match=${id}&found=${Number(data ?? 0)}`);
}

// ---------- Testimonials (patch-032) ----------
/** Make the "write a testimonial" link for a client (after the deal). */
export async function askTestimonial(leadId: string): Promise<{ error?: string; url?: string }> {
  const { supabase, org } = await ctx();
  const { data, error } = await supabase.rpc('ask_testimonial', { p_lead: leadId });
  if (error) return { error: /function|schema cache/i.test(error.message) ? 'Run patch-032 in Supabase first.' : friendly(error.message) };
  const { data: o } = await supabase.from('organizations').select('website_url').eq('id', org.id).maybeSingle();
  const web = (o as { website_url?: string | null } | null)?.website_url;
  if (!web) return { error: 'Add your website address on the Lead sources page first.' };
  return { url: `${web}/index.html?review=${data}` };
}

export async function setTestimonialStatus(fd: FormData) {
  const { supabase, org, role } = await ctx();
  if (!isManager(role)) return;
  const status = str(fd, 'status');
  if (!['approved', 'hidden', 'pending'].includes(status)) return;
  await supabase.from('testimonials').update({ status }).eq('id', str(fd, 'id')).eq('org_id', org.id);
  revalidatePath('/website-clients');
}


/** Projects page open → quietly makes Hindi copies of projects that don't have one yet. */
export async function autoTranslateProjects(): Promise<{ done: number; left: number }> {
  const { org, role } = await ctx();
  if (!isManager(role)) return { done: 0, left: 0 };
  return translateMissing(org.id, 3);
}
