'use server';

import { createAnonClient } from '@/lib/supabase/admin';
import { fromLocalInput } from '@/lib/crm';

const TOKEN = /^[a-f0-9]{24,64}$/;

export async function sendEnquiry(_: { ok?: boolean; error?: string } | null, fd: FormData): Promise<{ ok?: boolean; error?: string }> {
  const token = String(fd.get('token') ?? '');
  const name = String(fd.get('name') ?? '').trim();
  const phone = String(fd.get('phone') ?? '').replace(/\D/g, '').slice(-10);
  if (!TOKEN.test(token)) return { error: 'This link is not valid.' };
  if (!name) return { error: 'Please enter your name.' };
  if (!/^[6-9]\d{9}$/.test(phone)) return { error: 'Please enter a valid 10-digit mobile number.' };
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
