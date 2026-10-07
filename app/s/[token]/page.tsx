import type { Metadata } from 'next';
import { createAnonClient } from '@/lib/supabase/admin';
import type { PubProject } from '@/components/public/ProjectBlock';
import { ProjectTeaser } from '@/components/public/ProjectTeaser';
import { toTeaser } from '@/components/public/teaser';
import { PublicMap, ReactButtons, SeenPing } from '@/components/public/PublicBits';
import { fmtPhone, telHref } from '@/lib/roles';
import { waLink } from '@/lib/crm';

export const dynamic = 'force-dynamic';
type Data = { client: string; note: string | null; reactions: Record<string, string>; agent_name: string | null; agent_phone: string | null; company: string; projects: PubProject[] };

async function load(token: string) {
  if (!/^[a-f0-9]{24,64}$/.test(token)) return null;
  const { data } = await createAnonClient().rpc('get_shortlist', { p_token: token });
  return (data as Data | null) ?? null;
}

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const d = await load(params.token);
  return { title: d ? `Homes picked for ${d.client}` : 'Link not active', robots: { index: false }, description: d ? `${d.projects.length} homes from ${d.company}` : undefined };
}

export default async function Shortlist({ params }: { params: { token: string } }) {
  const d = await load(params.token);
  if (!d) return <main className="pub"><div className="pub-wrap"><h1>This link is not active</h1><p className="muted">Please ask your property advisor for a new link.</p></div></main>;
  const pins = d.projects.filter((p) => p.lat != null && p.lng != null).map((p) => ({ id: p.id, name: p.name, lat: p.lat!, lng: p.lng!, status: p.status, photo: p.photos?.[0] ?? null }));
  return (
    <main className={`pub ${d.agent_phone ? 'has-cta' : ''}`}>
      <SeenPing token={params.token} />
      <header className="pub-head"><div className="pub-wrap row-gap"><b className="pub-brand">{d.company}</b>
        {d.agent_phone && <><a className="btn sm" href={telHref(d.agent_phone)}>Call {d.agent_name?.split(' ')[0]}</a><a className="btn sm wa" href={waLink(d.agent_phone)} target="_blank" rel="noopener noreferrer">WhatsApp</a></>}
      </div></header>
      <div className="pub-wrap stack">
        <section className="pub-intro">
          <h1>Hi {d.client}, homes picked for you</h1>
          <p className="muted">{d.projects.length} option{d.projects.length === 1 ? '' : 's'} from {d.agent_name ?? 'our team'}{d.agent_phone ? ` (${fmtPhone(d.agent_phone)})` : ''}. Tap “Show me the full details” to see prices and all photos, or book a site visit.</p>
          {d.note && <blockquote className="pub-note">{d.note}</blockquote>}
        </section>
        {pins.length > 1 && <section className="pub-card"><div className="pub-body"><h2>On the map</h2><PublicMap projects={pins} height={300} /></div></section>}
        {d.projects.map((p) => (
          <ProjectTeaser key={p.id} p={toTeaser(p)} mode="shortlist" token={params.token} advisor={d.agent_name}><ReactButtons token={params.token} projectId={p.id} initial={d.reactions?.[p.id]} /></ProjectTeaser>
        ))}
      </div>
      <footer className="pub-foot pub-wrap hint">{d.company} · Prices and details can change. Please confirm with your advisor.</footer>
      {d.agent_phone && (
        <nav className="cta-bar" aria-label="Contact your advisor">
          <a className="btn" href={telHref(d.agent_phone)}>📞 Call {d.agent_name?.split(' ')[0]}</a>
          <a className="btn wa" href={waLink(d.agent_phone, `Hi ${d.agent_name?.split(' ')[0] ?? ''}, I saw the homes you sent. Can we talk?`)} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        </nav>
      )}
    </main>
  );
}
