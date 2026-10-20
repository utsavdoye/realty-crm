import type { Metadata } from 'next';
import { createAnonClient } from '@/lib/supabase/admin';
import type { PubProject } from '@/components/public/ProjectBlock';
import { ProjectTeaser } from '@/components/public/ProjectTeaser';
import { toTeaser } from '@/components/public/teaser';
import { EnquiryForm, ProjectLocationMap } from '@/components/public/PublicBits';
import { fmtPhone, siteUrl, telHref } from '@/lib/roles';
import { waLink } from '@/lib/crm';

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
  const desc = [d.configs, d.location, d.status].filter(Boolean).join(' · ');
  return {
    title: `${d.name}${d.location ? ' · ' + d.location : ''}`, robots: { index: false }, description: desc,
    openGraph: { title: `${d.name}: see photos and prices`, description: desc, images: img ? [img.startsWith('/') ? siteUrl() + img : img] : [] },
  };
}

export default async function PublicProject({ params }: { params: { token: string } }) {
  const d = await load(params.token);
  if (!d) return <main className="pub"><div className="pub-wrap"><h1>This link is not active</h1><p className="muted">Please ask the person who sent it for a new link.</p></div></main>;
  const { data: buzz } = await createAnonClient().rpc('public_project_buzz', { p_token: params.token });
  const wa = d.contact_phone ? waLink(d.contact_phone, `Hi, I saw ${d.name}${d.location ? ' in ' + d.location : ''}. Please send me the price list and floor plans.`) : '';
  return (
    <main className="pub has-cta">
      <header className="pub-head"><div className="pub-wrap row-gap"><b className="pub-brand">{d.company}</b>{d.contact_phone && <a className="btn sm" href={telHref(d.contact_phone)}>Call {fmtPhone(d.contact_phone)}</a>}</div></header>
      <div className="pub-wrap pub-grid">
        <div className="stack">
          <ProjectTeaser p={toTeaser(d)} mode="project" token={d.token} buzz={Number(buzz ?? 0)} />
          {d.lat != null && d.lng != null && (
            <section className="pub-card"><div className="pub-body"><h2>Location</h2><ProjectLocationMap project={{ id: d.id, name: d.name, lat: d.lat, lng: d.lng, status: d.status, photo: d.photos?.[0] ?? null }} /></div></section>
          )}
        </div>
        <aside className="pub-card pub-side" id="visit"><div className="pub-body">
          <h2>Book a free site visit</h2>
          <p className="muted">See the actual homes, the view and the area. We arrange everything and call you to confirm.</p>
          <EnquiryForm token={d.token} project={d.name} defaultVisit />
        </div></aside>
      </div>
      <footer className="pub-foot pub-wrap hint">{d.company}{d.company_rera ? ` · RERA ${d.company_rera}` : ''} · Prices and details can change. Please confirm with our team.</footer>
      <nav className="cta-bar" aria-label="Contact">
        {d.contact_phone && <a className="btn" href={telHref(d.contact_phone)}>Call</a>}
        {wa && <a className="btn wa" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
        <a className="btn primary" href="#visit">Book visit</a>
      </nav>
    </main>
  );
}
