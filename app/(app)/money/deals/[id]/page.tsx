import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/context';
import { DealForm } from '@/components/DealForm';
import { ActionForm, Submit } from '@/components/forms';
import { addEntry, deleteDeal, deleteEntry, deleteInstallment, markInstallmentPaid, saveInstallment } from '@/app/money-actions';
import { MODES, inr, inrShort, todayIST } from '@/lib/money';
import { fmtDate } from '@/lib/crm';

export const metadata = { title: 'Deal' };

export default async function DealPage({ params }: { params: { id: string } }) {
  const { supabase, org } = await requireOrg(['owner']);
  const { data: d } = await supabase.from('deals').select('*').eq('id', params.id).eq('org_id', org.id).maybeSingle();
  if (!d) notFound();
  const [{ data: inst }, { data: entries }, { data: projects }, { data: people }] = await Promise.all([
    supabase.from('deal_installments').select('*').eq('deal_id', d.id).order('due_on', { nullsFirst: false }),
    supabase.from('money_entries').select('id, entry_date, category, amount, person_id, mode, note, direction').eq('deal_id', d.id).order('entry_date'),
    supabase.from('projects').select('id, name').eq('org_id', org.id).order('name'),
    supabase.from('members').select('user_id, full_name').eq('org_id', org.id).neq('role', 'partner').order('full_name'),
  ]);
  const today = todayIST();
  const its = inst ?? [];
  const due = its.reduce((s, i) => s + Number(i.amount), 0);
  const paid = its.reduce((s, i) => s + Number(i.paid_amount), 0);
  const com = (entries ?? []).filter((e) => e.category === 'Commission').reduce((s, e) => s + Number(e.amount), 0);
  const inc = (entries ?? []).filter((e) => e.category === 'Incentive').reduce((s, e) => s + Number(e.amount), 0);
  const nameOf = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const project = (projects ?? []).find((p) => p.id === d.project_id)?.name;

  return (
    <>
      <div className="lead-head">
        <Link href="/money?tab=deals" className="hint">← All deals</Link>
        <div className="top" style={{ marginBottom: 6 }}>
          <h1>{d.buyer_name}</h1>
          {d.status === 'cancelled' && <span className="chip bad">Cancelled</span>}
          {d.lead_id && <Link className="btn sm" href={`/leads/${d.lead_id}`}>Open lead</Link>}
        </div>
        <div className="hint">{[project, d.unit_no, 'Booked ' + fmtDate(d.booked_on), d.agent_id ? 'by ' + nameOf.get(d.agent_id) : null].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="kpis">
        <div className="kpi"><span className="label">Deal value</span><span className="n">{inrShort(d.agreement_value)}</span></div>
        <div className="kpi"><span className="label">Buyer has paid</span><span className="n">{due ? Math.round((paid / due) * 100) : 0}%</span><span className="hint">{inrShort(paid)} of {inrShort(due)}</span></div>
        <div className={`kpi ${com < Number(d.commission_amount) ? 'alert' : ''}`}><span className="label">Our commission</span><span className="n">{inrShort(d.commission_amount)}</span><span className="hint">Received {inrShort(com)}{com < Number(d.commission_amount) ? ` · ${inrShort(Number(d.commission_amount) - com)} to come` : ' · full'}</span></div>
        <div className="kpi"><span className="label">Employee incentive</span><span className="n">{inrShort(d.incentive_amount)}</span><span className="hint">Paid {inrShort(inc)}</span></div>
      </div>
      <div className="grid-main">
        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Buyer payment plan</h2><span className="hint">Track what the buyer pays the builder</span></div>
            <div className="table-wrap"><table className="tbl">
              <thead><tr><th>Payment</th><th>Due</th><th className="n">Amount</th><th className="n">Paid</th><th></th></tr></thead>
              <tbody>{its.map((i) => {
                const late = i.due_on && i.due_on < today && Number(i.paid_amount) < Number(i.amount);
                const full = Number(i.paid_amount) >= Number(i.amount);
                return (
                  <tr key={i.id}>
                    <td>{i.label}{i.note && <div className="hint">{i.note}</div>}</td>
                    <td className="nowrap">{fmtDate(i.due_on)}{late && <span className="chip bad">Late</span>}</td>
                    <td className="n">{inr(i.amount)}</td>
                    <td className="n">{full ? <span className="chip good">Paid {fmtDate(i.paid_on)}</span> : Number(i.paid_amount) > 0 ? inr(i.paid_amount) : '—'}</td>
                    <td className="nowrap">
                      {!full && <form action={markInstallmentPaid} className="inline"><input type="hidden" name="id" value={i.id} /><button className="btn sm">Mark paid</button></form>}
                      <details className="inline-details"><summary className="btn sm ghost">Edit</summary>
                        <ActionForm action={saveInstallment} className="stack inline-box">
                          <input type="hidden" name="id" value={i.id} /><input type="hidden" name="deal_id" value={d.id} />
                          <input name="label" defaultValue={i.label} aria-label="Payment name" />
                          <div className="row-gap"><input name="amount" defaultValue={String(i.amount)} aria-label="Amount" /><input type="date" name="due_on" defaultValue={i.due_on ?? ''} aria-label="Due date" /></div>
                          <div className="row-gap"><input name="paid_amount" defaultValue={String(i.paid_amount)} aria-label="Paid amount" /><input type="date" name="paid_on" defaultValue={i.paid_on ?? ''} aria-label="Paid on" /></div>
                          <input name="note" defaultValue={i.note ?? ''} placeholder="Note" />
                          <div className="row-gap"><Submit className="btn sm primary">Save</Submit></div>
                        </ActionForm>
                        <form action={deleteInstallment}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="deal_id" value={d.id} /><button className="btn sm ghost danger">Delete this line</button></form>
                      </details>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            <details className="panel-b"><summary className="btn sm">+ Add a payment line</summary>
              <ActionForm action={saveInstallment} className="stack inline-box">
                <input type="hidden" name="deal_id" value={d.id} />
                <div className="grid2f">
                  <label className="field"><span className="label">Name</span><input name="label" required placeholder="e.g. Slab 3 (10%)" /></label>
                  <label className="field"><span className="label">Amount (₹)</span><input name="amount" required placeholder="e.g. 12 L" /></label>
                  <label className="field"><span className="label">Due on</span><input type="date" name="due_on" /></label>
                  <label className="field"><span className="label">Already paid (₹)</span><input name="paid_amount" placeholder="0" /></label>
                </div>
                <div><Submit className="btn sm primary">Add</Submit></div>
              </ActionForm>
            </details>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Commission and incentive payments</h2></div>
            <div className="rows">{(entries ?? []).length ? (entries ?? []).map((e) => (
              <div key={e.id} className="callrow">
                <span className="cr-main"><b>{e.direction === 'in' ? '+' : '−'}{inr(e.amount)} · {e.category}{e.person_id ? ' to ' + nameOf.get(e.person_id) : ''}</b><span className="hint">{fmtDate(e.entry_date)}{e.mode ? ' · ' + e.mode : ''}{e.note ? ' · ' + e.note : ''}</span></span>
                <form action={deleteEntry}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="deal_id" value={d.id} /><button className="btn sm ghost danger" aria-label="Delete">✕</button></form>
              </div>
            )) : <p className="empty">Nothing received or paid yet for this deal.</p>}</div>
            <div className="panel-b">
              <ActionForm action={addEntry} className="stack">
                <input type="hidden" name="deal_id" value={d.id} />
                <div className="grid2f">
                  <label className="field"><span className="label">Type</span><select name="category" defaultValue="Commission"><option value="Commission">Commission received from builder</option><option value="Incentive">Incentive paid to employee</option></select></label>
                  <label className="field"><span className="label">Amount (₹)</span><input name="amount" required placeholder="e.g. 1.5 L" /></label>
                  <label className="field"><span className="label">Date</span><input type="date" name="entry_date" defaultValue={today} max={today} /></label>
                  <label className="field"><span className="label">Mode</span><select name="mode" defaultValue="Bank transfer">{MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
                  <input type="hidden" name="person_id" value={d.agent_id ?? ''} />
                </div>
                <div><Submit className="btn sm primary">Save payment</Submit></div>
              </ActionForm>
            </div>
          </section>
        </div>
        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Deal details</h2></div>
            <div className="panel-b"><DealForm d={d} projects={projects ?? []} people={people ?? []} /></div>
          </section>
          <details className="panel danger-zone"><summary className="btn sm ghost danger" style={{ margin: 12 }}>Delete this deal</summary>
            <form action={deleteDeal} className="panel-b"><input type="hidden" name="id" value={d.id} /><p className="hint">Deletes the deal and its payment plan. Money entries stay but are unlinked. Use “Cancelled” instead if the booking was cancelled.</p><button className="btn sm danger">Yes, delete</button></form>
          </details>
        </div>
      </div>
    </>
  );
}
