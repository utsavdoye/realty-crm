import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { fmtPhone } from '@/lib/roles';
import { fmtDT, stageLabel } from '@/lib/crm';
import { ignoreDuplicate, mergeLeads } from '@/app/crm-actions';

export const metadata = { title: 'Duplicate clients' };

type L = { id: string; name: string; phone: string; email: string | null; source: string | null; stage: string; created_at: string; assigned_to: string | null; location: string | null };

export default async function Duplicates() {
  const { supabase, org } = await requireOrg(['owner']);
  const { data: pairs, error } = await supabase.rpc('find_duplicates', { p_org: org.id });
  const list = (pairs ?? []) as { a: string; b: string; reason: string }[];
  const ids = [...new Set(list.flatMap((p) => [p.a, p.b]))];
  const [{ data: leads }, { data: people }] = await Promise.all([
    ids.length ? supabase.from('leads').select('id, name, phone, email, source, stage, created_at, assigned_to, location').in('id', ids) : Promise.resolve({ data: [] }),
    supabase.from('members').select('user_id, full_name').eq('org_id', org.id),
  ]);
  const byId = new Map(((leads ?? []) as L[]).map((l) => [l.id, l]));
  const nameOf = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const Card = ({ l }: { l: L }) => (
    <div className="dup-card">
      <Link href={`/leads/${l.id}`}><b>{l.name}</b></Link>
      <span className="mono">{fmtPhone(l.phone)}</span>
      <span className="hint">{[l.email, l.location].filter(Boolean).join(' · ')}</span>
      <span className="hint">{stageLabel(l.stage)} · {l.source ?? 'no source'} · came {fmtDT(l.created_at)}</span>
      <span className="hint">{l.assigned_to ? `With ${nameOf.get(l.assigned_to) ?? '—'}` : 'Not given to anyone'}</span>
    </div>
  );
  return (
    <>
      <div className="top"><h1>Duplicate clients</h1><Link href="/leads" className="btn sm ghost">← Leads</Link></div>
      <p className="hint" style={{ marginTop: -6 }}>Clients that look like the same person (same email, or same full name). Merging keeps one client: all calls, notes, visits and steps move into it, and the other number is saved as a second number.</p>
      <section className="panel">
        {error && <p className="msg err" style={{ margin: 16 }}>Run patch-017 in Supabase to switch this on.</p>}
        {list.map((p) => {
          const a = byId.get(p.a); const b = byId.get(p.b);
          if (!a || !b) return null;
          return (
            <div key={p.a + p.b} className="dup-pair">
              <Card l={a} /><Card l={b} />
              <div className="dup-acts">
                <span className="chip">{p.reason}</span>
                <form action={mergeLeads}><input type="hidden" name="keep" value={a.id} /><input type="hidden" name="drop" value={b.id} /><button className="btn sm primary">Keep left, merge right into it</button></form>
                <form action={mergeLeads}><input type="hidden" name="keep" value={b.id} /><input type="hidden" name="drop" value={a.id} /><button className="btn sm">Keep right</button></form>
                <form action={ignoreDuplicate}><input type="hidden" name="a" value={a.id} /><input type="hidden" name="b" value={b.id} /><button className="btn sm ghost">Not the same person</button></form>
              </div>
            </div>
          );
        })}
        {!error && !list.length && <p className="empty">No duplicates found.</p>}
      </section>
    </>
  );
}
