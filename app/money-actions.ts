'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOrg } from '@/lib/context';
import { IN_CATEGORIES, OUT_CATEGORIES, parseRupees, todayIST } from '@/lib/money';
import type { FormState } from '@/app/actions';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const friendly = (m?: string) => (m?.includes('row-level security') ? 'Only admins can change money records.' : m?.includes('deals_lead_uq') ? 'This lead already has a deal. Open it from the Deals list.' : m || 'Something went wrong.');
const admin = () => requireOrg(['owner']);
const done = (dealId?: string) => { revalidatePath('/money'); if (dealId) revalidatePath(`/money/deals/${dealId}`); };

export async function saveDeal(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await admin();
  const id = str(fd, 'id');
  const value = parseRupees(str(fd, 'agreement_value'));
  if (!str(fd, 'buyer_name')) return { error: 'Enter the buyer name.' };
  if (value == null) return { error: 'Enter the deal value, e.g. 1.25 Cr or 9500000.' };
  const pct = str(fd, 'commission_pct') ? Number(str(fd, 'commission_pct')) : null;
  if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return { error: 'Commission % should be between 0 and 100.' };
  const comTyped = parseRupees(str(fd, 'commission_amount'));
  const commission = comTyped ?? (pct != null ? Math.round((value * pct) / 100) : 0);
  const row = {
    org_id: org.id, buyer_name: str(fd, 'buyer_name').slice(0, 120), unit_no: str(fd, 'unit_no') || null,
    lead_id: str(fd, 'lead_id') || null, project_id: str(fd, 'project_id') || null, booked_on: date(str(fd, 'booked_on')) ?? todayIST(),
    agreement_value: value, commission_pct: pct, commission_amount: commission, agent_id: str(fd, 'agent_id') || null,
    incentive_amount: parseRupees(str(fd, 'incentive_amount')) ?? 0, status: str(fd, 'status') === 'cancelled' ? 'cancelled' : 'active', notes: str(fd, 'notes') || null,
  };
  // Broker / channel partner commission (patch-044)
  const brokerId = /^[0-9a-f-]{36}$/.test(str(fd, 'broker_id')) ? str(fd, 'broker_id') : null;
  const bPct = str(fd, 'broker_pct') ? Number(str(fd, 'broker_pct')) : null;
  if (bPct != null && (!Number.isFinite(bPct) || bPct < 0 || bPct > 100)) return { error: 'Broker % should be between 0 and 100.' };
  const bTyped = parseRupees(str(fd, 'broker_amount'));
  const broker = fd.has('broker_id') ? {
    broker_id: brokerId, broker_pct: brokerId ? bPct : null,
    broker_amount: brokerId ? bTyped ?? (bPct != null ? Math.round((value * bPct) / 100) : 0) : 0,
    broker_paid: brokerId ? parseRupees(str(fd, 'broker_paid')) ?? 0 : 0,
    incentive_paid: parseRupees(str(fd, 'incentive_paid')) ?? 0,
  } : {};
  const full = { ...row, ...broker };
  const write = (r: Record<string, unknown>) => (id ? supabase.from('deals').update(r).eq('id', id).eq('org_id', org.id).select('id').single() : supabase.from('deals').insert(r).select('id').single());
  let { data, error } = await write(full);
  if (error && /broker|incentive_paid/.test(error.message)) ({ data, error } = await write(row)); // patch-044 not run yet
  if (error || !data) return { error: friendly(error?.message) };
  if (id) { done(id); return { ok: 'Saved' }; }
  // A booking: the lead becomes "Booked"
  if (row.lead_id && row.status === 'active') {
    await supabase.from('leads').update({ stage: 'booked', booked_at: new Date().toISOString(), ...(brokerId ? { broker_id: brokerId } : {}) }).eq('id', row.lead_id).eq('org_id', org.id);
    await supabase.from('activities').insert({ org_id: org.id, lead_id: row.lead_id, type: 'stage', body: `Booked${row.unit_no ? ` unit ${row.unit_no}` : ''} for ₹${value.toLocaleString('en-IN')}` });
    revalidatePath(`/leads/${row.lead_id}`); revalidatePath('/leads');
  }
  // Standard payment plan to start from; the admin can change every line.
  if (str(fd, 'plan') !== 'none') {
    const b = row.booked_on; const add = (days: number) => { const d = new Date(b + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
    await supabase.from('deal_installments').insert([
      { org_id: org.id, deal_id: data.id, label: 'Token / booking amount', amount: Math.round(value * 0.02), due_on: b },
      { org_id: org.id, deal_id: data.id, label: 'Agreement (8%)', amount: Math.round(value * 0.08), due_on: add(30) },
      { org_id: org.id, deal_id: data.id, label: 'Bank loan disbursal (80%)', amount: Math.round(value * 0.8), due_on: add(75) },
      { org_id: org.id, deal_id: data.id, label: 'On possession (10%)', amount: Math.round(value * 0.1), due_on: add(365) },
    ]);
  }
  done();
  redirect(`/money/deals/${data.id}`);
}

export async function deleteDeal(fd: FormData) {
  const { supabase, org } = await admin();
  await supabase.from('deals').delete().eq('id', str(fd, 'id')).eq('org_id', org.id);
  done();
  redirect('/money?tab=deals');
}

export async function saveInstallment(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await admin();
  const dealId = str(fd, 'deal_id'); const id = str(fd, 'id');
  const amount = parseRupees(str(fd, 'amount'));
  if (!str(fd, 'label')) return { error: 'Name this payment, e.g. "Agreement".' };
  if (amount == null) return { error: 'Enter the amount.' };
  const paid = parseRupees(str(fd, 'paid_amount')) ?? 0;
  const row = { org_id: org.id, deal_id: dealId, label: str(fd, 'label').slice(0, 80), amount, due_on: date(str(fd, 'due_on')), paid_amount: paid, paid_on: paid > 0 ? date(str(fd, 'paid_on')) ?? todayIST() : null, note: str(fd, 'note') || null };
  const { error } = id ? await supabase.from('deal_installments').update(row).eq('id', id).eq('org_id', org.id) : await supabase.from('deal_installments').insert(row);
  if (error) return { error: friendly(error.message) };
  done(dealId);
  return { ok: 'Saved' };
}

export async function markInstallmentPaid(fd: FormData) {
  const { supabase, org } = await admin();
  const { data } = await supabase.from('deal_installments').select('amount, deal_id').eq('id', str(fd, 'id')).eq('org_id', org.id).single();
  if (!data) return;
  await supabase.from('deal_installments').update({ paid_amount: data.amount, paid_on: todayIST() }).eq('id', str(fd, 'id')).eq('org_id', org.id);
  done(data.deal_id);
}

export async function deleteInstallment(fd: FormData) {
  const { supabase, org } = await admin();
  await supabase.from('deal_installments').delete().eq('id', str(fd, 'id')).eq('org_id', org.id);
  done(str(fd, 'deal_id'));
}

export async function addEntry(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await admin();
  const category = str(fd, 'category');
  const direction = (IN_CATEGORIES as readonly string[]).includes(category) ? 'in' : (OUT_CATEGORIES as readonly string[]).includes(category) ? 'out' : null;
  if (!direction) return { error: 'Pick what this money is for.' };
  const amount = parseRupees(str(fd, 'amount'));
  if (!amount || amount <= 0) return { error: 'Enter the amount, e.g. 45000 or 1.2 L.' };
  const dealId = str(fd, 'deal_id') || null;
  const { error } = await supabase.from('money_entries').insert({
    org_id: org.id, entry_date: date(str(fd, 'entry_date')) ?? todayIST(), direction, category, amount, deal_id: dealId,
    person_id: str(fd, 'person_id') || null, lead_source: category === 'Ads' ? str(fd, 'lead_source') || null : null,
    mode: str(fd, 'mode') || null, note: str(fd, 'note').slice(0, 300) || null,
  });
  if (error) return { error: friendly(error.message) };
  done(dealId ?? undefined);
  return { ok: `Saved ${direction === 'in' ? 'money in' : 'money out'}` };
}

export async function deleteEntry(fd: FormData) {
  const { supabase, org } = await admin();
  await supabase.from('money_entries').delete().eq('id', str(fd, 'id')).eq('org_id', org.id);
  done(str(fd, 'deal_id') || undefined);
}
