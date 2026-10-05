import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { addEntry, deleteEntry } from '@/app/money-actions';
import { ActionForm, Submit } from '@/components/forms';
import { IN_CATEGORIES, MODES, OUT_CATEGORIES, PERIODS, inr, inrShort, periodStart, todayIST } from '@/lib/money';
import { SOURCES, fmtDate } from '@/lib/crm';

export const metadata = { title: 'Money' };

type Deal = { id: string; lead_id: string | null; project_id: string | null; buyer_name: string; unit_no: string | null; booked_on: string; agreement_value: number; commission_amount: number; agent_id: string | null; incentive_amount: number; status: string };
type Inst = { id: string; deal_id: string; label: string; amount: number; due_on: string | null; paid_amount: number };
type Entry = { id: string; entry_date: string; direction: 'in' | 'out'; category: string; amount: number; deal_id: string | null; person_id: string | null; lead_source: string | null; mode: string | null; note: string | null };

const TABS = [['overview', 'Overview'], ['deals', 'Deals & buyer payments'], ['entries', 'Money in / out'], ['team', 'Salaries & incentives']] as const;

export default async function Money({ searchParams: sp }: { searchParams: { tab?: string; period?: string; cat?: string } }) {
  const { supabase, org } = await requireOrg(['owner']);
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'overview';
  const period = PERIODS.some(([k]) => k === sp.period) ? sp.period! : '6m';
  const from = periodStart(period);
  const today = todayIST();

  let eq = supabase.from('money_entries').select('id, entry_date, direction, category, amount, deal_id, person_id, lead_source, mode, note').eq('org_id', org.id).order('entry_date', { ascending: false }).limit(5000);
  if (from) eq = eq.gte('entry_date', from);
  let lq = supabase.from('leads').select('source, stage').eq('org_id', org.id).limit(20000);
  if (from) lq = lq.gte('created_at', from);
  const [{ data: dealsRaw }, { data: instRaw }, { data: entriesRaw }, { data: allCom }, { data: people }, { data: projects }, { data: leadsRaw }, { data: bookedLeads }] = await Promise.all([
    supabase.from('deals').select('id, lead_id, project_id, buyer_name, unit_no, booked_on, agreement_value, commission_amount, agent_id, incentive_amount, status').eq('org_id', org.id).order('booked_on', { ascending: false }),
    supabase.from('deal_installments').select('id, deal_id, label, amount, due_on, paid_amount').eq('org_id', org.id),
    eq,
    supabase.from('money_entries').select('deal_id, category, amount, person_id').eq('org_id', org.id).in('category', ['Commission', 'Incentive']).not('deal_id', 'is', null),
    supabase.from('members').select('user_id, full_name, role, active').eq('org_id', org.id),
    supabase.from('projects').select('id, name').eq('org_id', org.id),
    lq,
    supabase.from('leads').select('id, name, booked_at').eq('org_id', org.id).eq('stage', 'booked').order('booked_at', { ascending: false }).limit(500),
  ]);
  const deals = (dealsRaw ?? []) as Deal[];
  const active = deals.filter((d) => d.status === 'active');
  const inst = (instRaw ?? []) as Inst[];
  const entries = (entriesRaw ?? []) as Entry[];
  const nameOf = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const projOf = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + Number(b || 0), 0);

  const comGot = new Map<string, number>(); const incPaid = new Map<string, number>();
  (allCom ?? []).forEach((e) => {
    if (e.category === 'Commission') comGot.set(e.deal_id!, (comGot.get(e.deal_id!) ?? 0) + Number(e.amount));
    else incPaid.set(e.deal_id!, (incPaid.get(e.deal_id!) ?? 0) + Number(e.amount));
  });
  const instBy = new Map<string, Inst[]>();
  inst.forEach((i) => instBy.set(i.deal_id, [...(instBy.get(i.deal_id) ?? []), i]));
  const activeIds = new Set(active.map((d) => d.id));
  const overdue = inst.filter((i) => activeIds.has(i.deal_id) && i.due_on && i.due_on < today && Number(i.paid_amount) < Number(i.amount));

  const moneyIn = sum(entries.filter((e) => e.direction === 'in').map((e) => e.amount));
  const moneyOut = sum(entries.filter((e) => e.direction === 'out').map((e) => e.amount));
  const comPending = sum(active.map((d) => Math.max(0, Number(d.commission_amount) - (comGot.get(d.id) ?? 0))));
  const overdueAmt = sum(overdue.map((i) => Number(i.amount) - Number(i.paid_amount)));
  const dealIdsWithLead = new Set(deals.map((d) => d.lead_id).filter(Boolean));
  const missingDeals = (bookedLeads ?? []).filter((l) => !dealIdsWithLead.has(l.id));

  // monthly in vs out (last 6 months, always)
  const months: { key: string; label: string; in: number; out: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-IN', { month: 'short' }), in: 0, out: 0 });
  }
  const { data: last6 } = await supabase.from('money_entries').select('entry_date, direction, amount').eq('org_id', org.id).gte('entry_date', months[0].key + '-01').limit(5000);
  (last6 ?? []).forEach((e) => { const m = months.find((x) => x.key === e.entry_date.slice(0, 7)); if (m) m[e.direction as 'in' | 'out'] += Number(e.amount); });
  const maxM = Math.max(1, ...months.flatMap((m) => [m.in, m.out]));

  const byCat = new Map<string, number>();
  entries.filter((e) => e.direction === 'out').forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.amount)));
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...catRows.map((r) => r[1]));

  // cost per lead / booking by source
  const adBy = new Map<string, number>();
  entries.filter((e) => e.category === 'Ads').forEach((e) => adBy.set(e.lead_source || 'Other', (adBy.get(e.lead_source || 'Other') ?? 0) + Number(e.amount)));
  const leadsBy = new Map<string, { n: number; booked: number }>();
  (leadsRaw ?? []).forEach((l) => { const k = l.source || 'Other'; const v = leadsBy.get(k) ?? { n: 0, booked: 0 }; v.n++; if (l.stage === 'booked') v.booked++; leadsBy.set(k, v); });
  const adRows = [...adBy.entries()].map(([src, spend]) => ({ src, spend, ...(leadsBy.get(src) ?? { n: 0, booked: 0 }) })).sort((a, b) => b.spend - a.spend);

  const qs = (extra: Record<string, string>) => '/money?' + new URLSearchParams({ tab, period, ...extra }).toString();
  const agents = (people ?? []).filter((p) => p.role !== 'partner');

  return (
    <>
      <div className="top">
        <h1>Money</h1>
        <span className="chip tape">Only admins can see this page</span>
        <div className="seg">{PERIODS.map(([k, l]) => <Link key={k} href={qs({ period: k })} className={period === k ? 'on' : ''}>{l}</Link>)}</div>
      </div>
      <nav className="tabs-line">{TABS.map(([k, l]) => <Link key={k} href={'/money?' + new URLSearchParams({ tab: k, period }).toString()} className={tab === k ? 'on' : ''}>{l}</Link>)}</nav>

      {tab === 'overview' && (
        <>
          <div className="kpis">
            <div className="kpi"><span className="label">Money in</span><span className="n">{inrShort(moneyIn)}</span><span className="hint">Commission + other income</span></div>
            <div className="kpi"><span className="label">Money out</span><span className="n">{inrShort(moneyOut)}</span><span className="hint">All expenses</span></div>
            <div className={`kpi ${moneyIn - moneyOut < 0 ? 'alert' : ''}`}><span className="label">Profit</span><span className="n">{inrShort(moneyIn - moneyOut)}</span><span className="hint">{PERIODS.find(([k]) => k === period)?.[1]}</span></div>
            <Link className="kpi" href={qs({ tab: 'deals' })}><span className="label">Commission still to come</span><span className="n">{inrShort(comPending)}</span><span className="hint">From {active.filter((d) => (comGot.get(d.id) ?? 0) < Number(d.commission_amount)).length} deals</span></Link>
            <Link className={`kpi ${overdue.length ? 'alert' : ''}`} href={qs({ tab: 'deals' })}><span className="label">Buyer payments late</span><span className="n">{inrShort(overdueAmt)}</span><span className="hint">{overdue.length} payment{overdue.length === 1 ? '' : 's'}</span></Link>
          </div>
          <div className="grid-main">
            <div className="stack">
              <section className="panel">
                <div className="panel-h"><h2>In and out, last 6 months</h2><span className="legend"><i className="sw in" />In <i className="sw out" />Out</span></div>
                <div className="panel-b">
                  <div className="mbars" role="img" aria-label="Money in and out per month">
                    {months.map((m) => (
                      <div key={m.key} className="mcol">
                        <div className="mpair">
                          <span className="mbar in" style={{ height: `${(m.in / maxM) * 100}%` }} title={`${m.label}: in ${inr(m.in)}`} />
                          <span className="mbar out" style={{ height: `${(m.out / maxM) * 100}%` }} title={`${m.label}: out ${inr(m.out)}`} />
                        </div>
                        <span className="hint">{m.label}</span>
                      </div>
                    ))}
                  </div>
                  <details><summary className="hint">Show as table</summary>
                    <table className="tbl small"><thead><tr><th>Month</th><th className="n">In</th><th className="n">Out</th><th className="n">Profit</th></tr></thead>
                      <tbody>{months.map((m) => <tr key={m.key}><td>{m.label}</td><td className="n">{inr(m.in)}</td><td className="n">{inr(m.out)}</td><td className="n">{inr(m.in - m.out)}</td></tr>)}</tbody></table>
                  </details>
                </div>
              </section>
              <section className="panel">
                <div className="panel-h"><h2>Ads: what each lead and booking cost</h2><span className="hint">{PERIODS.find(([k]) => k === period)?.[1]}</span></div>
                <div className="table-wrap"><table className="tbl">
                  <thead><tr><th>Source</th><th className="n">Spent</th><th className="n">Leads</th><th className="n">Per lead</th><th className="n">Bookings</th><th className="n">Per booking</th></tr></thead>
                  <tbody>{adRows.length ? adRows.map((r) => (
                    <tr key={r.src}><td>{r.src}</td><td className="n">{inrShort(r.spend)}</td><td className="n">{r.n}</td><td className="n">{r.n ? inr(r.spend / r.n) : '—'}</td><td className="n">{r.booked}</td><td className="n">{r.booked ? inrShort(r.spend / r.booked) : <span className="chip bad">none yet</span>}</td></tr>
                  )) : <tr><td colSpan={6} className="hint">No ad spend in this period. Add it under “Money in / out” with category Ads.</td></tr>}</tbody>
                </table></div>
              </section>
            </div>
            <div className="stack">
              <section className="panel">
                <div className="panel-h"><h2>Where the money went</h2></div>
                <div className="panel-b funnel">
                  {catRows.length ? catRows.map(([k, v]) => (
                    <div key={k} className="fbar"><span>{k}</span><span className="track"><span className="fill" style={{ width: `${(v / maxCat) * 100}%` }} /></span><span className="num mono">{inrShort(v)}</span></div>
                  )) : <p className="hint">No expenses in this period.</p>}
                </div>
              </section>
              {overdue.length > 0 && (
                <section className="panel">
                  <div className="panel-h"><h2>Late buyer payments</h2><span className="chip bad">{overdue.length}</span></div>
                  <div className="rows">{overdue.sort((a, b) => a.due_on!.localeCompare(b.due_on!)).slice(0, 12).map((i) => {
                    const d = deals.find((x) => x.id === i.deal_id)!;
                    return <Link key={i.id} href={`/money/deals/${d.id}`} className="callrow"><span className="cr-main"><b>{d.buyer_name} · {inrShort(Number(i.amount) - Number(i.paid_amount))}</b><span className="hint">{i.label} · was due {fmtDate(i.due_on)}</span></span></Link>;
                  })}</div>
                </section>
              )}
              {missingDeals.length > 0 && (
                <section className="panel">
                  <div className="panel-h"><h2>Bookings with no deal details</h2><span className="chip tape">{missingDeals.length}</span></div>
                  <div className="rows">{missingDeals.slice(0, 10).map((l) => (
                    <Link key={l.id} href={`/money/deals/new?lead=${l.id}`} className="callrow"><span className="cr-main"><b>{l.name}</b><span className="hint">Booked {fmtDate(l.booked_at?.slice(0, 10))} · add value and commission</span></span><span className="btn sm">Add</span></Link>
                  ))}</div>
                </section>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'deals' && (
        <section className="panel">
          <div className="panel-h"><h2>Deals</h2><span className="hint">{active.length} active · {inrShort(sum(active.map((d) => d.agreement_value)))} total value</span><Link className="btn sm primary" href="/money/deals/new">+ Add deal</Link></div>
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Buyer</th><th>Project · unit</th><th>Booked</th><th className="n">Value</th><th className="n">Commission</th><th className="n">Received</th><th className="n">Buyer paid</th><th>Employee</th></tr></thead>
            <tbody>{deals.length ? deals.map((d) => {
              const its = instBy.get(d.id) ?? []; const due = sum(its.map((i) => i.amount)); const paid = sum(its.map((i) => i.paid_amount));
              const late = its.some((i) => i.due_on && i.due_on < today && Number(i.paid_amount) < Number(i.amount));
              const got = comGot.get(d.id) ?? 0;
              return (
                <tr key={d.id} className={d.status === 'cancelled' ? 'muted-row' : ''}>
                  <td><Link href={`/money/deals/${d.id}`}><b>{d.buyer_name}</b></Link>{d.status === 'cancelled' && <span className="chip bad">Cancelled</span>}</td>
                  <td>{[d.project_id ? projOf.get(d.project_id) : null, d.unit_no].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{fmtDate(d.booked_on)}</td>
                  <td className="n">{inrShort(d.agreement_value)}</td>
                  <td className="n">{inrShort(d.commission_amount)}</td>
                  <td className="n">{got >= Number(d.commission_amount) && got > 0 ? <span className="chip good">Full</span> : got > 0 ? inrShort(got) : <span className="chip tape">0</span>}</td>
                  <td className="n">{due ? `${Math.round((paid / due) * 100)}%` : '—'}{late && <span className="chip bad">Late</span>}</td>
                  <td>{d.agent_id ? nameOf.get(d.agent_id) : '—'}</td>
                </tr>
              );
            }) : <tr><td colSpan={8} className="hint">No deals yet. When a lead is booked, add the deal value and commission here.</td></tr>}</tbody>
          </table></div>
        </section>
      )}

      {tab === 'entries' && (
        <div className="grid-main">
          <section className="panel">
            <div className="panel-h"><h2>Money in and out</h2>
              <div className="seg">{[['', 'All'], ['in', 'In'], ['out', 'Out']].map(([k, l]) => <Link key={k} href={qs({ cat: k })} className={(sp.cat ?? '') === k ? 'on' : ''}>{l}</Link>)}</div>
            </div>
            <div className="table-wrap"><table className="tbl">
              <thead><tr><th>Date</th><th>What</th><th>Note</th><th className="n">Amount</th><th></th></tr></thead>
              <tbody>{entries.filter((e) => !sp.cat || e.direction === sp.cat).slice(0, 300).map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{fmtDate(e.entry_date)}</td>
                  <td><span className={`chip ${e.direction === 'in' ? 'good' : ''}`}>{e.category}</span>{e.lead_source ? ` ${e.lead_source}` : ''}{e.person_id ? ` · ${nameOf.get(e.person_id) ?? ''}` : ''}</td>
                  <td className="hint">{e.note}{e.mode ? ` (${e.mode})` : ''}{e.deal_id && <> · <Link href={`/money/deals/${e.deal_id}`}>deal</Link></>}</td>
                  <td className={`n mono ${e.direction === 'in' ? 'in-amt' : ''}`}>{e.direction === 'in' ? '+' : '−'}{inr(e.amount)}</td>
                  <td><form action={deleteEntry}><input type="hidden" name="id" value={e.id} /><button className="btn sm ghost danger" aria-label="Delete entry">✕</button></form></td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Add money in or out</h2></div>
            <div className="panel-b">
              <ActionForm action={addEntry} className="stack">
                <label className="field"><span className="label">What is it for?</span>
                  <select name="category" required defaultValue="">
                    <option value="" disabled>Choose</option>
                    <optgroup label="Money in">{IN_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</optgroup>
                    <optgroup label="Money out">{OUT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</optgroup>
                  </select></label>
                <label className="field"><span className="label">Amount (₹)</span><input name="amount" required placeholder="e.g. 45000 or 1.2 L" /></label>
                <label className="field"><span className="label">Date</span><input type="date" name="entry_date" defaultValue={today} max={today} /></label>
                <label className="field"><span className="label">For ads: which source</span><select name="lead_source" defaultValue=""><option value="">—</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
                <label className="field"><span className="label">Person (salary / incentive)</span><select name="person_id" defaultValue=""><option value="">—</option>{agents.map((a) => <option key={a.user_id} value={a.user_id}>{a.full_name}</option>)}</select></label>
                <label className="field"><span className="label">Linked deal (commission / incentive)</span><select name="deal_id" defaultValue=""><option value="">—</option>{active.map((d) => <option key={d.id} value={d.id}>{d.buyer_name}{d.unit_no ? ' · ' + d.unit_no : ''}</option>)}</select></label>
                <label className="field"><span className="label">Paid by</span><select name="mode" defaultValue="Bank transfer">{MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
                <label className="field"><span className="label">Note</span><input name="note" maxLength={300} placeholder="e.g. October office rent" /></label>
                <div><Submit>Save</Submit></div>
              </ActionForm>
            </div>
          </section>
        </div>
      )}

      {tab === 'team' && (
        <section className="panel">
          <div className="panel-h"><h2>Salaries and incentives</h2><span className="hint">Salary = {PERIODS.find(([k]) => k === period)?.[1]} · incentives = all active deals</span></div>
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Name</th><th className="n">Salary paid</th><th className="n">Bookings</th><th className="n">Incentive earned</th><th className="n">Incentive paid</th><th className="n">Incentive due</th></tr></thead>
            <tbody>{agents.map((p) => {
              const mine = active.filter((d) => d.agent_id === p.user_id);
              const earned = sum(mine.map((d) => d.incentive_amount));
              const paidInc = sum(mine.map((d) => incPaid.get(d.id) ?? 0));
              const salary = sum(entries.filter((e) => e.category === 'Salary' && e.person_id === p.user_id).map((e) => e.amount));
              if (!mine.length && !salary) return null;
              return (
                <tr key={p.user_id}><td>{p.full_name}{!p.active && <span className="chip bad">Left</span>}</td><td className="n">{inr(salary)}</td><td className="n">{mine.length}</td><td className="n">{inr(earned)}</td><td className="n">{inr(paidInc)}</td>
                  <td className="n">{earned - paidInc > 0 ? <span className="chip tape">{inr(earned - paidInc)}</span> : '—'}</td></tr>
              );
            })}</tbody>
          </table></div>
          <p className="hint" style={{ padding: '0 16px 14px' }}>To pay an incentive: Money in / out → category “Incentive”, pick the person and the deal.</p>
        </section>
      )}
    </>
  );
}
