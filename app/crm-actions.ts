'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOrg } from '@/lib/context';
import { PHONE_HELP, isManager, normPhone, validPhone } from '@/lib/roles';
import { OUTCOMES, STAGE_IDX, fmtDT, fromLocalInput, istAt, parseBudget, stageLabel } from '@/lib/crm';
import { notifyLeadAssigned } from '@/lib/whatsapp';
import type { FormState } from '@/app/actions';

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

function readLeadFields(fd: FormData) {
  const b = parseBudget(str(fd, 'budget'));
  return {
    name: str(fd, 'name'),
    phone: normPhone(str(fd, 'phone')),
    email: orNull(str(fd, 'email')),
    dob: orNull(str(fd, 'dob')),
    budget_min: b?.min ?? null,
    budget_max: b?.max ?? null,
    bhk: orNull(str(fd, 'bhk')),
    property_type: orNull(str(fd, 'property_type')),
    location: orNull(str(fd, 'location')),
    purpose: orNull(str(fd, 'purpose')),
    preferred_slot: orNull(str(fd, 'preferred_slot')),
    source: orNull(str(fd, 'source')),
    project_id: orNull(str(fd, 'project_id')),
    score: ['hot', 'warm', 'cold'].includes(str(fd, 'score')) ? str(fd, 'score') : 'warm',
  };
}

export async function createLeadFull(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, role, user, activity } = await ctx();
  const f = readLeadFields(fd);
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

  const { data, error } = await supabase.from('leads')
    .insert({ org_id: org.id, ...f, assigned_to: assigned, next_follow_up: new Date().toISOString() })
    .select('id').single();
  if (error) {
    if (error.code === '23505') {
      const { data: ex } = await supabase.from('leads').select('id').eq('org_id', org.id).eq('phone', f.phone).maybeSingle();
      return { error: ex ? 'This mobile number is already in your CRM.' : 'This mobile number is already in your CRM under another agent. Ask your manager.', link: ex ? `/leads/${ex.id}` : undefined };
    }
    return { error: friendly(error.message) };
  }
  await activity(data.id, 'created', `Lead added${f.source ? ' from ' + f.source : ''}`);
  const note = str(fd, 'note');
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
  const f = readLeadFields(fd);
  if (!f.name) return { error: 'Enter the client name.' };
  if (!validPhone(f.phone)) return { error: PHONE_HELP };
  const { error, count } = await supabase.from('leads').update(f, { count: 'exact' }).eq('id', id).eq('org_id', org.id);
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
  if (preset === '2h') at = new Date(Date.now() + 2 * 3600000).toISOString();
  else if (preset === 'tomorrow') at = istAt(1, 11);
  else if (preset === '3d') at = istAt(3, 11);
  else if (preset === 'week') at = istAt(7, 11);
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
    if (connected && lead.stage === 'new') patch.stage = 'contacted';
    if (o.k === 'interested' && idx < 2) patch.stage = 'qualified';
    if (o.k === 'interested' && lead.score === 'cold') patch.score = 'warm';
    patch.next_follow_up = fromLocalInput(str(fd, 'next')) ?? (o.hours ? new Date(Date.now() + o.hours * 3600000).toISOString() : null);
  }
  // New needs said on the call (typed or filled by voice)
  const changed: string[] = [];
  const bhk = str(fd, 'upd_bhk');
  if (bhk && bhk !== lead.bhk) { patch.bhk = bhk; changed.push(bhk); }
  const b = parseBudget(str(fd, 'upd_budget'));
  if (b && (b.min !== lead.budget_min || b.max !== lead.budget_max)) { patch.budget_min = b.min; patch.budget_max = b.max; changed.push(`budget ${str(fd, 'upd_budget')}`); }
  const loc = str(fd, 'upd_location').slice(0, 200);
  if (loc && loc !== lead.location) { patch.location = loc; changed.push(loc); }
  const visitAt = o.k === 'notint' || o.k === 'wrong' ? null : fromLocalInput(str(fd, 'visit_at'));
  if (visitAt) {
    if ((STAGE_IDX[String(patch.stage ?? lead.stage)] ?? -1) < 3) patch.stage = 'visit';
    const dayBefore = new Date(new Date(visitAt).getTime() - 20 * 3600000);
    if (dayBefore.getTime() > Date.now()) patch.next_follow_up = dayBefore.toISOString();
  }
  const { error } = await supabase.from('leads').update(patch).eq('id', id).eq('org_id', org.id);
  if (error) return { error: friendly(error.message) };
  await activity(id, 'call', `Call: ${o.l}${note ? '\n' + note : ''}${changed.length ? '\nUpdated: ' + changed.join(', ') : ''}`);
  if (visitAt) {
    await supabase.from('visits').insert({ org_id: org.id, lead_id: id, project_id: lead.project_id || null, at: visitAt, agent_id: lead.assigned_to || user.id, status: 'scheduled' });
    await activity(id, 'visit', `Site visit booked on ${fmtDT(visitAt)}`);
  }
  if (patch.stage && patch.stage !== lead.stage) await activity(id, 'stage', `Stage: ${stageLabel(lead.stage)} → ${stageLabel(String(patch.stage))}`);
  refresh(id);
  if (visitAt) return { ok: `Saved. Site visit on ${fmtDT(visitAt)}; a reminder call is set for the day before.` };
  return { ok: patch.next_follow_up ? `Saved. Next call ${fmtDT(String(patch.next_follow_up))}.` : 'Saved.' };
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
  if (!['hot', 'warm', 'cold'].includes(s)) return;
  await supabase.from('leads').update({ score: s }).eq('id', str(fd, 'id')).eq('org_id', org.id);
  refresh(str(fd, 'id'));
}

export async function assignLead(fd: FormData) {
  const { supabase, org, role, user, activity, getLead } = await ctx();
  if (!isManager(role)) return;
  const id = str(fd, 'id'); const to = str(fd, 'assigned_to') || null;
  const lead = await getLead(id);
  if (!lead || lead.assigned_to === to) return;
  const { error } = await supabase.from('leads').update({ assigned_to: to }).eq('id', id).eq('org_id', org.id);
  if (error) return;
  let name = '';
  if (to) {
    const { data: a } = await supabase.from('members').select('full_name, phone').eq('org_id', org.id).eq('user_id', to).single();
    name = a?.full_name ?? '';
    if (a && to !== user.id) await notifyLeadAssigned({ agentPhone: a.phone, agentName: a.full_name, leadName: lead.name, leadPhone: lead.phone, source: lead.source });
  }
  await activity(id, 'assign', to ? `Assigned to ${name}` : 'Unassigned');
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
  await supabase.from('leads').delete().eq('id', str(fd, 'id')).eq('org_id', org.id);
  refresh();
  redirect('/leads');
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
  const { error } = await supabase.from('visits').insert({
    org_id: org.id, lead_id: leadId, project_id: projectId, at, agent_id: str(fd, 'agent_id') || lead.assigned_to || user.id, status: 'scheduled',
  });
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
  const feedback = str(fd, 'feedback');
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

export async function toggleProjectPublic(fd: FormData) {
  const { supabase, org, role } = await ctx();
  if (!isManager(role)) return;
  await supabase.from('projects').update({ is_public: str(fd, 'on') === 'true' }).eq('id', str(fd, 'id')).eq('org_id', org.id);
  revalidatePath('/projects');
}

export async function saveProject(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, role } = await ctx();
  if (!isManager(role)) return { error: 'Only an admin or a manager can change projects.' };
  const name = str(fd, 'name');
  const from = Number(str(fd, 'price_from'));
  if (!name) return { error: 'Enter the project name.' };
  const row = {
    org_id: org.id, name, developer: orNull(str(fd, 'developer')), location: orNull(str(fd, 'location')), rera_no: orNull(str(fd, 'rera_no')),
    type: orNull(str(fd, 'type')), configs: orNull(str(fd, 'configs')), price_from: from || null, price_to: Number(str(fd, 'price_to')) || null,
    status: orNull(str(fd, 'status')), possession: orNull(str(fd, 'possession')), highlights: orNull(str(fd, 'highlights')), link: orNull(str(fd, 'link')),
    lat: coord(str(fd, 'lat'), 90), lng: coord(str(fd, 'lng'), 180),
    size_from: whole(str(fd, 'size_from')), size_to: whole(str(fd, 'size_to')), units: whole(str(fd, 'units')),
    towers: orNull(str(fd, 'towers').slice(0, 120)), amenities: orNull(str(fd, 'amenities').slice(0, 600)), banks: orNull(str(fd, 'banks').slice(0, 200)),
  };
  const id = str(fd, 'id');
  const newId = /^[0-9a-f-]{36}$/i.test(str(fd, 'new_id')) ? str(fd, 'new_id') : undefined;
  const { error } = id
    ? await supabase.from('projects').update(row).eq('id', id).eq('org_id', org.id)
    : await supabase.from('projects').insert({ ...row, ...(newId ? { id: newId } : {}) } as Record<string, unknown>);
  if (error) return { error: friendly(error.message) };
  revalidatePath('/projects');
  return { ok: id ? 'Project saved' : 'Project added' };
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
  revalidatePath('/projects');
  return error ? { error: friendly(error.message) } : {};
}

export async function setCoverPhoto(id: string, url: string): Promise<{ error?: string }> {
  const p = await projectPhotos(id);
  if (!p || !p.photos.includes(url)) return { error: 'Photo not found.' };
  const { error } = await p.supabase.from('projects').update({ photos: [url, ...p.photos.filter((u) => u !== url)] }).eq('id', id).eq('org_id', p.org.id);
  revalidatePath('/projects');
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
