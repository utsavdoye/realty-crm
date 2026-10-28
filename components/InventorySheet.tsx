'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { autoSyncInventory, setInventoryLink, syncInventoryNow, autoTranslateProjects } from '@/app/crm-actions';

const ago = (iso?: string | null) => {
  if (!iso) return 'not synced yet';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'synced just now';
  if (s < 3600) return `synced ${Math.round(s / 60)} min ago`;
  if (s < 86400) return `synced ${Math.round(s / 3600)} h ago`;
  return `synced ${new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
};

/** "Sync now" for one project's sheet. */
export function SyncButton({ projectId, syncedAt, error, compact = false }: { projectId: string; syncedAt?: string | null; error?: string | null; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  async function go() {
    setBusy(true); setMsg(null);
    const r = await syncInventoryNow(projectId).catch(() => ({ error: 'Could not reach the server. Check your internet.' }));
    setBusy(false); setMsg(r); router.refresh();
  }
  const err = msg?.error ?? (msg?.ok ? null : error);
  return (
    <span className={`inv-sync ${compact ? 'compact' : ''}`}>
      <span className="inv-live"><i aria-hidden="true" />Live sheet · {ago(syncedAt)}</span>
      <button type="button" className="btn sm" onClick={(e) => { e.preventDefault(); go(); }} disabled={busy}>{busy ? 'Syncing…' : 'Sync now'}</button>
      {msg?.ok && !compact && <span className="msg ok">{msg.ok}</span>}
      {err && <span className="msg err">{err}</span>}
    </span>
  );
}

/** The sheet link box on the Inventory page. */
export function InventoryLink({ projectId, link, canEdit }: { projectId: string; link: string; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(link);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  async function save() {
    setBusy(true); setMsg(null);
    const r = await setInventoryLink(projectId, value).catch(() => ({ error: 'Could not reach the server. Check your internet.' }));
    setBusy(false); setMsg(r); router.refresh();
  }
  if (!canEdit) return link ? <p className="hint">Sheet: <a href={link} target="_blank" rel="noopener noreferrer">open the sheet</a></p> : null;
  return (
    <div className="stack">
      <label className="field"><span className="label">Inventory sheet link</span>
        <div className="row-gap">
          <input className="grow" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
          <button type="button" className="btn sm primary" onClick={save} disabled={busy || value.trim() === link}>{busy ? 'Saving…' : value.trim() ? 'Save and sync' : 'Remove link'}</button>
          {link && <a className="btn sm ghost" href={link} target="_blank" rel="noopener noreferrer">Open sheet</a>}
        </div>
        <span className="hint">Google Sheets: Share → General access → &quot;Anyone with the link&quot; → Viewer. Anyone (even outside the company) can keep the sheet updated; the CRM copies it when someone opens the CRM and when you press Sync now.</span>
      </label>
      {msg?.ok && <p className="msg ok">{msg.ok}</p>}
      {msg?.error && <p className="msg err">{msg.error}</p>}
    </div>
  );
}

/** Runs once when someone opens the CRM (and at most every 3 minutes): refreshes all sheet-linked inventories. */
export function InventoryAutoSync() {
  const router = useRouter();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; ran.current = true;
    try { const last = Number(sessionStorage.getItem('ed_inv_sync') || 0); if (Date.now() - last < 3 * 60_000) return; sessionStorage.setItem('ed_inv_sync', String(Date.now())); } catch { /* private mode: still sync */ }
    autoSyncInventory().then((r) => { if (r.changed) router.refresh(); }).catch(() => {});
  }, [router]);
  return null;
}

/** Admin/manager opens the CRM → projects without a Hindi copy get one (for the website's हिंदी mode). */
export function HindiAutoFill() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; ran.current = true;
    try { const last = Number(sessionStorage.getItem('ed_hi_fill') || 0); if (Date.now() - last < 10 * 60_000) return; sessionStorage.setItem('ed_hi_fill', String(Date.now())); } catch { /* still run */ }
    (async () => { for (let i = 0; i < 10; i++) { const r = await autoTranslateProjects().catch(() => null); if (!r || !r.left || !r.done) break; } })();
  }, []);
  return null;
}
