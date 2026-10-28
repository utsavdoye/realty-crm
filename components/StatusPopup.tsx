'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogCallForm } from '@/components/LogCallForm';
import { addFollowup, finishFollowup, leadPopup, type PopupData } from '@/app/lead-actions';
import { OUTCOMES, fmtDT, stageLabel, toLocalInput } from '@/lib/crm';

const KINDS = [['call', 'Call'], ['meeting', 'Meeting'], ['visit', 'Site visit'], ['whatsapp', 'WhatsApp'], ['documents', 'Documents'], ['payment', 'Payment'], ['other', 'Other']] as const;
export const outcomeLabel = (k?: string | null) => (k ? OUTCOMES.find((o) => o.k === k)?.l ?? k : '');

/** One popup for after every call: what happened, comment (or voice), next follow-up, lost — with the lead's history. */
export function StatusPopup({ leadId, onClose, voice = false }: { leadId: string | null; onClose: () => void; voice?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [data, setData] = useState<PopupData | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'call' | 'task'>('call');

  const load = useCallback(async (id: string) => {
    const r = await leadPopup(id).catch(() => ({ error: 'Could not load. Check your internet.' }));
    if ('error' in r) { setErr(r.error); setData(null); } else { setErr(''); setData(r); }
  }, []);

  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (leadId) { setData(null); setErr(''); setTab('call'); load(leadId); if (!d.open) d.showModal(); }
    else if (d.open) d.close();
  }, [leadId, load]);

  const saved = () => { if (leadId) load(leadId); router.refresh(); };

  return (
    <dialog ref={ref} className="sp-dialog" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div className="sp-shell">
        <header className="sp-head">
          <div>
            <h2>{data ? data.lead.name : 'Update status'}</h2>
            {data && <p className="hint">{stageLabel(data.lead.stage)}{data.lead.last_outcome ? ` · last call: ${outcomeLabel(data.lead.last_outcome)}` : ''}{data.lead.next_follow_up ? ` · next: ${fmtDT(data.lead.next_follow_up)}` : ''}</p>}
          </div>
          <button type="button" className="btn sm ghost" aria-label="Close" onClick={() => ref.current?.close()}>✕</button>
        </header>
        {err && <p className="msg err">{err}</p>}
        {!data && !err && <p className="hint" style={{ padding: 16 }}>Loading…</p>}
        {data && (
          <div className="sp-body">
            <div className="seg seg-sm" role="tablist">
              <button type="button" className={tab === 'call' ? 'on' : ''} onClick={() => setTab('call')}>Call result</button>
              <button type="button" className={tab === 'task' ? 'on' : ''} onClick={() => setTab('task')}>Add follow-up</button>
            </div>
            {tab === 'call'
              ? <LogCallForm key={data.lead.id} leadId={data.lead.id} voice={voice} onSaved={saved} />
              : <TaskForm leadId={data.lead.id} onSaved={saved} />}

            {data.followups.length > 0 && (
              <section className="sp-sec">
                <h3>Open follow-ups</h3>
                {data.followups.map((f) => (
                  <div key={f.id} className={`sp-fu ${Date.parse(f.due_at) < Date.now() ? 'over' : ''}`}>
                    <span><b>{f.title}</b><span className="hint"> · {fmtDT(f.due_at)}</span></span>
                    <button type="button" className="btn sm" onClick={async () => { await finishFollowup(f.id); saved(); }}>Done</button>
                  </div>
                ))}
              </section>
            )}

            <section className="sp-sec">
              <h3>Lead history</h3>
              {!data.history.length && <p className="hint">Nothing yet.</p>}
              <ol className="sp-hist">
                {data.history.map((h) => (
                  <li key={h.id} className={`t-${h.type}`}>
                    <span className="sp-body-text">{h.body}</span>
                    <span className="hint">{h.by} · {fmtDT(h.at)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </div>
    </dialog>
  );
}

export function TaskForm({ leadId, onSaved }: { leadId: string; onSaved: () => void }) {
  const [kind, setKind] = useState('call');
  const [title, setTitle] = useState('');
  const [at, setAt] = useState(() => toLocalInput(new Date(Date.now() + 24 * 3600000).toISOString()));
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      const r = await addFollowup({ leadId, kind, title, dueAt: new Date(at).toISOString(), note }).catch(() => ({ error: 'Could not save.' }));
      setBusy(false); setMsg(r);
      if (!r.error) { setTitle(''); setNote(''); onSaved(); }
    }}>
      <div className="pick" role="radiogroup" aria-label="Type">
        {KINDS.map(([k, l]) => <label key={k} className={`pickopt ${kind === k ? 'on' : ''}`}><input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />{l}</label>)}
      </div>
      <div className="grid2f">
        <label className="field"><span className="label">What</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Send floor plans, collect PAN" maxLength={200} /></label>
        <label className="field"><span className="label">When</span><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required /></label>
      </div>
      <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={2000} />
      <div><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save follow-up'}</button></div>
      {msg?.error && <p className="msg err">{msg.error}</p>}
      {msg?.ok && <p className="msg ok">{msg.ok}</p>}
    </form>
  );
}
