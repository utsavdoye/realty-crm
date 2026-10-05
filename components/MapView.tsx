'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CityMap, type MapDemand } from '@/components/CityMap';
import { KIND_ICON, KIND_LABEL, directionsUrl, fmtKm, nearest, type PlaceKind } from '@/lib/places';
import { fmtL } from '@/lib/crm';

export type MapProjectFull = {
  id: string; name: string; lat: number; lng: number; status: string | null; type: string | null; location: string | null;
  configs: string | null; price_from: number | null; price_to: number | null; photo: string | null; leads: number;
};

const ALL_KINDS: PlaceKind[] = ['metro', 'tech', 'hospital', 'school', 'mall', 'rail', 'airport'];

export function MapView({ projects, demand, missing }: { projects: MapProjectFull[]; demand: MapDemand[]; missing: string[] }) {
  const [kinds, setKinds] = useState<PlaceKind[]>(['metro', 'tech', 'airport']);
  const [showDemand, setShowDemand] = useState(true);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState<string | null>(null);

  const types = useMemo(() => [...new Set(projects.map((p) => p.type).filter(Boolean))] as string[], [projects]);
  const statuses = useMemo(() => [...new Set(projects.map((p) => p.status).filter(Boolean))] as string[], [projects]);
  const shown = projects.filter((p) => (!type || p.type === type) && (!status || p.status === status));
  const cur = projects.find((p) => p.id === sel) ?? null;
  const near = cur ? nearest([cur.lat, cur.lng]) : [];
  const toggle = (k: PlaceKind) => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));

  return (
    <div className="mapwrap">
      <div className="map-tools">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Project type"><option value="">All types</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{statuses.map((t) => <option key={t}>{t}</option>)}</select>
        <span className="map-chips">
          {ALL_KINDS.map((k) => (
            <button key={k} type="button" className={`mchip ${kinds.includes(k) ? 'on' : ''}`} onClick={() => toggle(k)} aria-pressed={kinds.includes(k)}>
              <span className="lm sm" data-k={k}>{KIND_ICON[k]}</span>{KIND_LABEL[k]}
            </button>
          ))}
          <button type="button" className={`mchip ${showDemand ? 'on' : ''}`} onClick={() => setShowDemand((v) => !v)} aria-pressed={showDemand}>
            <span className="dot-demand" />Where leads want to buy
          </button>
        </span>
      </div>

      <div className="map-grid">
        <CityMap projects={shown.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, status: p.status, sub: [p.configs, p.price_from ? fmtL(p.price_from) + '+' : ''].filter(Boolean).join(' · ') }))}
          demand={showDemand ? demand : []} kinds={kinds} selected={sel} onSelect={setSel} height="min(72vh, 680px)" />

        <aside className="panel map-side">
          {cur ? (
            <>
              {cur.photo && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={cur.photo} alt={cur.name} className="ms-photo" />)}
              <div className="panel-b stack" style={{ paddingTop: 12 }}>
                <div className="row-gap" style={{ justifyContent: 'space-between' }}><h2>{cur.name}</h2><button className="btn sm ghost" onClick={() => setSel(null)} aria-label="Close">✕</button></div>
                <div className="hint">{[cur.location, cur.type, cur.configs, cur.status].filter(Boolean).join(' · ')}</div>
                {cur.price_from && <div className="price">{fmtL(cur.price_from)}{cur.price_to ? ` – ${fmtL(cur.price_to).replace('₹', '')}` : ''}</div>}
                <div>
                  <b className="small-h">Nearby (straight-line distance)</b>
                  <ul className="near">
                    {near.map((n) => <li key={n.k}><span className="lm sm" data-k={n.k}>{KIND_ICON[n.k]}</span><span className="grow">{n.n}</span><b className="mono">{fmtKm(n.km)}</b></li>)}
                  </ul>
                </div>
                <div className="row-btns">
                  <a className="btn sm" href={directionsUrl(cur.lat, cur.lng)} target="_blank" rel="noopener noreferrer">Directions</a>
                  <Link className="btn sm" href={`/leads?project=${cur.id}`}>{cur.leads} lead{cur.leads === 1 ? '' : 's'}</Link>
                  <Link className="btn sm ghost" href="/projects">Project page</Link>
                </div>
              </div>
            </>
          ) : (
            <div className="panel-b stack" style={{ paddingTop: 14 }}>
              <h2>{shown.length} project{shown.length === 1 ? '' : 's'} on the map</h2>
              <p className="hint">Tap a pin to see the nearest metro, tech park, hospital, school, mall, station and the airport.</p>
              <div className="rows tight">
                {shown.map((p) => (
                  <button key={p.id} className="callrow" onClick={() => setSel(p.id)}>
                    <span className="cr-main"><b>{p.name}</b><span className="hint">{[p.location, p.status].filter(Boolean).join(' · ')}</span></span>
                  </button>
                ))}
              </div>
              {missing.length > 0 && <p className="hint">Not on the map yet (no location): {missing.join(', ')}. Add it in Projects → Edit.</p>}
              <p className="hint">Orange circles show the areas your leads asked for. Bigger circle = more leads.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
