'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { sendEnquiry, shortlistReact, shortlistSeen } from '@/app/public-actions';
import type { Pin3D } from '@/components/Map3D';

const Map3D = dynamic(() => import('@/components/Map3D').then((m) => m.Map3D), { ssr: false, loading: () => <div className="m3 m3-skel" style={{ height: 340 }} /> });
const Google3D = dynamic(() => import('@/components/public/Google3D').then((m) => m.Google3D), { ssr: false, loading: () => <div className="m3 m3-skel" style={{ height: 380 }} /> });
const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? '';

/** Free 3D satellite map (MapLibre) for client links. With one project it slowly flies around it. */
export function PublicMap({ projects, height = 340 }: { projects: Pin3D[]; height?: number }) {
  return <Map3D projects={projects} kinds={['metro', 'tech', 'airport', 'hospital', 'school', 'mall', 'rail']} height={height} base="satellite" compact autoOrbit={projects.length === 1} />;
}

/**
 * Client project page map. If a Google Maps key is set (only after checking Raipur has Google 3D),
 * show Google's photo-real 3D fly-around first; otherwise, or if Google fails, the free 3D satellite map.
 */
export function ProjectLocationMap({ project }: { project: Pin3D }) {
  const [google, setGoogle] = useState(!!GOOGLE_KEY);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {GOOGLE_KEY && (
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          <button type="button" className={google ? 'on' : ''} onClick={() => setGoogle(true)}>Photo-real 3D</button>
          <button type="button" className={!google ? 'on' : ''} onClick={() => setGoogle(false)}>Map</button>
        </div>
      )}
      {google ? <Google3D apiKey={GOOGLE_KEY} lat={project.lat} lng={project.lng} name={project.name} onFail={() => setGoogle(false)} />
        : <PublicMap projects={[project]} height={380} />}
    </div>
  );
}

function Send({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return <button className="btn primary block" disabled={pending}>{pending ? 'Sending…' : children}</button>;
}

export function EnquiryForm({ token, project, defaultVisit = false }: { token: string; project: string; defaultVisit?: boolean }) {
  const [state, action] = useFormState(sendEnquiry, null);
  const [visit, setVisit] = useState(defaultVisit);
  if (state?.ok) return <div className="msg ok">Thank you! Our team will call you shortly{visit ? ' to confirm your site visit' : ''}.</div>;
  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      <label className="field"><span className="label">Your name</span><input name="name" required maxLength={120} autoComplete="name" /></label>
      <label className="field"><span className="label">Mobile number</span><input name="phone" required inputMode="tel" autoComplete="tel" placeholder="98765 43210 or +971 50 123 4567" /></label>
      <label className="check"><input type="checkbox" checked={visit} onChange={(e) => setVisit(e.target.checked)} /> I want to visit {project}</label>
      {visit && <label className="field"><span className="label">Preferred date and time</span><input type="datetime-local" name="when" required /></label>}
      <label className="field"><span className="label">Anything to tell us? (optional)</span><textarea name="message" rows={2} maxLength={500} placeholder="e.g. 3 BHK, east facing, budget ₹1.2 Cr" /></label>
      {state?.error && <p className="msg err" role="alert">{state.error}</p>}
      <Send>{visit ? 'Book my visit' : 'Call me back'}</Send>
      <p className="hint center">We use your number only to call you about this project.</p>
    </form>
  );
}

export function SeenPing({ token }: { token: string }) {
  useEffect(() => { const t = setTimeout(() => { shortlistSeen(token); }, 1500); return () => clearTimeout(t); }, [token]);
  return null;
}

export function ReactButtons({ token, projectId, initial }: { token: string; projectId: string; initial?: string }) {
  const [r, setR] = useState(initial ?? '');
  const [when, setWhen] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function go(kind: 'like' | 'no' | 'visit') {
    setBusy(true);
    const ok = await shortlistReact(token, projectId, kind, kind === 'visit' ? when : undefined);
    setBusy(false);
    if (ok) { setR(kind); if (kind === 'visit') { setSent(true); setPicking(false); } }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row-btns">
        <button className={`btn sm ${r === 'like' ? 'primary' : ''}`} disabled={busy} onClick={() => go('like')}>♥ I like this</button>
        <button className={`btn sm ${r === 'no' ? 'primary' : ''}`} disabled={busy} onClick={() => go('no')}>Not for me</button>
        <button className={`btn sm ${r === 'visit' ? 'primary' : ''}`} disabled={busy} onClick={() => setPicking((p) => !p)}>Book a site visit</button>
      </div>
      {picking && (
        <div className="row-gap">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Visit date and time" />
          <button className="btn sm primary" disabled={busy || !when} onClick={() => go('visit')}>Send</button>
        </div>
      )}
      {sent && <p className="msg ok">Request sent. We will call you to confirm.</p>}
    </div>
  );
}
