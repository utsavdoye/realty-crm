import { fetchAll } from '@/lib/fetchAll';
import { requireOrg } from '@/lib/context';
import { isManager } from '@/lib/roles';
import { deleteProject, saveProject } from '@/app/crm-actions';
import { ActionForm, Submit } from '@/components/forms';
import { fmtL } from '@/lib/crm';
import Link from 'next/link';
import { ProjectPhotos } from '@/components/ProjectPhotos';
import { ProjectVideos } from '@/components/ProjectVideos';
import { SyncButton } from '@/components/InventorySheet';
import { ProjectFields, type ProjectRow } from '@/components/ProjectFields';
import { AddProjectForm } from '@/components/AddProjectForm';
import { ProjectPlans } from '@/components/ProjectPlans';
import { ShareButtons } from '@/components/ShareButtons';
import { fmtPhone, siteUrl } from '@/lib/roles';
import { websiteUrl } from '@/lib/website';
import { rematchProject } from '@/app/crm-actions';
import { LiveCounts, LiveCount } from '@/components/LiveCounts';
import { ProjectShare } from '@/components/ProjectShare';

export const metadata = { title: 'Projects' };

type P = ProjectRow;

export default async function Projects({ searchParams }: { searchParams?: { sort?: string } }) {
  const byVotes = searchParams?.sort === 'votes';
  const { supabase, org, role } = await requireOrg();
  const mgr = isManager(role);
  const [{ data: projects }, leads, matches, unitRows] = await Promise.all([
    supabase.from('projects').select('*').eq('org_id', org.id).order('name'),
    fetchAll<{ project_id: string; stage: string }>(() => supabase.from('leads').select('id, project_id, stage').eq('org_id', org.id).not('project_id', 'is', null).order('id')),
    fetchAll<{ project_id: string }>(() => supabase.from('project_matches').select('project_id, lead_id').eq('org_id', org.id).is('dismissed_at', null).order('lead_id').order('project_id')),
    fetchAll<{ project_id: string; status: string }>(() => supabase.from('project_units').select('id, project_id, status').eq('org_id', org.id).order('id')),
  ]);
  const web = await websiteUrl(supabase, org.id);
  const unitsBy = new Map<string, Record<string, number>>();
  unitRows.forEach((u) => { const c = unitsBy.get(u.project_id) ?? {}; c[u.status] = (c[u.status] ?? 0) + 1; unitsBy.set(u.project_id, c); });
  // Website likes (patch-024); empty before it is run
  const { data: voteRows } = await supabase.from('project_votes').select('project_id').limit(50000);
  const votes = new Map<string, number>();
  (voteRows ?? []).forEach((v: { project_id: string }) => votes.set(v.project_id, (votes.get(v.project_id) ?? 0) + 1));
  // Homes saved on the website (patch-027): count, and the signed-in clients who saved them
  const [{ data: saveRows }, { data: webClients }] = await Promise.all([
    supabase.from('website_saves').select('project_id, client_id').eq('org_id', org.id).limit(50000),
    supabase.from('website_clients').select('id, name, email, phone').eq('org_id', org.id).limit(20000),
  ]);
  const clientOf = new Map((webClients ?? []).map((c: { id: string; name: string | null; email: string | null; phone: string | null }) => [c.id, c]));
  const saves = new Map<string, { n: number; who: { id: string; name: string | null; email: string | null; phone: string | null }[] }>();
  (saveRows ?? []).forEach((r: { project_id: string; client_id: string | null }) => {
    const x = saves.get(r.project_id) ?? { n: 0, who: [] }; x.n++;
    const c = r.client_id ? clientOf.get(r.client_id) : undefined; if (c) x.who.push(c);
    saves.set(r.project_id, x);
  });
  const matchCount = new Map<string, number>();
  (matches ?? []).forEach((m) => matchCount.set(m.project_id, (matchCount.get(m.project_id) ?? 0) + 1));
  const stats = new Map<string, { n: number; booked: number; visited: number }>();
  (leads ?? []).forEach((l) => { const s = stats.get(l.project_id!) ?? { n: 0, booked: 0, visited: 0 }; s.n++; if (l.stage === 'booked') s.booked++; if (['visited', 'negotiation', 'token', 'booked'].includes(l.stage)) s.visited++; stats.set(l.project_id!, s); });
  const list = (projects ?? []) as P[];
  if (byVotes) list.sort((a, b) => (votes.get(b.id) ?? 0) - (votes.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  return (
    <>
      <div className="top"><h1>Projects</h1>{votes.size > 0 && <div className="row-gap"><span className="hint">Sort:</span><Link className={`btn sm ${byVotes ? 'ghost' : ''}`} href="/projects">A–Z</Link><Link className={`btn sm ${byVotes ? '' : 'ghost'}`} href="/projects?sort=votes">Most liked</Link></div>}</div>
      <LiveCounts orgId={org.id} initial={{ votes: Object.fromEntries(votes), saves: Object.fromEntries(Array.from(saves, ([k, v]) => [k, v.n])) }}>
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
              <div className="hint">{[p.deal === 'lease' ? 'For lease' : p.deal === 'both' ? 'Sale or lease' : '', p.type, p.configs, p.possession ? 'Possession ' + p.possession : ''].filter(Boolean).join(' · ')}</div>
              {(p.size_from || p.towers || p.units) && <div className="hint">{[p.size_from ? `${p.size_from.toLocaleString('en-IN')}${p.size_to ? '–' + p.size_to.toLocaleString('en-IN') : ''} sq ft` : '', p.towers, p.units ? `${p.units} homes` : ''].filter(Boolean).join(' · ')}</div>}
              {p.amenities && <div className="amen">{p.amenities.split(/[,•\n]+/).map((a) => a.trim()).filter(Boolean).slice(0, 8).map((a) => <span key={a}>{a}</span>)}</div>}
              {p.banks && <div className="hint">Home loan: {p.banks}</div>}
              {(p.rate_card ?? []).length > 0 && <div className="hint">Rate (₹/sq ft): {(p.rate_card ?? []).map((x) => `floor ${x.floors} ₹${Number(x.rate).toLocaleString('en-IN')}`).join(' · ')}</div>}
              {unitsBy.has(p.id) && (() => { const c = unitsBy.get(p.id)!; const all = Object.values(c).reduce((a, b) => a + b, 0); return (
                <Link href={`/projects/${p.id}/units`} className="units-chip"><span className="units-chip-h">Inventory</span><b>{c.open ?? 0}</b> of {all} flats open{c.booked ? ` · ${c.booked} booked` : ''}{c.hold ? ` · ${c.hold} on hold` : ''}{c.mortgage ? ` · ${c.mortgage} mortgage` : ''} → see inventory</Link>
              ); })()}
              {p.inventory_url && <SyncButton projectId={p.id} syncedAt={p.inventory_synced_at} error={p.inventory_sync_error} compact />}
              {!unitsBy.has(p.id) && !p.inventory_url && mgr && <Link href={`/projects/${p.id}/units`} className="hint">+ Add inventory (sheet link or Excel)</Link>}
              {p.map_url && <a href={p.map_url} target="_blank" rel="noopener noreferrer" className="hint">Google Maps</a>}
              {p.rera_no && <div className="hint mono">RERA {p.rera_no}</div>}
              {p.highlights && <div className="hint">{p.highlights}</div>}
              {p.link && <a href={/^https?:\/\//.test(p.link) ? p.link : 'https://' + p.link} target="_blank" rel="noopener noreferrer">{/\.pdf$/i.test(p.link) ? 'Brochure (PDF)' : 'Brochure / site'}</a>}
              <ProjectPlans projectId={p.id} orgId={org.id} plans={p.floor_plans ?? []} canEdit={mgr} hasPdf={!!p.link && /\.pdf$/i.test(p.link)} />
              <ProjectVideos projectId={p.id} orgId={org.id} videos={Array.isArray(p.videos) ? p.videos : []} canEdit={mgr} />
              <div className="stats3 stats4"><div><b className="mono">{s.n}</b><span className="hint">Leads</span></div><div><b className="mono">{s.visited}</b><span className="hint">Visited</span></div><div><b className="mono">{s.booked}</b><span className="hint">Booked</span></div><div title="Likes from visitors on your website"><b className="mono"><LiveCount kind="votes" id={p.id} /></b><span className="hint">Likes</span></div><div title="Saved on your website (signed-in clients and visitors)"><b className="mono"><LiveCount kind="saves" id={p.id} /></b><span className="hint">Saves</span></div></div>
              {(saves.get(p.id)?.who.length ?? 0) > 0 && (
                <details className="saved-by"><summary className="hint">Saved by {saves.get(p.id)!.who.length} client{saves.get(p.id)!.who.length === 1 ? '' : 's'} with an account</summary>
                  <ul className="saved-list">{saves.get(p.id)!.who.map((c) => <li key={c.id}><b>{c.name || 'No name'}</b> <span className="hint">{[c.phone ? fmtPhone(c.phone) : '', c.email].filter(Boolean).join(' · ')}</span></li>)}</ul>
                </details>
              )}
              {(matchCount.get(p.id) ?? 0) > 0 && (
                <Link className="match-chip" href={`/leads?match=${p.id}`}>{matchCount.get(p.id)} {mgr ? 'leads' : 'of your leads'} wanted something like this →</Link>
              )}
              <ProjectShare id={p.id} web={web} crmLink={`${siteUrl()}/p/${p.share_token}`} soldOut={p.status === 'Sold out'} mgr={mgr}
                onWebsite={p.on_website === undefined ? undefined : !!p.on_website} isPublic={!!p.is_public} text={`Have a look at ${p.name}${p.location ? ' in ' + p.location : ''}: photos, price and location`} />
              <div className="row-gap">
                <Link className="btn sm" href={`/leads?project=${p.id}`}>See leads</Link>
                {p.lat != null && <Link className="btn sm ghost" href="/map">On map</Link>}
                {mgr && p.status !== 'Sold out' && <form action={rematchProject}><input type="hidden" name="id" value={p.id} /><Submit className="btn sm ghost" pendingText="Checking…">Find matching leads</Submit></form>}
                {mgr && (
                  <details className="grow">
                    <summary className="btn sm ghost">Edit</summary>
                    <ActionForm action={saveProject} className="stack inline-box"><ProjectFields p={p} /><Submit className="btn sm primary">Save</Submit></ActionForm>
                    <form action={deleteProject} style={{ marginTop: 8 }}><input type="hidden" name="id" value={p.id} /><button className="btn sm ghost danger">Delete project</button></form>
                  </details>
                )}
              </div>
            </div>
          );
        })}
        {!list.length && <div className="panel"><p className="empty">No projects yet.{mgr ? ' Add the projects you sell below, with price range and unit options.' : ''}</p></div>}
      </div>
      </LiveCounts>
      {mgr && (
        <section className="panel narrow" style={{ marginTop: 16 }}>
          <div className="panel-h"><h2>Add a project</h2></div>
          <div className="panel-b"><AddProjectForm orgId={org.id} /></div>
        </section>
      )}
    </>
  );
}
