'use server';

import { revalidatePath } from 'next/cache';
import { requireOrg } from '@/lib/context';
import { isManager } from '@/lib/roles';
import { DOC_KINDS, SCORE_KEYS, STAGE_IDX, fmtDT, stageLabel } from '@/lib/crm';
import { notifyLeadAssigned } from '@/lib/whatsapp';

type R = { ok?: string; error?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type FuKind = 'call' | 'meeting' | 'visit' | 'whatsapp' | 'documents' | 'payment' | 'other';
const KINDS: FuKind[] = ['call', 'meeting', 'visit', 'whatsapp', 'documents', 'payment', 'other'];
const friendly = (m: string) => (/followups/.test(m) ? 'Run supabase/patch-042-followups-call-status.sql in Supabase first.' : /row-level security/.test(m) ? 'You do not have permission to do that.' : m);

function refresh(leadId?: string) {
  revalidatePath('/leads'); revalidatePath('/followups'); revalidatePath('/dashboard');
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

/* ---------- Many leads at once (the leads table) ---------- */

export async function bulkLeads(ids: string[], op: 'assign' | 'score' | 'stage' | 'delete', value: string): Promise<R> {
  const { supabase, org, role, user } = await requireOrg();
  const list = (Array.isArray(ids) ? ids : []).filter((x) => UUID.test(x)).slice(0, 500);
  if (!list.length) return { error: 'Select some leads first.' };
  const note = (lead_id: string, type: string, body: string) => ({ org_id: org.id, lead_id, type, body });

  if (op === 'assign') {
    if (role !== 'owner') return { error: 'Only the admin can hand leads to people.' };
    const to = value === 'none' ? null : value;
    if (to && !UUID.test(to)) return { error: 'Pick a person.' };
    const { data: person } = to ? await supabase.from('members').select('full_name, phone').eq('org_id', org.id).eq('user_id', to).maybeSingle() : { data: null };
    if (to && !person) return { error: 'That person is not in the team.' };
    const { data: leads } = await supabase.from('leads').select('id, name, phone, source, assigned_to').eq('org_id', org.id).in('id', list);
    const move = (leads ?? []).filter((l) => l.assigned_to !== to);
    if (!move.length) return { ok: 'Nothing to change.' };
    const { error } = await supabase.from('leads').update({ assigned_to: to }).eq('org_id', org.id).in('id', move.map((l) => l.id));
    if (error) return { error: friendly(error.message) };
    await supabase.from('activities').insert(move.map((l) => note(l.id, 'assign', to ? `Assigned to ${person!.full_name} (in bulk)` : 'Unassigned (in bulk)')));
    // One WhatsApp alert per lead would be noisy: alert for the first 5 only.
    if (to && to !== user.id) for (const l of move.slice(0, 5)) await notifyLeadAssigned({ agentPhone: person!.phone, agentName: person!.full_name, leadName: l.name, leadPhone: l.phone, source: l.source });
    refresh();
    return { ok: `${move.length} lead${move.length === 1 ? '' : 's'} ${to ? `given to ${person!.full_name}` : 'unassigned'}.` };
  }

  if (op === 'score') {
    if (!SCORE_KEYS.includes(value)) return { error: 'Pick hot, warm or cold.' };
    const { error } = await supabase.from('leads').update({ score: value }).eq('org_id', org.id).in('id', list);
    if (error) return { error: friendly(error.message) };
    refresh();
    return { ok: 'Interest changed.' };
  }

  if (op === 'stage') {
    if (STAGE_IDX[value] == null) return { error: 'Pick a status.' };
    const { data: leads } = await supabase.from('leads').select('id, stage').eq('org_id', org.id).in('id', list);
    const move = (leads ?? []).filter((l) => l.stage !== value);
    if (!move.length) return { ok: 'Nothing to change.' };
    const { error } = await supabase.from('leads').update({ stage: value }).eq('org_id', org.id).in('id', move.map((l) => l.id));
    if (error) return { error: friendly(error.message) };
    await supabase.from('activities').insert(move.map((l) => note(l.id, 'stage', `Stage: ${stageLabel(l.stage)} → ${stageLabel(value)} (in bulk)`)));
    refresh();
    return { ok: `${move.length} lead${move.length === 1 ? '' : 's'} moved to ${stageLabel(value)}.` };
  }

  if (op === 'delete') {
    if (!isManager(role)) return { error: 'Only an admin or a manager can delete leads.' };
    let done = 0;
    for (const id of list) {
      const { error } = await supabase.rpc('delete_lead', { p_id: id, p_reason: (value || 'Deleted in bulk').slice(0, 200) });
      if (!error) done++;
    }
    refresh();
    return done ? { ok: `${done} lead${done === 1 ? '' : 's'} deleted. The admin can bring them back from Leads → Deleted.` } : { error: 'Could not delete. Please try again.' };
  }
  return { error: 'Unknown action.' };
}

/* ---------- The "Update status" popup ---------- */

export type PopupData = {
  lead: { id: string; name: string; phone: string; stage: string; score: string; next_follow_up: string | null; last_outcome: string | null };
  history: { id: string; type: string; body: string; at: string; by: string }[];
  followups: { id: string; title: string; kind: string; due_at: string }[];
};

export async function leadPopup(id: string): Promise<PopupData | { error: string }> {
  const { supabase, org } = await requireOrg();
  if (!UUID.test(id)) return { error: 'Lead not found.' };
  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!lead) return { error: 'Lead not found.' };
  const [{ data: acts }, { data: fus }, { data: people }] = await Promise.all([
    supabase.from('activities').select('id, type, body, created_at, by_user').eq('lead_id', id).order('created_at', { ascending: false }).limit(15),
    supabase.from('followups').select('id, title, kind, due_at').eq('lead_id', id).is('done_at', null).order('due_at').limit(10),
    supabase.from('members').select('user_id, full_name').eq('org_id', org.id),
  ]);
  const who = new Map((people ?? []).map((p) => [p.user_id, p.full_name as string]));
  return {
    lead: { id: lead.id, name: lead.name, phone: lead.phone, stage: lead.stage, score: lead.score, next_follow_up: lead.next_follow_up, last_outcome: lead.last_outcome ?? null },
    history: (acts ?? []).map((a) => ({ id: a.id, type: a.type, body: a.body, at: a.created_at, by: a.by_user ? who.get(a.by_user) ?? 'Team' : 'System' })),
    followups: (fus ?? []) as PopupData['followups'],
  };
}

/* ---------- Follow-up tasks ---------- */

export async function addFollowup(input: { leadId: string; kind: string; title: string; dueAt: string; note?: string; assignedTo?: string }): Promise<R> {
  const { supabase, org, user, role } = await requireOrg();
  if (!UUID.test(input.leadId)) return { error: 'Lead not found.' };
  const due = Date.parse(input.dueAt);
  if (!Number.isFinite(due)) return { error: 'Pick a date and time.' };
  const kind = KINDS.includes(input.kind as FuKind) ? input.kind : 'call';
  const { data: lead } = await supabase.from('leads').select('id, assigned_to').eq('id', input.leadId).eq('org_id', org.id).maybeSingle();
  if (!lead) return { error: 'Lead not found.' };
  const to = isManager(role) && input.assignedTo && UUID.test(input.assignedTo) ? input.assignedTo : lead.assigned_to || user.id;
  const title = String(input.title ?? '').trim().slice(0, 200) || ({ call: 'Call back', meeting: 'Meeting', visit: 'Site visit', whatsapp: 'WhatsApp', documents: 'Collect documents', payment: 'Payment follow-up', other: 'Follow-up' } as Record<string, string>)[kind];
  const { error } = await supabase.from('followups').insert({ org_id: org.id, lead_id: lead.id, kind, title, note: String(input.note ?? '').trim().slice(0, 2000) || null, due_at: new Date(due).toISOString(), assigned_to: to });
  if (error) return { error: friendly(error.message) };
  await supabase.from('activities').insert({ org_id: org.id, lead_id: lead.id, type: 'note', body: `Follow-up set: ${title} on ${fmtDT(new Date(due).toISOString())}` });
  refresh(lead.id);
  return { ok: `Follow-up set for ${fmtDT(new Date(due).toISOString())}.` };
}

export async function finishFollowup(id: string, note = ''): Promise<R> {
  const { supabase, org } = await requireOrg();
  if (!UUID.test(id)) return { error: 'Not found.' };
  const { data: f } = await supabase.from('followups').select('id, lead_id, title, done_at').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!f) return { error: 'Not found.' };
  if (f.done_at) return { ok: 'Already done.' };
  const { error } = await supabase.from('followups').update({ done_at: new Date().toISOString(), done_note: String(note).trim().slice(0, 1000) || null }).eq('id', id);
  if (error) return { error: friendly(error.message) };
  await supabase.from('activities').insert({ org_id: org.id, lead_id: f.lead_id, type: 'note', body: `Done: ${f.title}${note.trim() ? '\n' + note.trim() : ''}` });
  refresh(f.lead_id);
  return { ok: 'Marked done.' };
}

export async function moveFollowup(id: string, dueAt: string): Promise<R> {
  const { supabase, org } = await requireOrg();
  const due = Date.parse(dueAt);
  if (!UUID.test(id) || !Number.isFinite(due)) return { error: 'Pick a date and time.' };
  const { data: f } = await supabase.from('followups').select('lead_id').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!f) return { error: 'Not found.' };
  const { error } = await supabase.from('followups').update({ due_at: new Date(due).toISOString() }).eq('id', id);
  if (error) return { error: friendly(error.message) };
  refresh(f.lead_id);
  return { ok: `Moved to ${fmtDT(new Date(due).toISOString())}.` };
}

export async function deleteFollowup(id: string): Promise<R> {
  const { supabase, org } = await requireOrg();
  if (!UUID.test(id)) return { error: 'Not found.' };
  const { data: f } = await supabase.from('followups').select('lead_id').eq('id', id).eq('org_id', org.id).maybeSingle();
  const { error } = await supabase.from('followups').delete().eq('id', id).eq('org_id', org.id);
  if (error) return { error: friendly(error.message) };
  refresh(f?.lead_id);
  return { ok: 'Removed.' };
}

/* ---------- Properties the client owns ---------- */

export async function addOwned(input: { leadId: string; title: string; location?: string; size?: string; price?: string; forWhat?: string; notes?: string }): Promise<R> {
  const { supabase, org } = await requireOrg();
  if (!UUID.test(input.leadId)) return { error: 'Lead not found.' };
  const title = String(input.title ?? '').trim().slice(0, 160);
  if (!title) return { error: 'Write what the property is, e.g. 3 BHK flat.' };
  const { data: lead } = await supabase.from('leads').select('id').eq('id', input.leadId).eq('org_id', org.id).maybeSingle();
  if (!lead) return { error: 'Lead not found.' };
  const size = Number(input.size), price = Number(input.price);
  const { error } = await supabase.from('lead_owned').insert({
    org_id: org.id, lead_id: lead.id, title, location: String(input.location ?? '').trim().slice(0, 200) || null,
    size_sqft: size > 0 ? Math.round(size) : null, price_l: price > 0 ? price : null,
    for_what: ['Sell', 'Rent out', 'Just owns'].includes(String(input.forWhat)) ? input.forWhat : 'Sell', notes: String(input.notes ?? '').trim().slice(0, 1000) || null,
  });
  if (error) return { error: /lead_owned/.test(error.message) ? 'Run supabase/patch-043-requirements-owned.sql in Supabase first.' : friendly(error.message) };
  await supabase.from('activities').insert({ org_id: org.id, lead_id: lead.id, type: 'note', body: `Owns: ${title}${input.location ? ', ' + input.location : ''}` });
  refresh(lead.id);
  return { ok: 'Saved.' };
}

export async function deleteOwned(id: string): Promise<R> {
  const { supabase, org } = await requireOrg();
  if (!UUID.test(id)) return { error: 'Not found.' };
  const { data: o } = await supabase.from('lead_owned').select('lead_id').eq('id', id).eq('org_id', org.id).maybeSingle();
  const { error } = await supabase.from('lead_owned').delete().eq('id', id).eq('org_id', org.id);
  if (error) return { error: friendly(error.message) };
  refresh(o?.lead_id);
  return { ok: 'Removed.' };
}

/* ---------- Documents on a lead (private bucket "lead-docs", patch-045) ---------- */

/** The file is uploaded from the browser first (storage rules check the lead); this records it. */
export async function saveLeadDoc(input: { leadId: string; path: string; name: string; kind: string; size: number }): Promise<R> {
  const { supabase, org } = await requireOrg();
  if (!UUID.test(input.leadId)) return { error: 'Lead not found.' };
  const [o, l] = String(input.path).split('/');
  if (o !== org.id || l !== input.leadId) return { error: 'Wrong file.' };
  const name = String(input.name ?? '').trim().slice(0, 160) || 'File';
  const kind = DOC_KINDS.includes(input.kind) ? input.kind : 'Other';
  const { error } = await supabase.from('lead_documents').insert({ org_id: org.id, lead_id: input.leadId, kind, name, path: input.path, size_bytes: Math.round(Number(input.size) || 0) || null });
  if (error) {
    await supabase.storage.from('lead-docs').remove([input.path]);
    return { error: /lead_documents/.test(error.message) ? 'Run supabase/patch-045-attendance-cold-docs.sql in Supabase first.' : friendly(error.message) };
  }
  await supabase.from('activities').insert({ org_id: org.id, lead_id: input.leadId, type: 'note', body: `Document added: ${kind} (${name})` });
  refresh(input.leadId);
  return { ok: 'Saved.' };
}

/** A link that works for 10 minutes. */
export async function leadDocLink(id: string): Promise<{ url?: string; error?: string }> {
  const { supabase, org } = await requireOrg();
  if (!UUID.test(id)) return { error: 'Not found.' };
  const { data: d } = await supabase.from('lead_documents').select('path').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!d) return { error: 'Not found.' };
  const { data, error } = await supabase.storage.from('lead-docs').createSignedUrl(d.path, 600);
  if (error || !data) return { error: 'Could not open the file.' };
  return { url: data.signedUrl };
}

export async function deleteLeadDoc(id: string): Promise<R> {
  const { supabase, org } = await requireOrg();
  if (!UUID.test(id)) return { error: 'Not found.' };
  const { data: d } = await supabase.from('lead_documents').select('path, lead_id').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!d) return { error: 'Not found.' };
  const { error } = await supabase.from('lead_documents').delete().eq('id', id).eq('org_id', org.id);
  if (error) return { error: friendly(error.message) };
  const { count } = await supabase.from('lead_documents').select('id', { count: 'exact', head: true }).eq('id', id);
  if (count) return { error: 'Only an admin, a manager or the person who added it can remove this.' };
  await supabase.storage.from('lead-docs').remove([d.path]);
  refresh(d.lead_id);
  return { ok: 'Removed.' };
}
