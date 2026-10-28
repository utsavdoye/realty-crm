'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addOwned, deleteFollowup, deleteOwned, finishFollowup, moveFollowup } from '@/app/lead-actions';
import { StatusPopup, TaskForm } from '@/components/StatusPopup';
import { fmtDT, fmtL } from '@/lib/crm';

/** "Update status" button for the lead page header. */
export function UpdateStatusButton({ leadId, voice }: { leadId: string; voice: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (<><button type="button" className="btn primary" onClick={() => setOpen(leadId)}>Update status</button><StatusPopup leadId={open} onClose={() => setOpen(null)} voice={voice} /></>);
}

type Fu = { id: string; title: string; kind: string; due_at: string; done_at: string | null; agent: string | null };
export function LeadFollowups({ leadId, items, canEdit }: { leadId: string; items: Fu[]; canEdit: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<unknown>) => start(async () => { await fn().catch(() => null); router.refresh(); });
  const open = items.filter((f) => !f.done_at), done = items.filter((f) => f.done_at).slice(0, 5);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {!open.length && <p className="hint">No open follow-ups.</p>}
      {open.map((f) => {
        const over = Date.parse(f.due_at) < Date.now();
        return (
          <div key={f.id} className={`lf-item ${over ? 'over' : ''}`}>
            {over && <span className="chip bad">Overdue</span>}
            <b>{f.title}</b>
            <span className="hint">{fmtDT(f.due_at)}{f.agent ? ` · ${f.agent}` : ''}</span>
            {canEdit && (
              <span className="row-btns">
                <button type="button" className="btn sm" disabled={pending} onClick={() => act(() => finishFollowup(f.id))}>Done</button>
                <button type="button" className="btn sm ghost" disabled={pending} onClick={() => { const d = new Date(Math.max(Date.now(), Date.parse(f.due_at))); d.setDate(d.getDate() + 1); act(() => moveFollowup(f.id, d.toISOString())); }}>+1 day</button>
                <button type="button" className="btn sm ghost danger" disabled={pending} aria-label="Remove" onClick={() => { if (confirm('Remove this follow-up?')) act(() => deleteFollowup(f.id)); }}>✕</button>
              </span>
            )}
          </div>
        );
      })}
      {done.map((f) => <div key={f.id} className="lf-item done"><span className="chip good">Done</span><s>{f.title}</s><span className="hint">{fmtDT(f.done_at)}</span></div>)}
      {canEdit && (adding ? <TaskForm leadId={leadId} onSaved={() => { setAdding(false); router.refresh(); }} /> : <div><button type="button" className="btn sm" onClick={() => setAdding(true)}>+ New follow-up</button></div>)}
    </div>
  );
}

type Owned = { id: string; title: string; location: string | null; size_sqft: number | null; price_l: number | null; for_what: string; notes: string | null };
export function OwnedProperties({ leadId, items, canEdit }: { leadId: string; items: Owned[]; canEdit: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="stack" style={{ gap: 8 }}>
      {!items.length && !adding && <p className="hint">No properties owned or linked yet.</p>}
      {items.map((o) => (
        <div key={o.id} className="lf-item">
          <span className="chip">{o.for_what}</span><b>{o.title}</b>
          <span className="hint">{[o.location, o.size_sqft ? `${o.size_sqft.toLocaleString('en-IN')} sq ft` : '', o.price_l ? fmtL(o.price_l) : ''].filter(Boolean).join(' · ')}</span>
          {o.notes && <span className="hint">{o.notes}</span>}
          {canEdit && <span className="row-btns"><button type="button" className="btn sm ghost danger" disabled={pending} onClick={() => { if (confirm('Remove this property?')) start(async () => { await deleteOwned(o.id); router.refresh(); }); }}>Remove</button></span>}
        </div>
      ))}
      {canEdit && (adding ? (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault(); const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await addOwned({ leadId, title: String(fd.get('title')), location: String(fd.get('location')), size: String(fd.get('size')), price: String(fd.get('price')), forWhat: String(fd.get('for')), notes: String(fd.get('notes')) }).catch(() => ({ error: 'Could not save.' }));
            if (r.error) setMsg(r.error); else { setMsg(''); setAdding(false); router.refresh(); }
          });
        }}>
          <div className="grid2f">
            <label className="field"><span className="label">Property</span><input name="title" required maxLength={160} placeholder="e.g. 3 BHK flat, Avinash Capital Homes" /></label>
            <label className="field"><span className="label">Area</span><input name="location" maxLength={200} placeholder="e.g. Shankar Nagar" /></label>
            <label className="field"><span className="label">Size (sq ft)</span><input name="size" type="number" min={0} /></label>
            <label className="field"><span className="label">Expected price (lakh)</span><input name="price" type="number" min={0} step="0.5" /></label>
            <label className="field"><span className="label">Wants to</span><select name="for" defaultValue="Sell"><option>Sell</option><option>Rent out</option><option>Just owns</option></select></label>
            <label className="field"><span className="label">Note</span><input name="notes" maxLength={1000} /></label>
          </div>
          <div className="row-btns"><button className="btn sm primary" disabled={pending}>Save</button><button type="button" className="btn sm ghost" onClick={() => setAdding(false)}>Cancel</button></div>
          {msg && <p className="msg err">{msg}</p>}
        </form>
      ) : <div><button type="button" className="btn sm" onClick={() => setAdding(true)}>+ Link a property</button></div>)}
    </div>
  );
}

/** Timeline with tabs: everything, calls, notes, status changes, visits, WhatsApp. */
export function TimelineTabs({ children, counts }: { children: React.ReactNode; counts: Record<string, number> }) {
  const [tab, setTab] = useState('all');
  const TABS: [string, string][] = [['all', 'All'], ['call', 'Calls'], ['note', 'Notes'], ['stage', 'Status'], ['visit', 'Visits'], ['whatsapp', 'WhatsApp']];
  return (
    <div className={`tl-tabs show-${tab}`}>
      <div className="seg seg-sm" role="tablist" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        {TABS.filter(([k]) => k === 'all' || counts[k]).map(([k, l]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{k !== 'all' ? ` (${counts[k]})` : ''}</button>)}
      </div>
      {children}
    </div>
  );
}
