import type { Metadata } from 'next';
import { createAnonClient } from '@/lib/supabase/admin';
import { ProjectBlock, type PubProject } from '@/components/public/ProjectBlock';
import { EnquiryForm, PublicMap } from '@/components/public/PublicBits';
import { fmtPhone, siteUrl } from '@/lib/roles';

export const dynamic = 'force-dynamic';
type Data = PubProject & { company: string; company_rera: string | null; contact_name: string | null; contact_phone: string | null };

async function load(token: string) {
  if (!/^[a-f0-9]{24,64}$/.test(token)) return null;
  const { data } = await createAnonClient().rpc('get_public_project', { p_token: token });
  return (data as Data | null) ?? null;
}

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const d = await load(params.token);
  if (!d) return { title: 'Link not active', robots: { index: false } };
  const img = d.photos?.[0];
  return {
    title: `${d.name}${d.location ? ' · ' + d.location : ''}`, robots: { index: false },
    description: [d.configs, d.status, d.company].filter(Boolean).join(' · '),
    openGraph: { title: d.name, description: [d.configs, d.location].filter(Boolean).join(' · '), images: img ? [img.startsWith('/') ? siteUrl() + img : img] : [] },
  };
}

export default async function PublicProject({ params }: { params: { token: string } }) {
  const d = await load(params.token);
  if (!d) return <main className="pub"><div className="pub-wrap"><h1>This link is not active</h1><p className="muted">Please ask the person who sent it for a new link.</p></div></main>;
  return (
    <main className="pub">
      <header className="pub-head"><div className="pub-wrap row-gap"><b className="pub-brand">{d.company}</b>{d.contact_phone && <a className="btn sm" href={`tel:+91${d.contact_phone}`}>Call {fmtPhone(d.contact_phone)}</a>}</div></header>
      <div className="pub-wrap pub-grid">
        <div className="stack">
          <ProjectBlock p={d} />
          {d.lat != null && d.lng != null && (
            <section className="pub-card"><div className="pub-body"><h2>Location</h2><PublicMap projects={[{ id: d.id, name: d.name, lat: d.lat, lng: d.lng, status: d.status }]} /></div></section>
          )}
        </div>
        <aside className="pub-card pub-side"><div className="pub-body"><h2>Interested?</h2><p className="muted">Leave your number and we will call you, or book a site visit.</p><EnquiryForm token={d.token} project={d.name} /></div></aside>
      </div>
      <footer className="pub-foot pub-wrap hint">{d.company}{d.company_rera ? ` · RERA ${d.company_rera}` : ''} · Prices and details can change. Please confirm with our team.</footer>
    </main>
  );
}
