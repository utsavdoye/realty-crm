'use client';

import { useState } from 'react';
import { createShortlist } from '@/app/crm-actions';
import { ShareButtons } from '@/components/ShareButtons';
import { fmtL, fmtDT } from '@/lib/crm';

type P = { id: string; name: string; location: string | null; price_from: number | null; price_to: number | null; configs: string | null; match: boolean };
type S = { id: string; token: string; project_ids: string[]; views: number; last_viewed_at: string | null; reactions: Record<string, string>; created_at: string };

const R_LABEL: Record<string, string> = { like: '♥ liked', no: 'not for me', visit: 'wants visit' };

export function ShortlistPanel({ leadId, firstName, phone, projects, past, base }: { leadId: string; firstName: string; phone: string; projects: P[]; past: S[]; base: string }) {
  const [sel, setSel] = useState<string[]>(projects.filter((p) => p.match).slice(0, 3).map((p) => p.id));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [made, setMade] = useState<string | null>(null);
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));

  async function make() {
    setBusy(true); setErr('');
    const r = await createShortlist(leadId, sel, note);
    setBusy(false);
    if (r.error) setErr(r.error); else setMade(r.token!);
  }

  return (
    <div className="stack">
      {made ? (
        <div className="stack">
          <p className="msg ok">Link ready. Send it to {firstName} on WhatsApp. You will get an alert when they open it.</p>
          <ShareButtons url={`${base}/s/${made}`} text={`Hi ${firstName}, here are some homes I picked for you. Have a look and tap "Book a site visit" on the one you like:`} phone={phone} />
          <button className="btn sm ghost" onClick={() => { setMade(null); setNote(''); }}>Make another</button>
        </div>
      ) : (
        <>
          <p className="hint">Pick up to 8 projects. ★ = matches their budget and need.</p>
          <div className="pick-list">
            {projects.map((p) => (
              <label key={p.id} className={`pick ${sel.includes(p.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={sel.includes(p.id)} disabled={!sel.includes(p.id) && sel.length >= 8}
                  onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                <span className="grow"><b>{p.match ? '★ ' : ''}{p.name}</b><span className="hint"> {[p.location, p.configs, p.price_from ? fmtL(p.price_from) + '+' : ''].filter(Boolean).join(' · ')}</span></span>
              </label>
            ))}
          </div>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder={`Personal note for ${firstName} (optional)`} />
          {err && <p className="msg err">{err}</p>}
          <div><button className="btn sm primary" disabled={busy || !sel.length} onClick={make}>{busy ? 'Making link…' : `Make link with ${sel.length} project${sel.length === 1 ? '' : 's'}`}</button></div>
        </>
      )}
      {past.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <b className="small-h">Sent before</b>
          {past.map((s) => (
            <div key={s.id} className="sl-row">
              <div className="grow">
                <div>{s.project_ids.map((id) => nameOf.get(id) ?? 'Project').join(', ')}</div>
                <div className="hint">
                  Sent {fmtDT(s.created_at)} · {s.views ? `opened ${s.views}× (last ${fmtDT(s.last_viewed_at)})` : 'not opened yet'}
                  {Object.entries(s.reactions ?? {}).map(([pid, r]) => ` · ${nameOf.get(pid) ?? ''}: ${R_LABEL[r] ?? r}`).join('')}
                </div>
              </div>
              <ShareButtons url={`${base}/s/${s.token}`} text={`Hi ${firstName}, here are the homes I picked for you:`} phone={phone} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
