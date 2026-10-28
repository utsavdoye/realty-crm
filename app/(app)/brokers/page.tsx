import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { fmtPhone } from '@/lib/roles';
import { inrShort } from '@/lib/money';
import { saveBroker, setBrokerActive } from '@/app/broker-actions';
import { ActionForm, Submit } from '@/components/forms';

export const metadata = { title: 'Brokers' };

type B = { id: string; name: string; firm: string | null; phone: string | null; rera_no: string | null; default_pct: number | null; notes: string | null; active: boolean };

function Fields({ b }: { b?: B }) {
  return (
    <div className="grid2f">
      {b && <input type="hidden" name="id" value={b.id} />}
      <label className="field"><span className="label">Name *</span><input name="name" required maxLength={120} defaultValue={b?.name ?? ''} /></label>
      <label className="field"><span className="label">Firm</span><input name="firm" maxLength={120} defaultValue={b?.firm ?? ''} placeholder="e.g. ABC Realty" /></label>
      <label className="field"><span className="label">Mobile</span><input name="phone" inputMode="tel" defaultValue={b?.phone ?? ''} /></label>
      <label className="field"><span className="label">RERA agent no.</span><input name="rera_no" maxLength={60} defaultValue={b?.rera_no ?? ''} /></label>
      <label className="field"><span className="label">Usual commission %</span><input name="default_pct" type="number" step="0.01" min="0" max="100" defaultValue={b?.default_pct ?? ''} placeholder="e.g. 1" /></label>
      <label className="field"><span className="label">Note</span><input name="notes" maxLength={1000} defaultValue={b?.notes ?? ''} /></label>
    </div>
  );
}

export default async function Brokers() {
  const { supabase, org, role } = await requireOrg(['owner', 'manager']);
  const admin = role === 'owner';
  const [{ data: list, error }, { data: leads }, { data: visits }, { data: deals }] = await Promise.all([
    supabase.from('brokers').select('id, name, firm, phone, rera_no, default_pct, notes, active').eq('org_id', org.id).order('active', { ascending: false }).order('name'),
    supabase.from('leads').select('broker_id, stage').eq('org_id', org.id).not('broker_id', 'is', null).limit(5000),
    supabase.from('visits').select('broker_id, status').eq('org_id', org.id).not('broker_id', 'is', null).limit(5000),
    admin ? supabase.from('deals').select('broker_id, broker_amount, broker_paid, agreement_value, status').eq('org_id', org.id).not('broker_id', 'is', null).eq('status', 'active') : Promise.resolve({ data: [] }),
  ]);
  const notRun = !!error && /brokers/.test(error.message);
  const stat = (id: string) => {
    const ls = (leads ?? []).filter((l) => l.broker_id === id), vs = (visits ?? []).filter((v) => v.broker_id === id);
    const ds = ((deals ?? []) as { broker_id: string; broker_amount: number; broker_paid: number; agreement_value: number }[]).filter((d) => d.broker_id === id);
    const owed = ds.reduce((a, d) => a + Number(d.broker_amount), 0), paid = ds.reduce((a, d) => a + Number(d.broker_paid), 0);
    return { leads: ls.length, visits: vs.length, visitsDone: vs.filter((v) => v.status === 'done').length, deals: ds.length, sales: ds.reduce((a, d) => a + Number(d.agreement_value), 0), owed, paid };
  };
  const brokers = (list ?? []) as B[];
  const totalOut = admin ? brokers.reduce((a, b) => { const s = stat(b.id); return a + Math.max(0, s.owed - s.paid); }, 0) : 0;

  return (
    <>
      <div className="top">
        <div className="top-title"><h1>Brokers</h1><span className="muted">Channel partners who bring clients: their leads, site visits, bookings and commission.</span></div>
      </div>
      {notRun && <p className="msg err" style={{ marginBottom: 16 }}>Run <b>supabase/patch-044-brokers-booking.sql</b> in Supabase → SQL Editor first.</p>}
      {admin && totalOut > 0 && <div className="banner">Commission still to pay brokers: <b>{inrShort(totalOut)}</b></div>}

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-h"><h2>Add a broker</h2></div>
        <div className="panel-b"><ActionForm action={saveBroker} className="stack" resetOnOk><Fields /><div><Submit>Add broker</Submit></div></ActionForm></div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>All brokers</h2><span className="hint">{brokers.filter((b) => b.active).length} active</span></div>
        {!brokers.length ? <p className="empty">No brokers yet.</p> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Broker</th><th className="n">Leads</th><th className="n">Site visits</th><th className="n">Bookings</th>{admin && <th className="n">Commission</th>}{admin && <th className="n">Outstanding</th>}<th></th></tr></thead>
            <tbody>{brokers.map((b) => {
              const s = stat(b.id);
              return (
                <tr key={b.id} className={b.active ? '' : 'muted'}>
                  <td><b>{b.name}</b>{b.firm && <span className="hint"> · {b.firm}</span>}<div className="hint">{[b.phone ? fmtPhone(b.phone) : '', b.rera_no ? `RERA ${b.rera_no}` : '', b.default_pct != null ? `${b.default_pct}%` : ''].filter(Boolean).join(' · ')}</div></td>
                  <td className="n">{s.leads ? <Link href={`/leads?broker=${b.id}`}>{s.leads}</Link> : 0}</td>
                  <td className="n">{s.visits}{s.visitsDone ? <span className="hint"> ({s.visitsDone} done)</span> : null}</td>
                  <td className="n">{s.deals}{s.sales ? <div className="hint">{inrShort(s.sales)}</div> : null}</td>
                  {admin && <td className="n">{inrShort(s.owed)}</td>}
                  {admin && <td className="n">{s.owed - s.paid > 0 ? <span className="chip bad">{inrShort(s.owed - s.paid)}</span> : s.owed ? <span className="chip good">Settled</span> : '—'}</td>}
                  <td className="nowrap">
                    <details><summary className="btn sm">Edit</summary><ActionForm action={saveBroker} className="stack inline-box"><Fields b={b} /><div><Submit className="btn sm primary">Save</Submit></div></ActionForm></details>
                    <form action={async () => { 'use server'; await setBrokerActive(b.id, !b.active); }}><button className="btn sm ghost">{b.active ? 'Mark inactive' : 'Make active'}</button></form>
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
