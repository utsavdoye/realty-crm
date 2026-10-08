import { ProjectPhotos } from '@/components/ProjectPhotos';
import { KIND_ICON, directionsUrl, fmtKm, nearest } from '@/lib/places';
import { fmtL } from '@/lib/crm';

export type PubProject = {
  id: string; token: string; name: string; developer: string | null; location: string | null; rera_no: string | null; type: string | null; configs: string | null;
  price_from: number | null; price_to: number | null; status: string | null; possession: string | null; highlights: string | null; link: string | null;
  photos: string[] | null; lat: number | null; lng: number | null;
  floor_plans?: { url: string; label: string }[] | null; size_from?: number | null; size_to?: number | null; towers?: string | null; units?: number | null;
  amenities?: string | null; banks?: string | null;
  // counts sent instead of the locked details
  photo_count?: number; has_range?: boolean; has_brochure?: boolean; plan_count?: number;
  payment_plan?: string | null; open_units?: number | null;
};

export function ProjectBlock({ p, children }: { p: PubProject; children?: React.ReactNode }) {
  const near = p.lat != null && p.lng != null ? nearest([p.lat, p.lng]) : [];
  const facts = [
    ['Price', p.price_from ? `${fmtL(p.price_from)}${p.price_to ? ' – ' + fmtL(p.price_to).replace('₹', '') : ' onwards'}` : 'On request'],
    ['Homes', p.configs], ['Type', p.type], ['Status', p.status], ['Possession', p.possession], ['RERA', p.rera_no],
  ].filter(([, v]) => v) as [string, string][];
  return (
    <article className="pub-card">
      <div className="pub-photos"><ProjectPhotos projectId={p.id} orgId="" name={p.name} photos={p.photos ?? []} canEdit={false} /></div>
      <div className="pub-body">
        <h2>{p.name}</h2>
        <div className="hint">{[p.developer, p.location].filter(Boolean).join(' · ')}</div>
        <dl className="facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={k === 'RERA' ? 'mono small' : ''}>{v}</dd></div>)}</dl>
        {p.highlights && <p>{p.highlights}</p>}
        {near.length > 0 && (
          <div>
            <b className="small-h">What is nearby</b>
            <ul className="near">{near.map((n) => <li key={n.k}><span className="lm sm" data-k={n.k}>{KIND_ICON[n.k]}</span><span className="grow">{n.n}</span><b className="mono">~{fmtKm(n.km)}</b></li>)}</ul>
          </div>
        )}
        <div className="row-btns">
          {p.lat != null && p.lng != null && <a className="btn sm" href={directionsUrl(p.lat, p.lng)} target="_blank" rel="noopener noreferrer">Get directions</a>}
          {p.link && <a className="btn sm ghost" href={/^https?:\/\//.test(p.link) ? p.link : 'https://' + p.link} target="_blank" rel="noopener noreferrer">Brochure</a>}
        </div>
        {children}
      </div>
    </article>
  );
}
