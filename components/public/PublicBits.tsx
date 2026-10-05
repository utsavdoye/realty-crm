'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { sendEnquiry, shortlistReact, shortlistSeen } from '@/app/public-actions';
import type { MapProject } from '@/components/CityMap';

const CityMap = dynamic(() => import('@/components/CityMap').then((m) => m.CityMap), { ssr: false, loading: () => <div className="citymap" style={{ height: 320 }} /> });

export function PublicMap({ projects, height = 340 }: { projects: MapProject[]; height?: number }) {
  return <CityMap projects={projects} kinds={['metro', 'tech', 'airport', 'hospital', 'school']} height={height} />;
}

function Send({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return <button className="btn primary block" disabled={pending}>{pending ? 'Sending…' : children}</button>;
}

export function EnquiryForm({ token, project }: { token: string; project: string }) {
  const [state, action] = useFormState(sendEnquiry, null);
  const [visit, setVisit] = useState(false);
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
