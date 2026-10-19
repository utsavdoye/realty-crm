'use server';

import { createAnonClient } from '@/lib/supabase/admin';
import { fromLocalInput } from '@/lib/crm';
import { normPhone, validPhone } from '@/lib/roles';

const TOKEN = /^[a-f0-9]{24,64}$/;

export async function sendEnquiry(_: { ok?: boolean; error?: string } | null, fd: FormData): Promise<{ ok?: boolean; error?: string }> {
  const token = String(fd.get('token') ?? '');
  const name = String(fd.get('name') ?? '').trim();
  const phone = normPhone(String(fd.get('phone') ?? ''));
  if (!TOKEN.test(token)) return { error: 'This link is not valid.' };
  if (!name) return { error: 'Please enter your name.' };
  if (!validPhone(phone)) return { error: 'Please enter a valid mobile number. Outside India, start with + and your country code.' };
  const when = fromLocalInput(String(fd.get('when') ?? ''));
  const { data, error } = await createAnonClient().rpc('public_enquiry', {
    p_token: token, p_name: name.slice(0, 120), p_phone: phone, p_message: String(fd.get('message') ?? '').slice(0, 500), p_when: when,
  });
  if (error || !data) return { error: 'Could not send. Please call us instead.' };
  return { ok: true };
}

export async function shortlistSeen(token: string) {
  if (!TOKEN.test(token)) return;
  await createAnonClient().rpc('shortlist_seen', { p_token: token });
}

export async function shortlistReact(token: string, projectId: string, reaction: 'like' | 'no' | 'visit', whenLocal?: string): Promise<boolean> {
  if (!TOKEN.test(token) || !/^[0-9a-f-]{36}$/.test(projectId) || !['like', 'no', 'visit'].includes(reaction)) return false;
  const { data } = await createAnonClient().rpc('shortlist_react', { p_token: token, p_project: projectId, p_reaction: reaction, p_when: whenLocal ? fromLocalInput(whenLocal) : null });
  return !!data;
}

export type ReqState = { ok?: boolean; error?: string; fits?: number; advisor?: string | null; name?: string } | null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const s = (fd: FormData, k: string, max = 120) => String(fd.get(k) ?? '').trim().slice(0, max);
const num = (v: string) => (/^\d{1,6}$/.test(v) ? Number(v) : null);

/** Client requirement form (/r/...) → lead in the CRM. */
export async function sendRequirement(_: ReqState, fd: FormData): Promise<ReqState> {
  const token = s(fd, 'token', 64);
  const by = s(fd, 'by', 36);
  const name = s(fd, 'name');
  const phone = normPhone(s(fd, 'phone', 30));
  if (!TOKEN.test(token)) return { error: 'This link is not valid.' };
  if (name.length < 2) return { error: 'Please enter your name.' };
  if (!validPhone(phone)) return { error: 'Please enter a valid mobile number.' };
  const { data, error } = await createAnonClient().rpc('submit_requirement', {
    p_form: token, p_by: UUID.test(by) ? by : null, p_name: name, p_phone: phone,
    p_bhk: s(fd, 'bhk', 40), p_ptype: s(fd, 'ptype', 40), p_bmin: num(s(fd, 'bmin', 12)), p_bmax: num(s(fd, 'bmax', 12)),
    p_location: s(fd, 'location', 200), p_purpose: s(fd, 'purpose', 40), p_timeline: s(fd, 'timeline', 40),
    p_loan: s(fd, 'loan', 20), p_slot: s(fd, 'slot', 20), p_note: s(fd, 'note', 500),
  });
  const r = data as { ok: boolean; fits?: number; advisor?: string | null; busy?: boolean } | null;
  if (r?.busy) return { error: 'Too many forms right now. Please try again in a few minutes, or call us.' };
  if (error || !r?.ok) return { error: 'Could not send. Please check your number and try again.' };
  return { ok: true, fits: r.fits ?? 0, advisor: r.advisor ?? null, name: name.split(' ')[0] };
}

export type Unlocked = { photos: string[]; price_to: number | null; link: string | null; floor_plans: { url: string; label: string }[]; files_locked?: boolean };

/** Project page: client leaves name + number → gets the full price range, all photos and the brochure. */
export async function unlockProject(_: { ok?: boolean; error?: string; data?: Unlocked } | null, fd: FormData): Promise<{ ok?: boolean; error?: string; data?: Unlocked }> {
  const token = s(fd, 'token', 64);
  const name = s(fd, 'name');
  const phone = normPhone(s(fd, 'phone', 30));
  if (!TOKEN.test(token)) return { error: 'This link is not valid.' };
  if (name.length < 2) return { error: 'Please enter your name.' };
  if (!validPhone(phone)) return { error: 'Please enter a valid mobile number.' };
  // One step in the database: saves the enquiry, then (only then) gives the full details.
  const { data } = await createAnonClient().rpc('unlock_public_project', { p_token: token, p_name: name, p_phone: phone });
  const p = data as { photos: string[] | null; price_to: number | null; link: string | null; floor_plans?: { url: string; label: string }[] | null; files_locked?: boolean } | null;
  if (!p) return { error: 'Could not open right now. Please try again in a minute, or call us.' };
  return { ok: true, data: { photos: p?.photos ?? [], price_to: p?.price_to ?? null, link: p?.link ?? null, floor_plans: p?.floor_plans ?? [], files_locked: !!p?.files_locked } };
}

/** Shortlist page: the client is already known, so one tap unlocks it and tells their advisor. */
export async function unlockShortlist(token: string, projectId: string): Promise<Unlocked | null> {
  if (!TOKEN.test(token) || !UUID.test(projectId)) return null;
  const db = createAnonClient();
  const { data: ok } = await db.rpc('shortlist_react', { p_token: token, p_project: projectId, p_reaction: 'details', p_when: null });
  if (!ok) return null;
  // Brochure and floor plans come back only after the client's first call is marked done (patch-024).
  const { data } = await db.rpc('shortlist_unlock', { p_token: token, p_project: projectId });
  const p = data as { photos: string[] | null; price_to: number | null; link: string | null; floor_plans?: { url: string; label: string }[] | null; files_locked?: boolean } | null;
  return p ? { photos: p.photos ?? [], price_to: p.price_to, link: p.link, floor_plans: p.floor_plans ?? [], files_locked: !!p.files_locked } : null;
}
