'use server';

import { revalidatePath } from 'next/cache';
import { requireOrg } from '@/lib/context';

export async function workEvent(event: 'ping' | 'break' | 'back' | 'logout', reason = ''): Promise<{ ok?: boolean; error?: string }> {
  const { supabase, org, role } = await requireOrg();
  if (role === 'partner') return { ok: true };
  const { error } = await supabase.rpc('work_event', { p_org: org.id, p_event: event, p_reason: reason.slice(0, 80) || null });
  if (error) return { error: /work_event/.test(error.message) ? 'Run supabase/patch-045-attendance-cold-docs.sql first.' : error.message };
  if (event !== 'ping') revalidatePath('/attendance');
  return { ok: true };
}

export async function setWorkHours(_: unknown, fd: FormData): Promise<{ ok?: string; error?: string }> {
  const { supabase, org } = await requireOrg(['owner']);
  const start = String(fd.get('work_start') ?? ''); const hours = Number(fd.get('work_hours'));
  if (!/^\d{2}:\d{2}$/.test(start) || !(hours >= 1 && hours <= 16)) return { error: 'Pick a start time and 1–16 hours.' };
  const { error } = await supabase.rpc('set_work_hours', { p_org: org.id, p_start: start, p_hours: hours });
  if (error) return { error: error.message };
  revalidatePath('/attendance');
  return { ok: 'Saved.' };
}
