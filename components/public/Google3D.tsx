'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Google Photorealistic 3D fly-around (Maps JavaScript API, maps3d library).
 * Only used on the client project page, and only when NEXT_PUBLIC_GOOGLE_MAPS_KEY is set.
 * If the key is wrong, blocked, or the browser cannot show it, onFail() switches back to the free MapLibre map.
 */
type G = { maps: { importLibrary: (n: string) => Promise<Record<string, unknown>> } };
declare global { interface Window { google?: G; __gm3dReady?: () => void; gm_authFailure?: () => void } }

let loading: Promise<void> | null = null;
function loadGoogle(key: string) {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    window.__gm3dReady = () => resolve();
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=beta&libraries=maps3d&loading=async&callback=__gm3dReady`;
    s.async = true;
    s.onerror = () => { loading = null; reject(new Error('Google Maps did not load')); };
    document.head.appendChild(s);
  });
  return loading;
}

export function Google3D({ apiKey, lat, lng, name, height = 380, onFail }: { apiKey: string; lat: number; lng: number; name: string; height?: number; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLElement & { flyCameraAround?: (o: unknown) => void; stopCameraAnimation?: () => void } | null>(null);
  const [ready, setReady] = useState(false);
  const failRef = useRef(onFail);
  failRef.current = onFail;

  const camera = { center: { lat, lng, altitude: 0 }, tilt: 66, range: 850, heading: 20 };
  const fly = () => el.current?.flyCameraAround?.({ camera, durationMillis: 45000, rounds: 1 });

  useEffect(() => {
    let dead = false;
    window.gm_authFailure = () => failRef.current();
    (async () => {
      try {
        await loadGoogle(apiKey);
        const lib = await window.google!.maps.importLibrary('maps3d') as unknown as {
          Map3DElement: new (o: Record<string, unknown>) => HTMLElement; Marker3DElement?: new (o: Record<string, unknown>) => HTMLElement;
        };
        if (dead || !box.current) return;
        const map = new lib.Map3DElement({ ...camera, mode: 'HYBRID' }) as typeof el.current;
        map!.style.width = '100%'; map!.style.height = '100%';
        if (lib.Marker3DElement) {
          map!.append(new lib.Marker3DElement({ position: { lat, lng, altitude: 40 }, altitudeMode: 'RELATIVE_TO_GROUND', extruded: true, label: name }));
        }
        box.current.appendChild(map!);
        el.current = map;
        setReady(true);
        setTimeout(() => { if (!dead) fly(); }, 1500);
      } catch {
        if (!dead) failRef.current();
      }
    })();
    return () => { dead = true; el.current?.stopCameraAnimation?.(); el.current?.remove(); el.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, lat, lng]);

  return (
    <div className="m3 g3d" style={{ height }}>
      <div ref={box} className="m3-canvas" aria-label={`3D view of ${name}`} />
      {!ready && <div className="m3-loading"><span className="m3-spin" />Loading 3D view…</div>}
      <div className="m3-tools"><button type="button" className="m3-btn" onClick={fly}>⟳ Fly around again</button></div>
    </div>
  );
}
