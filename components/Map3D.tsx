'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MLMap, Marker as MLMarker, StyleSpecification } from 'maplibre-gl';
import type { MapboxOverlay } from '@deck.gl/mapbox';
import { AREAS, CITY_CENTER, KIND_ICON, KIND_LABEL, PLACES, type PlaceKind } from '@/lib/places';

/**
 * 3D map: MapLibre (free, no key, no billing) + deck.gl for 3D demand bars.
 * - "Map" = OpenFreeMap streets with 3D buildings; "Satellite" = Esri World Imagery with road and place labels.
 * - Tap a project pin and the camera flies to it in 3D. "Fly around" slowly circles the selected project.
 */

export type Pin3D = { id: string; name: string; lat: number; lng: number; status?: string | null; sub?: string; photo?: string | null };
export type Demand3D = { area: string; lat: number; lng: number; n: number };
type Base = 'map' | 'satellite';
type Zone = { area: string; lat: number; lng: number; r: number; projects: Pin3D[] };

/** Groups projects by their nearest known area, so hovering an area shows what is there. */
function zonesFor(projects: Pin3D[]): Zone[] {
  const names = Object.keys(AREAS);
  if (!names.length || projects.length < 2) return [];
  const dist = (a: [number, number], lat: number, lng: number) => {
    const dy = (a[0] - lat) * 111320, dx = (a[1] - lng) * 111320 * Math.cos((lat * Math.PI) / 180);
    return Math.sqrt(dx * dx + dy * dy);
  };
  const by = new Map<string, Pin3D[]>();
  projects.forEach((p) => {
    let best = '', bd = Infinity;
    names.forEach((n) => { const d = dist(AREAS[n], p.lat, p.lng); if (d < bd) { bd = d; best = n; } });
    if (best && bd < 6000) by.set(best, [...(by.get(best) ?? []), p]);
  });
  return [...by.entries()].map(([area, ps]) => {
    const [lat, lng] = AREAS[area];
    return { area, lat, lng, projects: ps, r: Math.min(3000, Math.max(...ps.map((p) => dist([lat, lng], p.lat, p.lng))) + 600) };
  });
}

const STATUS_COLOR: Record<string, string> = { 'Ready to move': '#16a34a', 'Under construction': '#4a55ec', 'Pre-launch': '#f59e0b', 'Sold out': '#9ca3af' };
const KIND_COLOR: Record<PlaceKind, string> = { metro: '#7b3fa0', airport: '#0b7285', rail: '#5c4033', tech: '#2f6fd6', mall: '#c2255c', hospital: '#d6336c', school: '#2b8a3e' };

const STREETS = 'https://tiles.openfreemap.org/styles/liberty';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const SATELLITE: StyleSpecification = {
  version: 8,
  sources: {
    sat: { type: 'raster', tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
    roads: { type: 'raster', tiles: [`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
    names: { type: 'raster', tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
  },
  layers: [
    { id: 'sat', type: 'raster', source: 'sat' },
    { id: 'roads', type: 'raster', source: 'roads', paint: { 'raster-opacity': 0.75 } },
    { id: 'names', type: 'raster', source: 'names' },
  ],
};

/** Plain background, used only if the map tiles cannot be reached at all, so pins and bars still show. */
const BLANK: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e7eaf0' } }] };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function Map3D({
  projects = [], demand = [], kinds = [], selected, onSelect, height = 560, base: base0 = 'map', autoOrbit = false, compact = false, areas = false,
}: {
  projects?: Pin3D[]; demand?: Demand3D[]; kinds?: PlaceKind[]; selected?: string | null; onSelect?: (id: string) => void;
  height?: number | string; base?: Base; autoOrbit?: boolean; compact?: boolean; areas?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const deck = useRef<MapboxOverlay | null>(null);
  const meshMod = useRef<typeof import('@deck.gl/mesh-layers') | null>(null);
  const layersMod = useRef<typeof import('@deck.gl/layers') | null>(null);
  const pins = useRef<MLMarker[]>([]);
  const marks = useRef<MLMarker[]>([]);
  const orbit = useRef<number | null>(null);
  const cb = useRef({ onSelect });
  cb.current = { onSelect };
  const [inited, setInited] = useState(false); // map object exists (pins, bars and camera can be used)
  const [ready, setReady] = useState(false);   // first style finished loading
  const [failed, setFailed] = useState(false);
  const [base, setBase] = useState<Base>(base0);
  const [tilt, setTilt] = useState(true);
  const [orbiting, setOrbiting] = useState(false);
  const [zoom, setZoom] = useState(11);

  const stopOrbit = useCallback(() => {
    if (orbit.current != null) cancelAnimationFrame(orbit.current);
    orbit.current = null; setOrbiting(false);
  }, []);

  /** Slowly circle around a point (about 30 s per full turn). Stops when the person touches the map. */
  const startOrbit = useCallback((center?: [number, number]) => {
    const m = map.current; if (!m) return;
    stopOrbit();
    const go = () => {
      setOrbiting(true);
      let last = performance.now();
      const step = (t: number) => {
        const dt = t - last; last = t;
        m.setBearing((m.getBearing() + dt * 0.012) % 360);
        orbit.current = requestAnimationFrame(step);
      };
      orbit.current = requestAnimationFrame(step);
    };
    if (center) {
      m.flyTo({ center: [center[1], center[0]], zoom: Math.max(m.getZoom(), 16), pitch: 62, duration: 1800, essential: true });
      m.once('moveend', go);
    } else go();
  }, [stopOrbit]);

  // Create the map once.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [ml, { MapboxOverlay: Overlay }, mesh, lay] = await Promise.all([import('maplibre-gl'), import('@deck.gl/mapbox'), import('@deck.gl/mesh-layers'), import('@deck.gl/layers')]);
        if (dead || !box.current) return;
        lib.current = ml; meshMod.current = mesh; layersMod.current = lay;
        const m = new ml.Map({
          container: box.current, style: base0 === 'satellite' ? SATELLITE : STREETS,
          center: [CITY_CENTER[1], CITY_CENTER[0]], zoom: 11, pitch: 50, bearing: -12, maxPitch: 75,
          attributionControl: { compact: true }, cooperativeGestures: compact,
        });
        m.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
        const overlay = new Overlay({
          interleaved: true, layers: [],
          getTooltip: ({ object }: { object?: Demand3D | Zone }) => {
            if (!object) return null;
            const style = { background: '#15161b', color: '#fff', borderRadius: '12px', padding: '8px 10px', fontSize: '12px', fontFamily: 'inherit', maxWidth: '260px', lineHeight: '1.45' };
            if ('projects' in object) {
              const list = object.projects.slice(0, 6).map((p) => `• ${esc(p.name)}${p.sub ? ` <span style="opacity:.7">${esc(p.sub)}</span>` : ''}`).join('<br>');
              const more = object.projects.length > 6 ? `<br><span style="opacity:.7">+${object.projects.length - 6} more</span>` : '';
              return { html: `<b>${esc(object.area)}</b> · ${object.projects.length} project${object.projects.length === 1 ? '' : 's'}<br>${list}${more}<br><span style="opacity:.6">Click to zoom in</span>`, style };
            }
            return { html: `<b>${esc(object.area)}</b><br>${object.n} open lead${object.n === 1 ? '' : 's'} want to buy here`, style };
          },
        });
        m.addControl(overlay as unknown as import('maplibre-gl').IControl);
        deck.current = overlay;
        ['dragstart', 'wheel', 'touchstart', 'mousedown'].forEach((ev) => m.on(ev, () => { if (orbit.current != null) stopOrbit(); }));
        m.on('load', () => { if (!dead) setReady(true); });
        m.on('zoomend', () => { if (!dead) setZoom(Math.round(m.getZoom() * 2) / 2); });
        // If the street tiles are down, fall back to satellite, then to a plain background.
        let tries = 0;
        m.on('error', () => {
          if (dead || m.isStyleLoaded()) return;
          tries++;
          if (tries === 1 && base0 !== 'satellite') m.setStyle(SATELLITE);
          else if (tries <= 2) m.setStyle(BLANK);
        });
        setTimeout(() => { if (!dead) setReady(true); }, 12000);
        map.current = m;
        setInited(true);
        // keep the canvas sized to its box (sidebar fold, window resize)
        const ro = new ResizeObserver(() => m.resize());
        ro.observe(box.current);
        (m as unknown as { _ro?: ResizeObserver })._ro = ro;
      } catch {
        if (!dead) setFailed(true);
      }
    })();
    return () => {
      dead = true;
      if (orbit.current != null) cancelAnimationFrame(orbit.current);
      const m = map.current as unknown as ({ _ro?: ResizeObserver } & MLMap) | null;
      m?._ro?.disconnect();
      m?.remove(); map.current = null; deck.current = null; pins.current = []; marks.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch map / satellite (not on first load: the map starts with the right one).
  const baseShown = useRef<Base>(base0);
  useEffect(() => {
    const m = map.current; if (!m || !inited || baseShown.current === base) return;
    baseShown.current = base;
    m.setStyle(base === 'satellite' ? SATELLITE : STREETS);
  }, [base, inited]);

  // 3D tilt on/off (only when the person presses the button).
  const tiltShown = useRef(true);
  useEffect(() => {
    const m = map.current; if (!m || !inited || tiltShown.current === tilt) return;
    tiltShown.current = tilt;
    m.easeTo({ pitch: tilt ? 55 : 0, bearing: tilt ? m.getBearing() || -12 : 0, duration: 700 });
  }, [tilt, inited]);

  // Project pins with photos.
  useEffect(() => {
    const ml = lib.current; const m = map.current; if (!ml || !m) return;
    pins.current.forEach((p) => p.remove()); pins.current = [];
    projects.forEach((p) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `m3-pin${p.id === selected ? ' on' : ''}`;
      el.style.setProperty('--c', STATUS_COLOR[p.status ?? ''] ?? '#4a55ec');
      el.setAttribute('aria-label', p.name);
      el.innerHTML = `<span class="m3-ph">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : `<b>${esc(p.name.slice(0, 1))}</b>`}</span>`
        + `<span class="m3-lb"><b>${esc(p.name)}</b>${p.sub ? `<i>${esc(p.sub)}</i>` : ''}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); cb.current.onSelect?.(p.id); });
      pins.current.push(new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(m));
    });
  }, [projects, selected, inited]);

  // Landmarks.
  useEffect(() => {
    const ml = lib.current; const m = map.current; if (!ml || !m) return;
    marks.current.forEach((p) => p.remove()); marks.current = [];
    PLACES.filter((p) => kinds.includes(p.k)).forEach((p) => {
      const el = document.createElement('span');
      el.className = 'lm m3-lm';
      el.style.setProperty('--c', KIND_COLOR[p.k]);
      el.textContent = KIND_ICON[p.k];
      el.title = `${p.n} · ${KIND_LABEL[p.k]}`;
      marks.current.push(new ml.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(m));
    });
  }, [kinds, inited]);

  // Real 3D apartment towers (our own models in /public/models): where leads want to buy.
  // More leads = more and taller towers. They fade out when you zoom in close to a project, so they never hide it.
  const zones = useMemo(() => (areas ? zonesFor(projects) : []), [areas, projects]);
  useEffect(() => {
    const M = meshMod.current; const L = layersMod.current; const o = deck.current; if (!M || !L || !o) return;
    const max = Math.max(1, ...demand.map((d) => d.n));
    const fade = zoom <= 14 ? 1 : zoom >= 15.5 ? 0 : 1 - (zoom - 14) / 1.5;
    type Tower = Demand3D & { pos: [number, number]; size: 's' | 'm' | 'l'; turn: number };
    const towers: Tower[] = [];
    const SPOTS: [number, number][] = [[0, 0], [1, 0.2], [-0.2, 1], [-1, -0.1], [0.2, -1], [1, 1], [-1, -1]];
    demand.forEach((d, di) => {
      const t = d.n / max;
      const count = Math.min(SPOTS.length, 1 + Math.round(t * 6));
      const mLat = 1 / 111320, mLng = 1 / (111320 * Math.cos((d.lat * Math.PI) / 180));
      SPOTS.slice(0, count).forEach(([sx, sy], i) => {
        const k = (di * 7 + i * 3) % 10;
        const size: Tower['size'] = i === 0 ? (t > 0.66 ? 'l' : t > 0.33 ? 'm' : 's') : k < 4 ? 's' : k < 8 ? 'm' : 'l';
        towers.push({ ...d, size, turn: (di * 37 + i * 23) % 90, pos: [d.lng + sx * 330 * mLng, d.lat + sy * 330 * mLat] });
      });
    });
    const make = (size: Tower['size']) => new M.ScenegraphLayer<Tower>({
      id: `towers-${size}`, data: towers.filter((x) => x.size === size), scenegraph: `/models/tower-${size}.glb`,
      getPosition: (d) => d.pos, getOrientation: (d) => [0, d.turn, 90], sizeScale: 7, opacity: fade,
      _lighting: 'pbr', pickable: true, autoHighlight: true, highlightColor: [245, 158, 11, 160],
    });
    // Area circles: hover to see the projects in that area, click to zoom in.
    const zoneLayer = zones.length && zoom < 15 ? new L.ScatterplotLayer<Zone>({
      id: 'zones', data: zones, getPosition: (z) => [z.lng, z.lat], getRadius: (z) => z.r, radiusUnits: 'meters',
      getFillColor: [74, 85, 236, 28], getLineColor: [74, 85, 236, 150], lineWidthMinPixels: 1.5, stroked: true, filled: true,
      pickable: true, autoHighlight: true, highlightColor: [74, 85, 236, 70],
      onClick: ({ object: z }: { object?: Zone }) => {
        const m = map.current; const ml = lib.current; if (!z || !m || !ml) return false;
        stopOrbit();
        if (z.projects.length === 1) { cb.current.onSelect?.(z.projects[0].id); return true; }
        const b = new ml.LngLatBounds([z.projects[0].lng, z.projects[0].lat], [z.projects[0].lng, z.projects[0].lat]);
        z.projects.forEach((p) => b.extend([p.lng, p.lat]));
        m.fitBounds(b, { padding: 90, pitch: 55, maxZoom: 15.8, duration: 1400 });
        return true;
      },
    }) : null;
    o.setProps({ layers: [...(zoneLayer ? [zoneLayer] : []), ...(towers.length && fade > 0 ? [make('s'), make('m'), make('l')] : [])] });
  }, [demand, zones, inited, zoom, stopOrbit]);

  // First view: fit all projects (and demand) in a tilted view.
  const fitted = useRef(false);
  useEffect(() => {
    const ml = lib.current; const m = map.current; if (!ml || !m || !inited || fitted.current) return;
    const pts: [number, number][] = [...projects.map((p) => [p.lng, p.lat] as [number, number]), ...demand.map((d) => [d.lng, d.lat] as [number, number])];
    if (!pts.length) return;
    fitted.current = true;
    if (pts.length === 1) m.jumpTo({ center: pts[0], zoom: 15.5, pitch: 60, bearing: -20 });
    else {
      const b = new ml.LngLatBounds(pts[0], pts[0]); pts.forEach((p) => b.extend(p));
      m.fitBounds(b, { padding: compact ? 50 : 80, pitch: 50, bearing: -12, duration: 0, maxZoom: 15 });
    }
    if (autoOrbit && projects.length === 1) setTimeout(() => startOrbit(), 900);
  }, [projects, demand, inited, compact, autoOrbit, startOrbit]);

  // Fly to the selected project.
  useEffect(() => {
    const m = map.current; const p = projects.find((x) => x.id === selected);
    if (!m || !p || !inited) return;
    stopOrbit();
    m.flyTo({ center: [p.lng, p.lat], zoom: 16, pitch: 62, bearing: (m.getBearing() || 0) - 25, speed: 0.9, curve: 1.5, essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, inited]);

  if (failed) return <div className="citymap m3-fail" style={{ height }}><p className="hint">This device cannot show the 3D map. Try Chrome or Safari, or update the browser.</p></div>;

  const sel = projects.find((x) => x.id === selected) ?? (projects.length === 1 ? projects[0] : null);
  return (
    <div className="m3" style={{ height }}>
      <div ref={box} className="m3-canvas" role="application" aria-label="3D map" />
      {!ready && <div className="m3-loading"><span className="m3-spin" />Loading map…</div>}
      <div className="m3-tools">
        <div className="seg m3-seg">
          <button type="button" className={base === 'map' ? 'on' : ''} onClick={() => setBase('map')}>Map</button>
          <button type="button" className={base === 'satellite' ? 'on' : ''} onClick={() => setBase('satellite')}>Satellite</button>
        </div>
        <button type="button" className={`m3-btn ${tilt ? 'on' : ''}`} onClick={() => setTilt((t) => !t)} aria-pressed={tilt}>{tilt ? '3D' : '2D'}</button>
        {sel && (
          <button type="button" className={`m3-btn ${orbiting ? 'on' : ''}`} onClick={() => (orbiting ? stopOrbit() : startOrbit([sel.lat, sel.lng]))}>
            {orbiting ? '■ Stop' : '⟳ Fly around'}
          </button>
        )}
      </div>
    </div>
  );
}
