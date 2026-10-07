'use client';

import { useState } from 'react';
import { createShortlist } from '@/app/crm-actions';
import { ShareButtons } from '@/components/ShareButtons';
import { fmtL, fmtDT } from '@/lib/crm';

type P = {
  id: string; name: string; location: string | null; price_from: number | null; price_to: number | null; configs: string | null; match: boolean;
  type?: string | null; status?: string | null; photos?: string[] | null;
};
type S = { id: string; token: string; project_ids: string[]; views: number; last_viewed_at: string | null; reactions: Record<string, string>; created_at: string };

const R_LABEL: Record<string, string> = { like: '♥ liked', no: 'not for me', visit: 'wants a visit', details: 'opened prices' };
const MAX = 8;

const price = (p: P) => (p.price_from ? `${fmtL(p.price_from)}${p.price_to ? ' – ' + fmtL(p.price_to).replace('₹', '') : '+'}` : 'Price on request');

export function ShortlistPanel({ leadId, firstName, phone, projects, past, base }: { leadId: string; firstName: string; phone: string; projects: P[]; past: S[]; base: string }) {
  // Sold-out projects are never picked (they are not even shown in the list).
  const [sel, setSel] = useState<string[]>(projects.filter((p) => p.match && p.status !== 'Sold out').slice(0, 3).map((p) => p.id));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [made, setMade] = useState<string | null>(null);
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  const matches = projects.filter((p) => p.match && p.status !== 'Sold out').map((p) => p.id);
  const live = projects.filter((p) => p.status !== 'Sold out');

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX ? s : [...s, id]));

  async function make() {
    setBusy(true); setErr('');
    const r = await createShortlist(leadId, sel, note);
    setBusy(false);
    if (r.error) setErr(r.error); else setMade(r.token!);
  }

  if (!projects.length) return <p className="hint">Add your projects first (Projects page). Then you can send them to {firstName} in one link.</p>;

  return (
    <div className="sl">
      {made ? (
        <div className="sl-done">
          <div className="sl-done-ic" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <b>Link ready for {firstName}</b>
            <span className="hint">Send it on WhatsApp. You get an alert the moment {firstName} opens it or asks for prices.</span>
          </div>
          <ShareButtons url={`${base}/s/${made}`} text={`Hi ${firstName}, here are some homes I picked for you. Have a look and tap "Book a site visit" on the one you like:`} phone={phone} />
          <button className="btn sm ghost" onClick={() => { setMade(null); setNote(''); }}>Make another link</button>
        </div>
      ) : (
        <>
          <div className="sl-bar">
            <span className="sl-count"><b>{sel.length}</b> of {MAX} picked</span>
            <span className="row-btns">
              {matches.length > 0 && (
                <button type="button" className="btn sm ghost" onClick={() => setSel(matches.slice(0, MAX))}>★ Pick best fits ({Math.min(matches.length, MAX)})</button>
              )}
              {sel.length > 0 && <button type="button" className="btn sm ghost" onClick={() => setSel([])}>Clear</button>}
            </span>
          </div>

          <div className="sl-list" role="group" aria-label="Projects to send">
            {live.map((p) => {
              const on = sel.includes(p.id);
              const full = !on && sel.length >= MAX;
              const img = p.photos?.[0];
              return (
                <label key={p.id} className={`sl-opt ${on ? 'on' : ''} ${full ? 'off' : ''}`}>
                  <input type="checkbox" className="sr-only" checked={on} disabled={full} onChange={() => toggle(p.id)} />
                  <span className="sl-thumb" aria-hidden="true">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {img ? <img src={img} alt="" loading="lazy" /> : <span>{p.name.slice(0, 1)}</span>}
                  </span>
                  <span className="sl-main">
                    <span className="sl-name">{p.name}{p.match && <span className="sl-fit">★ Fits budget</span>}</span>
                    <span className="sl-meta">{[p.location, p.configs, p.status].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="sl-price">{price(p)}</span>
                  <span className="sl-check" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  </span>
                </label>
              );
            })}
          </div>

          <label className="field">
            <span className="label">Personal note (optional)</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder={`e.g. Hi ${firstName}, these fit your 3 BHK budget. Sunrise has a great park view.`} />
          </label>
          {err && <p className="msg err">{err}</p>}
          <button className="btn primary sl-go" disabled={busy || !sel.length} onClick={make}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
            {busy ? 'Making link…' : sel.length ? `Create link with ${sel.length} home${sel.length === 1 ? '' : 's'}` : 'Pick at least one project'}
          </button>
        </>
      )}

      {past.length > 0 && (
        <div className="sl-past">
          <b className="small-h">Sent before</b>
          {past.map((s) => (
            <div key={s.id} className="sl-past-row">
              <div className="grow stack" style={{ gap: 3 }}>
                <b>{s.project_ids.map((id) => nameOf.get(id) ?? 'Project').join(', ')}</b>
                <span className="hint">
                  Sent {fmtDT(s.created_at)}
                  {Object.entries(s.reactions ?? {}).map(([pid, r]) => ` · ${nameOf.get(pid) ?? ''}: ${R_LABEL[r] ?? r}`).join('')}
                </span>
              </div>
              <span className={`chip ${s.views ? 'good' : ''}`}>{s.views ? `Opened ${s.views}×` : 'Not opened'}</span>
              <ShareButtons url={`${base}/s/${s.token}`} text={`Hi ${firstName}, here are the homes I picked for you:`} phone={phone} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
