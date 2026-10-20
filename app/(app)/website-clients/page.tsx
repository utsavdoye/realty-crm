import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOrg } from '@/lib/context';
import { isManager, fmtPhone } from '@/lib/roles';
import { rel } from '@/lib/crm';
import { LiveRefresh } from '@/components/LiveRefresh';

export const metadata = { title: 'Website clients' };

type Client = { id: string; name: string | null; email: string | null; phone: string | null; contact_phone?: string | null; lead_id?: string | null; created_at: string; last_seen_at: string };

export default async function WebsiteClients() {
  const { supabase, org, role } = await requireOrg();
  if (!isManager(role)) redirect('/leads');
  const first = await supabase.from('website_clients').select('id, name, email, phone, contact_phone, lead_id, created_at, last_seen_at').eq('org_id', org.id).order('created_at', { ascending: false }).limit(2000);
  // before patch-029 the two new columns do not exist yet
  const rows = first.error ? (await supabase.from('website_clients').select('id, name, email, phone, created_at, last_seen_at').eq('org_id', org.id).order('created_at', { ascending: false }).limit(2000)).data : first.data;
  const clients = (rows ?? []) as Client[];
  const [{ data: saves }, { data: projects }] = await Promise.all([
    supabase.from('website_saves').select('client_id, project_id, created_at').eq('org_id', org.id).not('client_id', 'is', null).order('created_at', { ascending: false }).limit(20000),
    supabase.from('projects').select('id, name').eq('org_id', org.id),
  ]);
  const pname = new Map((projects ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
  const savedBy = new Map<string, string[]>();
  (saves ?? []).forEach((s: { client_id: string; project_id: string }) => { const l = savedBy.get(s.client_id) ?? []; const n = pname.get(s.project_id); if (n) l.push(n); savedBy.set(s.client_id, l); });
  const withLead = clients.filter((c) => c.lead_id).length;

  return (
    <>
      <LiveRefresh tables={['website_clients', 'website_saves']} orgId={org.id} />
      <div className="top"><h1>Website clients</h1><span className="hint">{clients.length} signed up · {withLead} in your leads</span></div>
      <p className="hint" style={{ marginTop: -6 }}>Everyone who made an account on your website. New sign-ups and saved homes show here on their own. A client with a mobile number is added to Leads automatically.</p>
      <section className="panel">
        {clients.length ? (
          <div className="rows">
            {clients.map((c) => {
              const phone = c.phone || c.contact_phone;
              const homes = savedBy.get(c.id) ?? [];
              return (
                <div key={c.id} className="callrow" style={{ alignItems: 'flex-start' }}>
                  <span className="cr-main">
                    <b>{c.name || c.email?.split('@')[0] || 'No name'}</b>
                    <span className="hint">{[phone ? fmtPhone(phone) + (c.phone ? ' ✓' : '') : 'No mobile yet', c.email].filter(Boolean).join(' · ')}</span>
                    <span className="hint">Joined {rel(c.created_at)} · last on the website {rel(c.last_seen_at)}</span>
                    {homes.length > 0 && <span className="hint">Saved: {homes.join(', ')}</span>}
                  </span>
                  {c.lead_id ? <Link className="btn sm" href={`/leads/${c.lead_id}`}>Open lead</Link> : <span className="chip">Not a lead yet</span>}
                </div>
              );
            })}
          </div>
        ) : <p className="empty">No one has made an account on your website yet.</p>}
      </section>
      <p className="hint">✓ = mobile checked by SMS. &ldquo;Not a lead yet&rdquo; = signed in with email or Google and has not given a mobile number; the website asks them for it.</p>
    </>
  );
}
