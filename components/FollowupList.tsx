'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteFollowup, finishFollowup, moveFollowup } from '@/app/lead-actions';
import { StatusPopup } from '@/components/StatusPopup';
import { fmtDT, waLink } from '@/lib/crm';

export type FuRow = { id: string; leadId: string; leadName: string; phone: string; title: string; kind: string; due_at: string; done_at: string | null; agent: string | null; isTask: boolean };
const KIND: Record<string, string> = { call: 'Call', meeting: 'Meeting', visit: 'Site visit', whatsapp: 'WhatsApp', documents: 'Documents', payment: 'Payment', other: 'Other' };

export function FollowupList({ rows, voice, showAgent }: { rows: FuRow[]; voice: boolean; showAgent: boolean }) {
  const router = useRouter();
  const [popup, setPopup] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const act = (fn: () => Promise<{ ok?: string; error?: string }>) => start(async () => { const r = await fn().catch(() => ({ error: 'Could not reach the server.' })); setMsg(r.error ?? ''); router.refresh(); });
  const tomorrow = (iso: string) => { const d = new Date(Math.max(Date.now(), Date.parse(iso))); d.setDate(d.getDate() + 1); return d.toISOString(); };

  if (!rows.length) return <p className="empty">Nothing here.</p>;
  return (
    <>
      {msg && <p className="msg err">{msg}</p>}
      <div className="rows">
        {rows.map((r) => {
          const over = !r.done_at && Date.parse(r.due_at) < Date.now();
          return (
            <div key={`${r.isTask ? 't' : 'l'}-${r.id}`} className={`fu-row ${over ? 'over' : ''} ${r.done_at ? 'done' : ''}`}>
              <span className={`chip ${r.isTask ? 'acc' : ''}`}>{r.isTask ? KIND[r.kind] ?? r.kind : 'Call back'}</span>
              <span className="fu-main">
                <b>{r.isTask ? r.title : 'Next call'}</b>
                <span className="hint"><Link href={`/leads/${r.leadId}`}>{r.leadName}</Link>{showAgent && r.agent ? ` · ${r.agent}` : ''}</span>
              </span>
              <span className={`fu-when ${over ? 'fu over' : ''}`}>{r.done_at ? `Done ${fmtDT(r.done_at)}` : fmtDT(r.due_at)}</span>
              <span className="row-btns">
                <a className="btn sm ghost" href={`tel:${r.phone}`} aria-label={`Call ${r.leadName}`}>📞</a>
                <a className="btn sm ghost" href={waLink(r.phone)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${r.leadName}`}>💬</a>
                <button type="button" className="btn sm" onClick={() => setPopup(r.leadId)}>Update</button>
                {r.isTask && !r.done_at && <>
                  <button type="button" className="btn sm" disabled={pending} onClick={() => act(() => finishFollowup(r.id))}>Done</button>
                  <button type="button" className="btn sm ghost" disabled={pending} onClick={() => act(() => moveFollowup(r.id, tomorrow(r.due_at)))}>+1 day</button>
                  <button type="button" className="btn sm ghost danger" disabled={pending} aria-label="Remove" onClick={() => { if (confirm('Remove this follow-up?')) act(() => deleteFollowup(r.id)); }}>✕</button>
                </>}
              </span>
            </div>
          );
        })}
      </div>
      <StatusPopup leadId={popup} onClose={() => setPopup(null)} voice={voice} />
    </>
  );
}
