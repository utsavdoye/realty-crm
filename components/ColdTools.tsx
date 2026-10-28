'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignCold, coldResult, deleteCold, importCold } from '@/app/cold-actions';
import { parseCSV } from '@/components/ImportLeads';
import { fmtDT, toLocalInput, waLink } from '@/lib/crm';

const pick = (heads: string[], words: string[]) => heads.findIndex((h) => words.some((w) => h.toLowerCase().includes(w)));

export function ColdImport({ agents }: { agents: { id: string; name: string }[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<{ name: string; phone: string; area: string; note: string }[]>([]);
  const [list, setList] = useState('');
  const [assign, setAssign] = useState('split');
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  async function read(f: File) {
    setMsg(null);
    try {
      let g: string[][];
      if (/\.xlsx$/i.test(f.name)) { const x = (await import('read-excel-file')).default; g = (await x(f)).map((r) => r.map((c) => (c == null ? '' : String(c)))); }
      else g = parseCSV((await f.text()).replace(/^﻿/, ''));
      g = g.filter((r) => r.some((c) => String(c).trim()));
      const h = g[0] ?? [];
      const ph = pick(h, ['mobile', 'phone', 'number', 'contact', 'whatsapp']);
      if (ph < 0) { setMsg({ error: 'Could not find a mobile / phone column. The first row must have headings.' }); return; }
      const nm = pick(h, ['name', 'client', 'customer']), ar = pick(h, ['area', 'location', 'city', 'locality', 'address']), nt = pick(h, ['note', 'remark', 'comment']);
      setRows(g.slice(1).map((r) => ({ phone: r[ph] ?? '', name: nm >= 0 ? r[nm] ?? '' : '', area: ar >= 0 ? r[ar] ?? '' : '', note: nt >= 0 ? r[nt] ?? '' : '' })));
      if (!list) setList(f.name.replace(/\.(xlsx|csv|txt)$/i, '').slice(0, 80));
    } catch { setMsg({ error: 'Could not read this file. Save it as .xlsx or .csv and try again.' }); }
  }
  return (
    <div className="stack">
      <div className="grid2f">
        <label className="field"><span className="label">File (Excel .xlsx or CSV, first row = headings)</span><input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }} /></label>
        <label className="field"><span className="label">List name</span><input value={list} onChange={(e) => setList(e.target.value)} maxLength={80} placeholder="e.g. Shankar Nagar society list" /></label>
        <label className="field"><span className="label">Give the numbers to</span>
          <select value={assign} onChange={(e) => setAssign(e.target.value)}><option value="split">Split among all agents and interns</option><option value="">Nobody yet</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </label>
      </div>
      {rows.length > 0 && <p className="hint">{rows.length} rows read. Numbers already in Leads or in another list are skipped.</p>}
      <div><button type="button" className="btn primary" disabled={!rows.length || pending} onClick={() => start(async () => { const r = await importCold(rows, list, assign).catch(() => ({ error: 'Could not upload.' })); setMsg(r); if (!r.error) { setRows([]); router.refresh(); } })}>{pending ? 'Uploading…' : 'Upload numbers'}</button></div>
      {msg?.error && <p className="msg err">{msg.error}</p>}
      {msg?.ok && <p className="msg ok">{msg.ok}</p>}
    </div>
  );
}

export type ColdRow = { id: string; name: string | null; phone: string; phoneText: string; area: string | null; note: string | null; list: string; status: string; attempts: number; called_at: string | null; callback_at: string | null; lead_id: string | null; agent: string | null };
const ST: Record<string, [string, string]> = { new: ['Not called', ''], noanswer: ['No answer', 'tape'], callback: ['Call back', 'acc'], interested: ['Interested', 'good'], notint: ['Not interested', 'bad'], wrong: ['Wrong number', 'bad'] };

export function ColdList({ rows, agents, mgr }: { rows: ColdRow[]; agents: { id: string; name: string }[]; mgr: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [cb, setCb] = useState(() => toLocalInput(new Date(Date.now() + 24 * 3600000).toISOString()));
  const [msg, setMsg] = useState<{ ok?: string; error?: string; leadId?: string } | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok?: string; error?: string; leadId?: string }>) => start(async () => { const r = await fn().catch(() => ({ error: 'Could not reach the server.' })); setMsg(r); if (!r.error) { setOpen(null); setNote(''); setSel(new Set()); router.refresh(); } });
  return (
    <>
      {mgr && sel.size > 0 && (
        <div className="lt-bulk" style={{ padding: '10px 14px' }}>
          <b>{sel.size} selected</b>
          <select defaultValue="" onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) act(() => assignCold([...sel], v === 'none' ? '' : v)); }}><option value="">Give to…</option><option value="none">Nobody</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <button type="button" className="btn sm ghost danger" onClick={() => { if (confirm(`Remove ${sel.size} number(s)?`)) act(() => deleteCold([...sel])); }}>Remove</button>
        </div>
      )}
      {msg?.error && <p className="msg err">{msg.error}</p>}
      {msg?.ok && <p className="msg ok">{msg.ok} {msg.leadId && <Link href={`/leads/${msg.leadId}`}>Open the lead →</Link>}</p>}
      <div className="lt-wrap"><table className="lt">
        <thead><tr>{mgr && <th className="lt-ck"><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && rows.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}<th>Contact</th><th>Area / note</th><th>Result</th>{mgr && <th>Caller</th>}<th className="lt-act">Call</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            {mgr && <td className="lt-ck"><input type="checkbox" checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} aria-label="Select" /></td>}
            <td className="lt-name"><b>{r.name || 'No name'}</b><span className="hint mono">{r.phoneText}</span><span className="hint">{r.list}</span></td>
            <td className="hint">{[r.area, r.note].filter(Boolean).join(' · ')}</td>
            <td><span className={`chip ${ST[r.status]?.[1] ?? ''}`}>{ST[r.status]?.[0] ?? r.status}</span>{r.attempts > 0 && <span className="hint"> · {r.attempts} call{r.attempts === 1 ? '' : 's'}</span>}{r.callback_at && ['callback', 'noanswer'].includes(r.status) && <div className="hint">Call {fmtDT(r.callback_at)}</div>}{r.lead_id && <div><Link href={`/leads/${r.lead_id}`}>Open lead</Link></div>}</td>
            {mgr && <td className="hint">{r.agent ?? '—'}</td>}
            <td className="lt-act">
              <a className="ic" href={`tel:${r.phone}`} aria-label="Call">📞</a>
              <a className="ic" href={waLink(r.phone)} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">💬</a>
              {!r.lead_id && <button type="button" className="btn sm" onClick={() => { setOpen(open === r.id ? null : r.id); setMsg(null); }}>Result</button>}
              {open === r.id && (
                <div className="cold-pop">
                  <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did they say? (optional)" />
                  <label className="field"><span className="label">Call back at</span><input type="datetime-local" value={cb} onChange={(e) => setCb(e.target.value)} /></label>
                  <div className="row-btns">
                    <button type="button" className="btn sm" disabled={pending} onClick={() => act(() => coldResult(r.id, 'noanswer', note))}>No answer</button>
                    <button type="button" className="btn sm" disabled={pending} onClick={() => act(() => coldResult(r.id, 'callback', note, new Date(cb).toISOString()))}>Call back</button>
                    <button type="button" className="btn sm primary" disabled={pending} onClick={() => act(() => coldResult(r.id, 'interested', note))}>Interested → make lead</button>
                    <button type="button" className="btn sm ghost" disabled={pending} onClick={() => act(() => coldResult(r.id, 'notint', note))}>Not interested</button>
                    <button type="button" className="btn sm ghost" disabled={pending} onClick={() => act(() => coldResult(r.id, 'wrong', note))}>Wrong number</button>
                  </div>
                </div>
              )}
            </td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}
