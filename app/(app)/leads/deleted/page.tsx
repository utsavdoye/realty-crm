import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { restoreLead } from '@/app/crm-actions';
import { fmtDT } from '@/lib/crm';
import { fmtPhone } from '@/lib/roles';

export const metadata = { title: 'Deleted leads' };

/** Admin only: every deleted lead, who deleted it, when and why, with a button to bring it back. */
export default async function Deleted({ searchParams }: { searchParams: { err?: string; ok?: string } }) {
  const { supabase, org } = await requireOrg(['owner']);
  const [{ data: rows, error }, { data: people }] = await Promise.all([
    supabase.from('deleted_leads').select('id, lead_id, name, phone, deleted_by, deleted_at, restored_at, data->>reason, data->lead->>source, data->lead->>stage')
      .eq('org_id', org.id).order('deleted_at', { ascending: false }).limit(300),
    supabase.from('members').select('user_id, full_name, role').eq('org_id', org.id),
  ]);
  const who = new Map((people ?? []).map((p) => [p.user_id, p]));
  type Row = { id: string; lead_id: string; name: string | null; phone: string | null; deleted_by: string | null; deleted_at: string; restored_at: string | null; reason: string | null; source: string | null };
  const list = (rows ?? []) as unknown as Row[];
  return (
    <>
      <div className="top"><div className="top-title"><h1>Deleted leads</h1><p className="hint">Only admins see this. A copy of every deleted lead is kept with its history.</p></div><Link className="btn ghost" href="/leads">Back to leads</Link></div>
      {searchParams.err && <div className="banner warn">{searchParams.err}</div>}
      {searchParams.ok && <div className="banner">Brought back. <Link href={`/leads/${searchParams.ok}`}>Open the lead</Link></div>}
      {error && <div className="banner warn">Run supabase/patch-019 in Supabase first.</div>}
      <section className="panel">
        {list.length ? (
          <div className="rows">
            {list.map((r) => {
              const p = r.deleted_by ? who.get(r.deleted_by) : undefined;
              return (
                <div key={r.id} className="callrow">
                  <span className="cr-main">
                    <b>{r.name ?? 'Lead'} <span className="hint mono">{fmtPhone(r.phone ?? '')}</span></b>
                    <span className="hint">Deleted {fmtDT(r.deleted_at)} by {p ? `${p.full_name}${p.role === 'manager' ? ' (manager)' : ''}` : 'someone no longer in the team'}{r.reason ? ` · “${r.reason}”` : ''}{r.source ? ` · ${r.source}` : ''}</span>
                  </span>
                  {r.restored_at ? <span className="chip good">Brought back {fmtDT(r.restored_at)}</span> : (
                    <form action={restoreLead}><input type="hidden" name="id" value={r.id} /><button className="btn sm">Bring back</button></form>
                  )}
                </div>
              );
            })}
          </div>
        ) : <p className="empty">No deleted leads.</p>}
      </section>
    </>
  );
}
