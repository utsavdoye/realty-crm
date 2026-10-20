'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { ProjectPhotos } from '@/components/ProjectPhotos';
import { ProjectPlans } from '@/components/ProjectPlans';
import { PhoneInput } from '@/components/PhoneInput';
import { unlockProject, unlockShortlist, type Unlocked } from '@/app/public-actions';
import { KIND_ICON, directionsUrl, fmtKm, nearest } from '@/lib/places';
import { fmtL } from '@/lib/crm';
import type { Teaser } from '@/components/public/teaser';

function Send({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button className="btn primary block" disabled={pending}>{pending ? 'Unlocking…' : label}</button>;
}

const statusLine: Record<string, string> = {
  'Pre-launch': 'Pre-launch: early buyers get the best units and prices',
  'Under construction': 'Under construction: pay in stages as it is built',
  'Ready to move': 'Ready to move: no waiting, no rent',
};

export function ProjectTeaser({ p, mode, token, buzz = 0, advisor, children }: {
  p: Teaser; mode: 'project' | 'shortlist'; token: string; buzz?: number; advisor?: string | null; children?: React.ReactNode;
}) {
  const [full, setFull] = useState<Unlocked | null>(null);
  const [state, action] = useFormState(async (prev: Awaited<ReturnType<typeof unlockProject>> | null, fd: FormData) => {
    const r = await unlockProject(prev, fd);
    if (r.data) setFull(r.data);
    return r;
  }, null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const near = p.lat != null && p.lng != null ? nearest([p.lat, p.lng]).slice(0, 5) : [];
  const price = p.price_from
    ? full?.price_to ? `${fmtL(p.price_from)} – ${fmtL(full.price_to).replace('₹', '')}` : `${fmtL(p.price_from)} onwards`
    : 'On request';
  const size = p.size_from ? `${p.size_from.toLocaleString('en-IN')}${p.size_to ? '–' + p.size_to.toLocaleString('en-IN') : ''} sq ft` : '';
  const facts = [['Starting price', price], ['Homes', p.configs], ['Size', size], ['Type', p.type], ['Possession', p.possession], ['Towers', p.towers], ['Total homes', p.units ? String(p.units) : ''], ['Homes still open', p.open_units ? String(p.open_units) : ''], ['Home loan', p.banks], ['RERA', p.rera_no]]
    .filter(([, v]) => v) as [string, string][];
  const lockedItems = [
    p.hasRange && 'Price of every unit',
    (p.plans > 0 ? `${p.plans} floor plan${p.plans === 1 ? '' : 's'}` : 'Floor plans') + (p.hasBrochure ? ' and brochure' : ''),
    p.more > 0 && `All ${p.more + 1} photos`,
    'Best units still available',
  ].filter(Boolean) as string[];

  async function oneTap() {
    setBusy(true); setErr('');
    const r = await unlockShortlist(token, p.id);
    setBusy(false);
    if (r) setFull(r); else setErr('Could not open. Please call your advisor.');
  }

  return (
    <article className="pub-card teaser">
      <div className="t-hero">
        {full && full.photos.length ? (
          <div className="pub-photos"><ProjectPhotos projectId={p.id} orgId="" name={p.name} photos={full.photos} canEdit={false} /></div>
        ) : p.cover ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.cover} alt={p.name} className="t-cover" />
            {p.more > 0 && (
              <a href={`#unlock-${p.id}`} className="t-more">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.cover} alt="" aria-hidden className="t-blur" />
                <span>+{p.more} more photo{p.more === 1 ? '' : 's'}</span>
              </a>
            )}
          </>
        ) : <div className="t-cover t-empty">{p.name.slice(0, 1)}</div>}
        {p.status && <span className="t-badge">{p.status}</span>}
      </div>

      <div className="pub-body">
        <h2 className="t-name">{p.name}</h2>
        <div className="hint">{[p.location, p.developer].filter(Boolean).join(' · ')}</div>
        {buzz >= 3 && <div className="t-buzz">{buzz} people asked about this project in the last 30 days</div>}
        {p.status && statusLine[p.status] && <div className="t-why">✓ {statusLine[p.status]}</div>}
        <dl className="facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={k === 'RERA' ? 'mono small' : k === 'Starting price' ? 't-price' : ''}>{v}</dd></div>)}</dl>
        {p.highlights && <p>{p.highlights}</p>}
        {p.amenities && <div className="amen">{p.amenities.split(/[,•\n]+/).map((a) => a.trim()).filter(Boolean).slice(0, 12).map((a) => <span key={a}>{a}</span>)}</div>}

        {!full ? (
          <div className="t-lock" id={`unlock-${p.id}`}>
            <b>Unlock the full details, free</b>
            <ul>{lockedItems.map((x) => <li key={x}>{x}</li>)}</ul>
            {mode === 'project' ? (
              <form action={action} className="stack">
                <input type="hidden" name="token" value={token} />
                <input name="name" required minLength={2} maxLength={120} placeholder="Your name" autoComplete="name" aria-label="Your name" />
                <PhoneInput required />
                {state?.error && <p className="msg err" role="alert">{state.error}</p>}
                <Send label="Show me the full details" />
                <p className="hint center">We also send the price list on WhatsApp. No spam.</p>
              </form>
            ) : (
              <>
                <button className="btn primary block" disabled={busy} onClick={oneTap}>{busy ? 'Opening…' : 'Show me the full details'}</button>
                {err && <p className="msg err">{err}</p>}
              </>
            )}
          </div>
        ) : (
          <div className="t-open">
            <p className="msg ok">
              {mode === 'project'
                ? 'Unlocked! Our team will also WhatsApp you the price list and floor plans.'
                : `Unlocked! ${advisor ? advisor.split(' ')[0] : 'Your advisor'} will send the price list and floor plans on WhatsApp.`}
            </p>
            {full.files_locked && <p className="msg">The brochure and floor plans open here right after your first call with {advisor ? advisor.split(' ')[0] : 'our team'}. We will call you soon.</p>}
            {p.payment_plan && <div><b className="small-h">Payment plan</b><p style={{ whiteSpace: 'pre-line', margin: '4px 0 0' }}>{p.payment_plan}</p></div>}
            {full.floor_plans.length > 0 && <ProjectPlans projectId={p.id} orgId="" plans={full.floor_plans} canEdit={false} hasPdf={false} />}
            {full.link && <a className="btn sm" href={/^https?:\/\//.test(full.link) ? full.link : 'https://' + full.link} target="_blank" rel="noopener noreferrer">Open brochure / floor plans</a>}
          </div>
        )}

        {near.length > 0 && (
          <div>
            <b className="small-h">What is nearby</b>
            <ul className="near">{near.map((n) => <li key={n.k}><span className="lm sm" data-k={n.k}>{KIND_ICON[n.k]}</span><span className="grow">{n.n}</span><b className="mono">~{fmtKm(n.km)}</b></li>)}</ul>
          </div>
        )}
        {p.lat != null && p.lng != null && <div className="row-btns"><a className="btn sm ghost" href={directionsUrl(p.lat, p.lng)} target="_blank" rel="noopener noreferrer">Get directions</a></div>}
        {children}
      </div>
    </article>
  );
}
