import { requireOrg } from '@/lib/context';
import { isManager } from '@/lib/roles';
import { deleteProject, saveProject } from '@/app/crm-actions';
import { ActionForm, Submit } from '@/components/forms';
import { PROJECT_STATUS, PTYPES, fmtL } from '@/lib/crm';
import Link from 'next/link';
import { ProjectPhotos } from '@/components/ProjectPhotos';
import { LocationPicker } from '@/components/LocationPicker';
import { ShareButtons } from '@/components/ShareButtons';
import { siteUrl } from '@/lib/roles';
import { rematchProject, toggleProjectPublic } from '@/app/crm-actions';

export const metadata = { title: 'Projects' };

type P = { id: string; name: string; developer: string | null; location: string | null; rera_no: string | null; type: string | null; configs: string | null; price_from: number | null; price_to: number | null; status: string | null; possession: string | null; highlights: string | null; link: string | null; photos: string[] | null; lat: number | null; lng: number | null; is_public: boolean; share_token: string };

function Fields({ p }: { p?: P }) {
  const v = (k: keyof P) => (p?.[k] ?? '') as string;
  return (
    <div className="grid2f">
      {p && <input type="hidden" name="id" value={p.id} />}
      <label className="field"><span className="label">Project name *</span><input name="name" required defaultValue={v('name')} /></label>
      <label className="field"><span className="label">Developer</span><input name="developer" defaultValue={v('developer')} /></label>
      <label className="field"><span className="label">Location</span><input name="location" defaultValue={v('location')} placeholder="e.g. Hennur Road" /></label>
      <label className="field"><span className="label">RERA number</span><input name="rera_no" defaultValue={v('rera_no')} /></label>
      <label className="field"><span className="label">Type</span><select name="type" defaultValue={v('type')}><option value="">—</option>{PTYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="field"><span className="label">Unit options</span><input name="configs" defaultValue={v('configs')} placeholder="e.g. 2, 3 BHK" /></label>
      <label className="field"><span className="label">Price from (₹ lakh)</span><input name="price_from" type="number" min="0" step="0.1" defaultValue={v('price_from')} /></label>
      <label className="field"><span className="label">Price up to (₹ lakh)</span><input name="price_to" type="number" min="0" step="0.1" defaultValue={v('price_to')} /></label>
      <label className="field"><span className="label">Status</span><select name="status" defaultValue={v('status')}><option value="">—</option>{PROJECT_STATUS.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="field"><span className="label">Possession</span><input name="possession" defaultValue={v('possession')} placeholder="e.g. Dec 2027" /></label>
      <label className="field full"><span className="label">Highlights</span><input name="highlights" defaultValue={v('highlights')} placeholder="Clubhouse, 4 km from metro" /></label>
      <label className="field full"><span className="label">Brochure or website link</span><input name="link" defaultValue={v('link')} /></label>
      <LocationPicker lat={p?.lat} lng={p?.lng} area={p?.location} />
    </div>
  );
}

export default async function Projects() {
  const { supabase, org, role } = await requireOrg();
  const mgr = isManager(role);
  const [{ data: projects }, { data: leads }, { data: matches }] = await Promise.all([
    supabase.from('projects').select('*').eq('org_id', org.id).order('name'),
    supabase.from('leads').select('project_id, stage').eq('org_id', org.id).not('project_id', 'is', null).limit(5000),
    supabase.from('project_matches').select('project_id').eq('org_id', org.id).is('dismissed_at', null).limit(20000),
  ]);
  const matchCount = new Map<string, number>();
  (matches ?? []).forEach((m) => matchCount.set(m.project_id, (matchCount.get(m.project_id) ?? 0) + 1));
  const stats = new Map<string, { n: number; booked: number; visited: number }>();
  (leads ?? []).forEach((l) => { const s = stats.get(l.project_id!) ?? { n: 0, booked: 0, visited: 0 }; s.n++; if (l.stage === 'booked') s.booked++; if (['visited', 'negotiation', 'token', 'booked'].includes(l.stage)) s.visited++; stats.set(l.project_id!, s); });
  const list = (projects ?? []) as P[];
  return (
    <>
      <div className="top"><h1>Projects</h1></div>
      <div className="cards">
        {list.map((p) => {
          const s = stats.get(p.id) ?? { n: 0, booked: 0, visited: 0 };
          return (
            <div key={p.id} className="pcard">
              <ProjectPhotos projectId={p.id} orgId={org.id} name={p.name} photos={p.photos ?? []} canEdit={mgr} />
              <div className="row-gap" style={{ justifyContent: 'space-between' }}>{p.status && <span className={`chip ${p.status === 'Ready to move' ? 'good' : p.status === 'Pre-launch' ? 'tape' : 'acc'}`}>{p.status}</span>}</div>
              <h2>{p.name}</h2>
              <div className="hint">{[p.developer, p.location].filter(Boolean).join(' · ')}</div>
              {p.price_from && <div className="price">{fmtL(p.price_from)}{p.price_to ? ` – ${fmtL(p.price_to).replace('₹', '')}` : ''}</div>}
              <div className="hint">{[p.type, p.configs, p.possession ? 'Possession ' + p.possession : ''].filter(Boolean).join(' · ')}</div>
              {p.rera_no && <div className="hint mono">RERA {p.rera_no}</div>}
              {p.highlights && <div className="hint">{p.highlights}</div>}
              {p.link && <a href={/^https?:\/\//.test(p.link) ? p.link : 'https://' + p.link} target="_blank" rel="noopener noreferrer">Brochure / site</a>}
              <div className="stats3"><div><b className="mono">{s.n}</b><span className="hint">Leads</span></div><div><b className="mono">{s.visited}</b><span className="hint">Visited</span></div><div><b className="mono">{s.booked}</b><span className="hint">Booked</span></div></div>
              {(matchCount.get(p.id) ?? 0) > 0 && (
                <Link className="match-chip" href={`/leads?match=${p.id}`}>🔔 {matchCount.get(p.id)} {mgr ? 'leads' : 'of your leads'} wanted something like this →</Link>
              )}
              <div className="share-box">
                {p.is_public ? (
                  <>
                    <span className="hint">Client link is on</span>
                    <ShareButtons url={`${siteUrl()}/p/${p.share_token}`} text={`Have a look at ${p.name}${p.location ? ' in ' + p.location : ''}: photos, price and location`} />
                  </>
                ) : <span className="hint">Client link is off</span>}
                {mgr && (
                  <form action={toggleProjectPublic}>
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="on" value={String(!p.is_public)} />
                    <button className="btn sm ghost">{p.is_public ? 'Turn off' : 'Turn on client link'}</button>
                  </form>
                )}
              </div>
              <div className="row-gap">
                <Link className="btn sm" href={`/leads?project=${p.id}`}>See leads</Link>
                {p.lat != null && <Link className="btn sm ghost" href="/map">On map</Link>}
                {mgr && p.status !== 'Sold out' && <form action={rematchProject}><input type="hidden" name="id" value={p.id} /><button className="btn sm ghost" title="Look again through all leads for people who fit this project">Find matching leads</button></form>}
                {mgr && (
                  <details className="grow">
                    <summary className="btn sm ghost">Edit</summary>
                    <ActionForm action={saveProject} className="stack inline-box"><Fields p={p} /><Submit className="btn sm primary">Save</Submit></ActionForm>
                    <form action={deleteProject} style={{ marginTop: 8 }}><input type="hidden" name="id" value={p.id} /><button className="btn sm ghost danger">Delete project</button></form>
                  </details>
                )}
              </div>
            </div>
          );
        })}
        {!list.length && <div className="panel"><p className="empty">No projects yet.{mgr ? ' Add the projects you sell below, with price range and unit options.' : ''}</p></div>}
      </div>
      {mgr && (
        <section className="panel narrow" style={{ marginTop: 16 }}>
          <div className="panel-h"><h2>Add a project</h2></div>
          <div className="panel-b"><ActionForm action={saveProject} className="stack"><Fields /><div><Submit>Add project</Submit></div></ActionForm></div>
        </section>
      )}
    </>
  );
}
