import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOrg } from '@/lib/context';
import { isManager, fmtPhone } from '@/lib/roles';
import { rel } from '@/lib/crm';
import { LiveRefresh } from '@/components/LiveRefresh';
import { setTestimonialStatus } from '@/app/crm-actions';

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
  // Testimonials (patch-032): empty before it is run
  const { data: tRows } = await supabase.from('testimonials').select('id, name, place, rating, body, status, submitted_at, lead_id, projects(name)').eq('org_id', org.id).neq('status', 'asked').order('submitted_at', { ascending: false }).limit(200);
  const testimonials = (tRows ?? []) as unknown as { id: string; name: string | null; place: string | null; rating: number; body: string; status: string; submitted_at: string; lead_id: string | null; projects: { name: string } | null }[];

  return (
    <>
      <LiveRefresh tables={['website_clients', 'website_saves', 'testimonials']} orgId={org.id} />
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
      <section className="panel" id="testimonials" style={{ marginTop: 16 }}>
        <div className="panel-h"><h2>Testimonials</h2><span className="hint">Real clients' reviews show on your website by themselves. Reviews from unknown numbers wait here for you. You can hide any review.</span></div>
        {testimonials.length ? (
          <div className="rows">
            {testimonials.map((t) => (
              <div key={t.id} className="callrow" style={{ alignItems: 'flex-start' }}>
                <span className="cr-main">
                  <b>{t.name || 'Client'}{t.place ? <span className="hint"> · {t.place}</span> : null}</b>
                  <span className="hint">{'★'.repeat(t.rating)}{'☆'.repeat(5 - t.rating)}{t.projects?.name ? ` · ${t.projects.name}` : ''} · {rel(t.submitted_at)}</span>
                  <span>{t.body}</span>
                </span>
                <span className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
                  <span className={`chip ${t.status === 'approved' ? 'good' : t.status === 'hidden' ? '' : 'acc'}`}>{t.status === 'approved' ? 'On website' : t.status === 'hidden' ? 'Hidden' : 'Waiting'}</span>
                  <form action={setTestimonialStatus} className="row-gap">
                    <input type="hidden" name="id" value={t.id} />
                    {t.status !== 'approved' && <button className="btn sm primary" name="status" value="approved">Show on website</button>}
                    {t.status !== 'hidden' && <button className="btn sm ghost" name="status" value="hidden">Hide</button>}
                  </form>
                  {t.lead_id && <Link className="hint" href={`/leads/${t.lead_id}`}>Open lead</Link>}
                </span>
              </div>
            ))}
          </div>
        ) : <p className="empty">No testimonials yet.</p>}
      </section>
      <p className="hint">✓ = mobile checked by SMS. &ldquo;Not a lead yet&rdquo; = signed in with email or Google and has not given a mobile number; the website asks them for it.</p>
    </>
  );
}
