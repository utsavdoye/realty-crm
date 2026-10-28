import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { fmtPhone } from '@/lib/roles';
import { LOST_REASONS, fmtDay } from '@/lib/crm';
import { recycleCall } from '@/app/crm-actions';

export const metadata = { title: 'Lost leads' };

const PERIODS = [['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last year'], ['all', 'All time']] as const;
type L = { id: string; name: string; phone: string; lost_reason: string | null; source: string | null; assigned_to: string | null; updated_at: string; recycle_step: number | null };

export default async function Lost({ searchParams }: { searchParams: { r?: string; p?: string; a?: string } }) {
  const { supabase, org } = await requireOrg(['owner', 'manager']);
  const p = PERIODS.some(([k]) => k === searchParams.p) ? searchParams.p! : '90';
  const since = p === 'all' ? null : new Date(Date.now() - Number(p) * 86400000).toISOString();
  const reason = searchParams.r ?? '';
  const agent = searchParams.a ?? '';

  let q = supabase.from('leads').select('id, name, phone, lost_reason, source, assigned_to, updated_at, recycle_step').eq('org_id', org.id).eq('stage', 'lost').order('updated_at', { ascending: false }).limit(2000);
  if (since) q = q.gte('updated_at', since);
  if (agent) q = q.eq('assigned_to', agent);
  const [{ data }, { data: people }] = await Promise.all([q, supabase.from('members').select('user_id, full_name').eq('org_id', org.id).order('full_name')]);
  const all = (data ?? []) as L[];
  const nameOf = new Map((people ?? []).map((m) => [m.user_id, m.full_name]));

  const counts = new Map<string, number>();
  all.forEach((l) => counts.set(l.lost_reason || 'No reason', (counts.get(l.lost_reason || 'No reason') ?? 0) + 1));
  const reasons = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...reasons.map(([, n]) => n));
  const list = reason ? all.filter((l) => (l.lost_reason || 'No reason') === reason) : all;
  const href = (o: Record<string, string>) => {
    const s = new URLSearchParams({ p, ...(reason ? { r: reason } : {}), ...(agent ? { a: agent } : {}), ...o });
    [...s.entries()].forEach(([k, v]) => { if (!v) s.delete(k); });
    return `/lost?${s}`;
  };
  const noRetry = new Set(['Wrong number', 'Bought elsewhere']);

  return (
    <>
      <div className="top">
        <div className="top-title"><h1>Lost leads</h1><span className="muted">Why clients said no, and a quick way to try again.</span></div>
        <form action="/lost" className="row-btns">
          <select name="p" defaultValue={p} aria-label="Period">{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select name="a" defaultValue={agent} aria-label="Agent"><option value="">Everyone</option>{(people ?? []).map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select>
          {reason && <input type="hidden" name="r" value={reason} />}
          <button className="btn sm">Show</button>
        </form>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-h"><h2>Why we lost them</h2><span className="hint">{all.length} lost · tap a reason to see those leads</span></div>
        <div className="panel-b">
          {!reasons.length ? <p className="empty">No lost leads in this period.</p> : (
            <div className="lost-bars">
              {reasons.map(([r, n]) => (
                <Link key={r} href={href({ r: reason === r ? '' : r })} className={`lost-bar ${reason === r ? 'on' : ''}`}>
                  <span className="lb-l">{r}</span>
                  <span className="lb-track"><span style={{ width: `${(n / max) * 100}%` }} /></span>
                  <b>{n}</b><span className="hint">{Math.round((n / all.length) * 100)}%</span>
                </Link>
              ))}
            </div>
          )}
          {reasons.some(([r]) => !LOST_REASONS.includes(r)) && <p className="hint" style={{ marginTop: 8 }}>“No reason” means the agent did not pick one. Ask them to always pick a reason.</p>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>{reason || 'All lost leads'}</h2>{reason && <Link href={href({ r: '' })} className="btn sm ghost">Show all</Link>}</div>
        {!list.length ? <p className="empty">Nothing here.</p> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Client</th><th>Reason</th><th>Source</th><th>Agent</th><th>Lost on</th><th></th></tr></thead>
            <tbody>{list.slice(0, 300).map((l) => (
              <tr key={l.id}>
                <td><Link href={`/leads/${l.id}`}><b>{l.name}</b></Link><div className="hint">{fmtPhone(l.phone)}</div></td>
                <td>{l.lost_reason || <span className="hint">No reason</span>}</td>
                <td>{l.source ?? '—'}</td>
                <td>{l.assigned_to ? nameOf.get(l.assigned_to) ?? '—' : '—'}</td>
                <td className="nowrap">{fmtDay(l.updated_at)}</td>
                <td className="nowrap">
                  {noRetry.has(l.lost_reason ?? '') ? <span className="hint">Don&apos;t retry</span> : (
                    <form action={recycleCall}><input type="hidden" name="id" value={l.id} /><button className="btn sm">Reopen</button></form>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {list.length > 300 && <p className="hint" style={{ padding: 12 }}>Showing the latest 300. Pick a reason or agent to narrow it.</p>}
      </section>
    </>
  );
}
