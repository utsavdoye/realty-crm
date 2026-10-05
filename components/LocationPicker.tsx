'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { AREAS, parseLatLng } from '@/lib/places';

const CityMap = dynamic(() => import('@/components/CityMap').then((m) => m.CityMap), { ssr: false, loading: () => <div className="citymap" style={{ height: 260 }} /> });

/** Set a project's spot: paste a Google Maps link, type "12.97, 77.59", pick an area, or tap the map. */
export function LocationPicker({ lat, lng, area }: { lat?: number | null; lng?: number | null; area?: string | null }) {
  const [pt, setPt] = useState<[number, number] | null>(lat != null && lng != null ? [lat, lng] : null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const guess = area ? Object.entries(AREAS).find(([n]) => area.toLowerCase().includes(n.toLowerCase()))?.[1] : undefined;

  return (
    <div className="field full">
      <span className="label">Location on map</span>
      <input type="hidden" name="lat" value={pt ? pt[0].toFixed(6) : ''} />
      <input type="hidden" name="lng" value={pt ? pt[1].toFixed(6) : ''} />
      <div className="row-gap">
        <input className="grow" value={text} placeholder="Paste a Google Maps link, or 12.97, 77.59" onChange={(e) => {
          setText(e.target.value); setErr('');
          const p = parseLatLng(e.target.value);
          if (p) { setPt(p); setOpen(true); } else if (e.target.value.trim()) setErr('Could not read a location from this. In Google Maps, long-press the spot and copy the numbers shown.');
        }} />
        <button type="button" className="btn sm" onClick={() => { if (!pt && guess) setPt(guess); setOpen((o) => !o); }}>{open ? 'Hide map' : 'Pick on map'}</button>
        {pt && <button type="button" className="btn sm ghost" onClick={() => { setPt(null); setText(''); }}>Clear</button>}
      </div>
      <span className="hint">{pt ? `Set: ${pt[0].toFixed(5)}, ${pt[1].toFixed(5)}` : 'Not set — this project will not show on the map.'}</span>
      {err && <span className="msg err">{err}</span>}
      {open && <CityMap pick={pt ?? guess ?? null} onPick={(a, b) => setPt([a, b])} height={260} fitProjects={false} kinds={['metro']} />}
      {open && <span className="hint">Tap the exact spot of the project on the map.</span>}
    </div>
  );
}
