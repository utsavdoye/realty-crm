'use server';

import { revalidatePath } from 'next/cache';
import { requireOrg } from '@/lib/context';
import { isManager, normPhone } from '@/lib/roles';
import type { FormState } from '@/app/actions';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const friendly = (m: string) => (/brokers|broker_id/.test(m) ? 'Run supabase/patch-044-brokers-booking.sql in Supabase first.' : /row-level security/.test(m) ? 'Only an admin or a manager can do this.' : m);

export async function saveBroker(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, role } = await requireOrg();
  if (!isManager(role)) return { error: 'Only an admin or a manager can add brokers.' };
  const name = str(fd, 'name').slice(0, 120);
  if (!name) return { error: 'Enter the broker name.' };
  const pct = str(fd, 'default_pct') ? Number(str(fd, 'default_pct')) : null;
  if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return { error: 'Commission % should be between 0 and 100.' };
  const row = { org_id: org.id, name, firm: str(fd, 'firm').slice(0, 120) || null, phone: str(fd, 'phone') ? normPhone(str(fd, 'phone')).slice(0, 20) : null, rera_no: str(fd, 'rera_no').slice(0, 60) || null, default_pct: pct, notes: str(fd, 'notes').slice(0, 1000) || null };
  const id = str(fd, 'id');
  const { error } = UUID.test(id) ? await supabase.from('brokers').update(row).eq('id', id).eq('org_id', org.id) : await supabase.from('brokers').insert(row);
  if (error) return { error: friendly(error.message) };
  revalidatePath('/brokers');
  return { ok: UUID.test(id) ? 'Saved.' : `${name} added.` };
}

export async function setBrokerActive(id: string, active: boolean) {
  const { supabase, org, role } = await requireOrg();
  if (!isManager(role) || !UUID.test(id)) return;
  await supabase.from('brokers').update({ active }).eq('id', id).eq('org_id', org.id);
  revalidatePath('/brokers');
}

/** Lead page: which broker / channel partner brought this client. */
export async function setLeadBroker(fd: FormData) {
  const { supabase, org, role, user } = await requireOrg();
  const id = str(fd, 'id'); const b = str(fd, 'broker_id');
  if (!UUID.test(id)) return;
  const { data: lead } = await supabase.from('leads').select('id, assigned_to').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!lead || (!isManager(role) && lead.assigned_to !== user.id)) return;
  const brokerId = UUID.test(b) ? b : null;
  const { error } = await supabase.from('leads').update({ broker_id: brokerId }).eq('id', id).eq('org_id', org.id);
  if (error) return;
  const { data: br } = brokerId ? await supabase.from('brokers').select('name').eq('id', brokerId).maybeSingle() : { data: null };
  await supabase.from('activities').insert({ org_id: org.id, lead_id: id, type: 'note', body: br ? `Broker: ${br.name}` : 'Broker removed' });
  revalidatePath(`/leads/${id}`); revalidatePath('/brokers');
}
