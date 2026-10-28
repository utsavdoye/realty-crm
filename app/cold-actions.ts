'use server';

import { revalidatePath } from 'next/cache';
import { requireOrg } from '@/lib/context';
import { isManager, normPhone, validPhone } from '@/lib/roles';
import { notifyLeadAssigned } from '@/lib/whatsapp';

type R = { ok?: string; error?: string; leadId?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const friendly = (m: string) => (/cold_contacts/.test(m) ? 'Run supabase/patch-045-attendance-cold-docs.sql in Supabase first.' : /row-level security/.test(m) ? 'You do not have permission to do that.' : m);
const STATUSES = ['noanswer', 'callback', 'interested', 'notint', 'wrong'] as const;

/** Upload a list of numbers to call. Numbers already in Leads or already in a cold list are skipped. */
export async function importCold(rows: { name?: string; phone?: string; area?: string; note?: string }[], listName: string, assign: string): Promise<R> {
  const { supabase, org, role } = await requireOrg();
  if (!isManager(role)) return { error: 'Only an admin or a manager can upload lists.' };
  const list = String(listName || 'Cold data').trim().slice(0, 80) || 'Cold data';
  const clean = new Map<string, { name: string | null; phone: string; area: string | null; note: string | null }>();
  for (const r of (Array.isArray(rows) ? rows : []).slice(0, 5000)) {
    const phone = normPhone(String(r.phone ?? ''));
    if (!validPhone(phone) || clean.has(phone)) continue;
    clean.set(phone, { name: String(r.name ?? '').trim().slice(0, 120) || null, phone, area: String(r.area ?? '').trim().slice(0, 120) || null, note: String(r.note ?? '').trim().slice(0, 500) || null });
  }
  if (!clean.size) return { error: 'No valid mobile numbers found.' };
  const phones = [...clean.keys()];
  const known = new Set<string>();
  for (let i = 0; i < phones.length; i += 500) {
    const part = phones.slice(i, i + 500);
    const [{ data: l }, { data: c }] = await Promise.all([
      supabase.from('leads').select('phone').eq('org_id', org.id).in('phone', part),
      supabase.from('cold_contacts').select('phone').eq('org_id', org.id).in('phone', part),
    ]);
    (l ?? []).forEach((x) => known.add(x.phone)); (c ?? []).forEach((x) => known.add(x.phone));
  }
  const fresh = phones.filter((p) => !known.has(p)).map((p) => clean.get(p)!);
  if (!fresh.length) return { ok: 'All these numbers are already in the CRM.' };
  // Split among active callers, or give all to one person
  let callers: string[] = [];
  if (assign === 'split') {
    const { data: people } = await supabase.from('members').select('user_id, role').eq('org_id', org.id).eq('active', true).in('role', ['agent', 'intern']);
    callers = (people ?? []).map((p) => p.user_id);
  } else if (UUID.test(assign)) callers = [assign];
  const ins = fresh.map((r, i) => ({ org_id: org.id, list_name: list, ...r, assigned_to: callers.length ? callers[i % callers.length] : null }));
  for (let i = 0; i < ins.length; i += 500) {
    const { error } = await supabase.from('cold_contacts').insert(ins.slice(i, i + 500));
    if (error) return { error: friendly(error.message) };
  }
  revalidatePath('/cold');
  return { ok: `${fresh.length} number${fresh.length === 1 ? '' : 's'} added${known.size ? `, ${phones.length - fresh.length} skipped (already in the CRM)` : ''}.` };
}

export async function assignCold(ids: string[], to: string): Promise<R> {
  const { supabase, org, role } = await requireOrg();
  if (!isManager(role)) return { error: 'Only an admin or a manager can do this.' };
  const list = ids.filter((x) => UUID.test(x)).slice(0, 2000);
  const { error } = await supabase.from('cold_contacts').update({ assigned_to: UUID.test(to) ? to : null }).eq('org_id', org.id).in('id', list);
  if (error) return { error: friendly(error.message) };
  revalidatePath('/cold');
  return { ok: `${list.length} number${list.length === 1 ? '' : 's'} given.` };
}

export async function deleteCold(ids: string[]): Promise<R> {
  const { supabase, org, role } = await requireOrg();
  if (!isManager(role)) return { error: 'Only an admin or a manager can do this.' };
  const { error } = await supabase.from('cold_contacts').delete().eq('org_id', org.id).in('id', ids.filter((x) => UUID.test(x)).slice(0, 2000));
  if (error) return { error: friendly(error.message) };
  revalidatePath('/cold');
  return { ok: 'Removed.' };
}

/** After calling a number: what happened. "Interested" turns it into a lead for the caller. */
export async function coldResult(id: string, status: string, note = '', callbackAt = ''): Promise<R> {
  const { supabase, org, user, role } = await requireOrg();
  if (!UUID.test(id) || !STATUSES.includes(status as (typeof STATUSES)[number])) return { error: 'Pick what happened.' };
  const { data: c } = await supabase.from('cold_contacts').select('*').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!c) return { error: 'Not found.' };
  const cb = status === 'callback' && Number.isFinite(Date.parse(callbackAt)) ? new Date(callbackAt).toISOString() : status === 'noanswer' ? new Date(Date.now() + 3 * 3600000).toISOString() : null;
  const patch: Record<string, unknown> = { status, attempts: (c.attempts ?? 0) + 1, called_at: new Date().toISOString(), callback_at: cb, note: note.trim() ? [c.note, note.trim()].filter(Boolean).join('\n').slice(0, 500) : c.note };
  if (status === 'interested' && !c.lead_id) {
    const owner = role === 'partner' ? null : c.assigned_to || user.id;
    const { data: lead, error } = await supabase.from('leads').insert({
      org_id: org.id, name: c.name || 'Cold call client', phone: c.phone, location: c.area, source: 'Cold calling', assigned_to: owner, score: 'warm', stage: 'contacted', next_follow_up: new Date(Date.now() + 24 * 3600000).toISOString(),
    }).select('id').single();
    if (error) {
      if (error.code === '23505') return { error: 'This number is already a lead.' };
      return { error: friendly(error.message) };
    }
    patch.lead_id = lead.id;
    await supabase.from('activities').insert({ org_id: org.id, lead_id: lead.id, type: 'created', body: `From cold calling list “${c.list_name}”${note.trim() ? '\n' + note.trim() : ''}` });
    if (owner && owner !== user.id) {
      const { data: a } = await supabase.from('members').select('full_name, phone').eq('org_id', org.id).eq('user_id', owner).maybeSingle();
      if (a) await notifyLeadAssigned({ agentPhone: a.phone, agentName: a.full_name, leadName: c.name || 'Cold call client', leadPhone: c.phone, source: 'Cold calling' });
    }
  }
  const { error } = await supabase.from('cold_contacts').update(patch).eq('id', id).eq('org_id', org.id);
  if (error) return { error: friendly(error.message) };
  revalidatePath('/cold'); if (patch.lead_id) revalidatePath('/leads');
  return { ok: patch.lead_id ? 'Added to Leads.' : 'Saved.', leadId: (patch.lead_id as string) ?? undefined };
}
