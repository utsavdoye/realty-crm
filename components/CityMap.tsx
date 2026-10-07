'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type * as Leaflet from 'leaflet';
import { CITY_CENTER, KIND_ICON, KIND_LABEL, PLACES, type PlaceKind } from '@/lib/places';

export type MapProject = { id: string; name: string; lat: number; lng: number; status?: string | null; sub?: string };
export type MapDemand = { area: string; lat: number; lng: number; n: number };

const STATUS_COLOR: Record<string, string> = { 'Ready to move': '#2b7a4b', 'Under construction': '#1d4e89', 'Pre-launch': '#b97c00', 'Sold out': '#8a94a3' };
const KIND_COLOR: Record<PlaceKind, string> = { metro: '#7b3fa0', airport: '#0b7285', rail: '#5c4033', tech: '#2f6fd6', mall: '#c2255c', hospital: '#d6336c', school: '#2b8a3e' };

/**
 * Simple 2D map (free OpenStreetMap tiles), used to pick a project location. Shows projects as pins, optional landmark layers and lead demand circles.
 * pick mode: clicking the map calls onPick(lat, lng) — used to set a project's location.
 */
export function CityMap({
  projects = [], demand = [], kinds = [], selected, onSelect, pick, onPick, height = 520, fitProjects = true,
}: {
  projects?: MapProject[]; demand?: MapDemand[]; kinds?: PlaceKind[]; selected?: string | null; onSelect?: (id: string) => void;
  pick?: [number, number] | null; onPick?: (lat: number, lng: number) => void; height?: number | string; fitProjects?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const layers = useRef<{ projects?: Leaflet.LayerGroup; places?: Leaflet.LayerGroup; demand?: Leaflet.LayerGroup; pick?: Leaflet.Marker }>({});
  const cb = useRef({ onSelect, onPick });
  cb.current = { onSelect, onPick };
  const fitted = useRef(false);

  // create the map once
  useEffect(() => {
    let dead = false;
    (async () => {
      const lib = await import('leaflet');
      if (dead || !box.current || map.current) return;
      L.current = lib;
      const m = lib.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: true }).setView(CITY_CENTER, 11);
      lib.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, subdomains: 'abc', attribution: '© OpenStreetMap contributors',
      }).addTo(m);
      m.on('click', (e: Leaflet.LeafletMouseEvent) => cb.current.onPick?.(e.latlng.lat, e.latlng.lng));
      map.current = m;
      setTimeout(() => m.invalidateSize(), 50);
      draw();
    })();
    return () => { dead = true; map.current?.remove(); map.current = null; layers.current = {}; fitted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const lib = L.current; const m = map.current;
    if (!lib || !m) return;
    const g = layers.current;

    g.demand?.remove();
    g.demand = lib.layerGroup(demand.map((d) => lib.circleMarker([d.lat, d.lng], {
      radius: Math.min(34, 6 + Math.sqrt(d.n) * 3), color: '#b8382a', weight: 1, fillColor: '#e8590c', fillOpacity: 0.28,
    }).bindTooltip(`${d.area}: ${d.n} lead${d.n === 1 ? '' : 's'}`))).addTo(m);

    g.places?.remove();
    g.places = lib.layerGroup(PLACES.filter((p) => kinds.includes(p.k)).map((p) => lib.marker([p.lat, p.lng], {
      icon: lib.divIcon({ className: '', html: `<span class="lm" style="--c:${KIND_COLOR[p.k]}">${KIND_ICON[p.k]}</span>`, iconSize: [20, 20], iconAnchor: [10, 10] }),
      keyboard: false,
    }).bindTooltip(`${p.n} · ${KIND_LABEL[p.k]}`))).addTo(m);

    g.projects?.remove();
    g.projects = lib.layerGroup(projects.map((p) => {
      const on = p.id === selected;
      const mk = lib.marker([p.lat, p.lng], {
        icon: lib.divIcon({
          className: '', iconSize: [30, 40], iconAnchor: [15, 38],
          html: `<span class="pin${on ? ' on' : ''}" style="--c:${STATUS_COLOR[p.status ?? ''] ?? '#1d4e89'}"><i></i></span>`,
        }),
        zIndexOffset: on ? 1000 : 0, title: p.name,
      }).bindTooltip(`<b>${escapeHtml(p.name)}</b>${p.sub ? '<br>' + escapeHtml(p.sub) : ''}`, { direction: 'top', offset: [0, -34] });
      mk.on('click', () => cb.current.onSelect?.(p.id));
      return mk;
    })).addTo(m);

    g.pick?.remove();
    if (pick) g.pick = lib.marker(pick, { icon: lib.divIcon({ className: '', html: '<span class="pin on" style="--c:#b8382a"><i></i></span>', iconSize: [30, 40], iconAnchor: [15, 38] }) }).addTo(m);

    if (!fitted.current) {
      const pts: [number, number][] = pick ? [pick] : fitProjects ? projects.map((p) => [p.lat, p.lng]) : [];
      if (pts.length === 1) m.setView(pts[0], pick ? 15 : 13);
      else if (pts.length > 1) m.fitBounds(lib.latLngBounds(pts).pad(0.15));
      fitted.current = pts.length > 0;
    }
  }

  useEffect(() => { draw(); }); // redraw when props change

  useEffect(() => {
    const p = projects.find((x) => x.id === selected);
    if (p && map.current) map.current.flyTo([p.lat, p.lng], Math.max(map.current.getZoom(), 13), { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return <div ref={box} className="citymap" style={{ height }} role="application" aria-label="Map" />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
