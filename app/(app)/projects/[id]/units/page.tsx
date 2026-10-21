import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/context';
import { isManager } from '@/lib/roles';
import { fmtL } from '@/lib/crm';
import { setUnitStatus } from '@/app/crm-actions';
import { AutoFilterForm } from '@/components/AutoFilterForm';
import { UnitImport } from '@/components/UnitImport';
import { InventoryLink, SyncButton } from '@/components/InventorySheet';
import { showRateCard } from '@/lib/units';

export const metadata = { title: 'Inventory' };

type U = { id: string; tower: string; floor: number | null; unit_no: string; bhk: string | null; sba: number | null; carpet: number | null; rate: number | null; status: string; note: string | null };
const LABEL: Record<string, string> = { open: 'Open', hold: 'On hold', booked: 'Booked', mortgage: 'Mortgage' };
const CHIP: Record<string, string> = { open: 'good', hold: 'tape', booked: 'bad', mortgage: '' };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function Units({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const { supabase, org, role } = await requireOrg(['owner', 'manager', 'agent']);
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const mgr = isManager(role);
  const [{ data: p }, { data: units }] = await Promise.all([
    supabase.from('projects').select('*').eq('id', params.id).eq('org_id', org.id).maybeSingle(),
    supabase.from('project_units').select('id, tower, floor, unit_no, bhk, sba, carpet, rate, status, note').eq('project_id', params.id).order('tower').order('floor').order('unit_no'),
  ]);
  if (!p) notFound();
  const all = (units ?? []) as U[];
  const f = { tower: one(searchParams.tower), bhk: one(searchParams.bhk), status: one(searchParams.status) || 'open' };
  const list = all.filter((u) => (!f.tower || u.tower === f.tower) && (!f.bhk || u.bhk === f.bhk) && (f.status === 'all' || u.status === f.status));
  const towers = [...new Set(all.map((u) => u.tower))];
  const bhks = [...new Set(all.map((u) => u.bhk).filter(Boolean))] as string[];
  const price = (u: U) => (u.sba && u.rate ? (u.sba * u.rate) / 100000 : null);
  const count = (st: string) => all.filter((u) => u.status === st).length;

  return (
    <>
      <div className="top">
        <div><h1>{p.name} · Inventory</h1><p className="hint">{p.location}{p.map_url ? <> · <a href={p.map_url} target="_blank" rel="noopener noreferrer">Google Maps</a></> : null}</p></div>
        <Link href="/projects" className="btn sm ghost">← Projects</Link>
      </div>
      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-h"><h2>Inventory sheet</h2>{p.inventory_url && <SyncButton projectId={p.id} syncedAt={p.inventory_synced_at} error={p.inventory_sync_error} compact />}</div>
        <div className="panel-b stack">
          {p.inventory_url
            ? <p className="hint">This list is copied from the sheet. Change flats in the sheet (anyone with the link can), then press Sync now or just open the CRM. Changes made here are replaced at the next sync.</p>
            : <p className="hint">Paste the Google Sheets link of this project&apos;s inventory. The CRM keeps the flat list the same as the sheet.</p>}
          <InventoryLink projectId={p.id} link={p.inventory_url ?? ''} canEdit={mgr} />
        </div>
      </section>
      {mgr && (
        <details className="panel" open={!all.length && !p.inventory_url} style={{ marginBottom: 12 }}>
          <summary className="panel-h" style={{ cursor: 'pointer' }}><h2>Upload an Excel file once</h2><span className="hint">Admins and managers</span></summary>
          <div className="panel-b"><UnitImport projectId={p.id} hasUnits={all.length > 0} rateCard={showRateCard((p.rate_card ?? []) as { floors: string; rate: number }[])} /></div>
        </details>
      )}
      <div className="kpis" style={{ marginBottom: 12 }}>
        {(['open', 'hold', 'booked', 'mortgage'] as const).map((st) => <div key={st} className="kpi"><span className="label">{LABEL[st]}</span><span className="n">{count(st)}</span></div>)}
      </div>
      <AutoFilterForm className="filters" action={`/projects/${p.id}/units`}>
        <select name="status" defaultValue={f.status} aria-label="Status"><option value="open">Open only</option><option value="all">All flats</option><option value="hold">On hold</option><option value="booked">Booked</option><option value="mortgage">Mortgage</option></select>
        <select name="tower" defaultValue={f.tower} aria-label="Tower"><option value="">All towers</option>{towers.map((t) => <option key={t} value={t}>Tower {t}</option>)}</select>
        <select name="bhk" defaultValue={f.bhk} aria-label="Home type"><option value="">All types</option>{bhks.map((b) => <option key={b}>{b}</option>)}</select>
        <span className="hint" style={{ marginLeft: 'auto' }}>{list.length} flat{list.length === 1 ? '' : 's'}</span>
      </AutoFilterForm>
      <section className="panel">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Flat</th><th>Floor</th><th>Type</th><th>Super area</th><th>Carpet</th><th>Rate / sq ft</th><th>Basic price</th><th>Status</th></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td className="mono"><b>{u.unit_no}</b></td>
                  <td>{u.floor ?? '—'}</td>
                  <td>{u.bhk ?? '—'}</td>
                  <td className="mono">{u.sba ? `${Math.round(u.sba).toLocaleString('en-IN')} sq ft` : '—'}</td>
                  <td className="mono">{u.carpet ? `${Math.round(u.carpet).toLocaleString('en-IN')} sq ft` : '—'}</td>
                  <td className="mono">{u.rate ? `₹${Number(u.rate).toLocaleString('en-IN')}` : '—'}</td>
                  <td className="mono"><b>{price(u) ? fmtL(Math.round(price(u)! * 10) / 10) : 'On request'}</b></td>
                  <td>
                    {mgr ? (
                      <form action={setUnitStatus} className="row-gap">
                        <input type="hidden" name="id" value={u.id} />
                        <select name="status" defaultValue={u.status} aria-label={`Status of ${u.unit_no}`}>{Object.entries(LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                        <button className="btn sm">Save</button>
                      </form>
                    ) : <span className={`chip ${CHIP[u.status]}`}>{LABEL[u.status]}</span>}
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={8} className="empty">No flats match.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ padding: '10px 16px' }}>Basic price = super built-up area × floor rate. GST, registry and other charges are extra (see terms below). Starting price on the project updates by itself when a flat is booked.</p>
      </section>
      <div className="grid2f" style={{ marginTop: 14 }}>
        {p.payment_plan && <section className="panel"><div className="panel-h"><h2>Payment plan</h2></div><div className="panel-b"><p style={{ whiteSpace: 'pre-line', margin: 0 }}>{p.payment_plan}</p></div></section>}
        {p.terms && <section className="panel"><div className="panel-h"><h2>Booking terms</h2><span className="hint">For the team</span></div><div className="panel-b"><p style={{ whiteSpace: 'pre-line', margin: 0 }}>{p.terms}</p></div></section>}
      </div>
    </>
  );
}
