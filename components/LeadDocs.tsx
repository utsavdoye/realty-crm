'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { deleteLeadDoc, leadDocLink, saveLeadDoc } from '@/app/lead-actions';
import { DOC_KINDS, fmtDT } from '@/lib/crm';

export type Doc = { id: string; kind: string; name: string; size_bytes: number | null; created_at: string; by: string | null; mine: boolean };
const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const kb = (n: number | null) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** PAN, Aadhaar, agreement, cheque photos… kept private. Only people who can see this lead can open them. */
export function LeadDocs({ orgId, leadId, items, canDeleteAll }: { orgId: string; leadId: string; items: Doc[]; canDeleteAll: boolean }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState('PAN');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setMsg(null);
    const supabase = createClient();
    let done = 0;
    for (const f of Array.from(files).slice(0, 10)) {
      if (!OK_TYPES.includes(f.type)) { setMsg({ error: `${f.name}: only PDF or photo (JPG, PNG, WEBP).` }); continue; }
      if (f.size > 10 * 1048576) { setMsg({ error: `${f.name} is bigger than 10 MB.` }); continue; }
      setBusy(`Uploading ${f.name}…`);
      const safe = f.name.replace(/[^\w.\-]+/g, '_').slice(-80);
      const path = `${orgId}/${leadId}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from('lead-docs').upload(path, f, { contentType: f.type });
      if (error) { setMsg({ error: /bucket/i.test(error.message) ? 'Run supabase/patch-045-attendance-cold-docs.sql in Supabase first.' : `Could not upload ${f.name}.` }); continue; }
      const r = await saveLeadDoc({ leadId, path, name: f.name, kind, size: f.size }).catch(() => ({ error: 'Could not save.' }));
      if (r.error) setMsg(r); else done++;
    }
    setBusy('');
    if (file.current) file.current.value = '';
    if (done) { setMsg((m) => m?.error ? m : { ok: done === 1 ? 'Saved.' : `${done} files saved.` }); router.refresh(); }
  }

  async function open(id: string) {
    const w = window.open('', '_blank');
    const r = await leadDocLink(id);
    if (r.url) { if (w) w.location.href = r.url; else window.location.href = r.url; }
    else { w?.close(); setMsg({ error: r.error ?? 'Could not open.' }); }
  }

  return (
    <div className="stack">
      {!items.length && <p className="hint">No documents yet.</p>}
      {items.length > 0 && (
        <ul className="doc-list">
          {items.map((d) => (
            <li key={d.id}>
              <span className="chip">{d.kind}</span>
              <button type="button" className="linkbtn" onClick={() => open(d.id)}>{d.name}</button>
              <span className="hint">{[kb(d.size_bytes), d.by, fmtDT(d.created_at)].filter(Boolean).join(' · ')}</span>
              {(canDeleteAll || d.mine) && (
                <button type="button" className="btn sm ghost" disabled={!!busy} onClick={async () => {
                  if (!confirm(`Remove ${d.name}?`)) return;
                  setBusy('Removing…'); const r = await deleteLeadDoc(d.id).catch(() => ({ error: 'Could not remove.' })); setBusy(''); setMsg(r); if (!r.error) router.refresh();
                }}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="row-btns">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Document type">{DOC_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <label className="btn sm">
          {busy || 'Add file'}
          <input ref={file} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple hidden disabled={!!busy} onChange={(e) => upload(e.target.files)} />
        </label>
      </div>
      <p className="hint">PDF or photo, up to 10 MB. Files are private: only people who can see this client can open them.</p>
      {msg?.error && <p className="msg err">{msg.error}</p>}
      {msg?.ok && <p className="msg ok">{msg.ok}</p>}
    </div>
  );
}
