'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { AREAS, parseLatLng } from '@/lib/places';

const CityMap = dynamic(() => import('@/components/CityMap').then((m) => m.CityMap), { ssr: false, loading: () => <div className="citymap" style={{ height: 260 }} /> });

const SHORT = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i;

/** One place for the project's spot: the Google Maps link (its pin is read from the link), or tap the map. */
export function LocationPicker({ lat, lng, area, mapUrl = '' }: { lat?: number | null; lng?: number | null; area?: string | null; mapUrl?: string }) {
  const [pt, setPt] = useState<[number, number] | null>(lat != null && lng != null ? [lat, lng] : null);
  const [url, setUrl] = useState(mapUrl);
  const [open, setOpen] = useState(false);
  const guess = area ? Object.entries(AREAS).find(([n]) => area.toLowerCase().includes(n.toLowerCase()))?.[1] : undefined;
  const short = SHORT.test(url.trim());

  function onLink(v: string) {
    setUrl(v);
    const p = parseLatLng(v);
    if (p) setPt(p);
    else if (SHORT.test(v.trim()) && v.trim() !== mapUrl) setPt(null); // a new short link: the pin is read from it when you save
  }

  return (
    <div className="field full">
      <span className="label">Google Maps link</span>
      <input type="hidden" name="lat" value={pt ? pt[0].toFixed(6) : ''} />
      <input type="hidden" name="lng" value={pt ? pt[1].toFixed(6) : ''} />
      <input name="map_url" value={url} onChange={(e) => onLink(e.target.value)} placeholder="https://maps.app.goo.gl/…  (Google Maps → Share → Copy link)" />
      <div className="row-gap" style={{ marginTop: 6 }}>
        <button type="button" className="btn sm" onClick={() => { if (!pt && guess) setPt(guess); setOpen((o) => !o); }}>{open ? 'Hide map' : pt ? 'Move the pin' : 'Pick on map'}</button>
        {pt && <button type="button" className="btn sm ghost" onClick={() => setPt(null)}>Clear pin</button>}
      </div>
      <span className="hint">
        {pt ? `On the map at ${pt[0].toFixed(5)}, ${pt[1].toFixed(5)}.` : short ? 'The map pin will be taken from this link when you save.' : 'Paste the Google Maps link, or pick the spot on the map, so this project shows on the map.'}
      </span>
      {open && <CityMap pick={pt ?? guess ?? null} onPick={(a, b) => setPt([a, b])} height={260} fitProjects={false} kinds={['metro']} />}
      {open && <span className="hint">Tap the exact spot of the project on the map.</span>}
    </div>
  );
}
