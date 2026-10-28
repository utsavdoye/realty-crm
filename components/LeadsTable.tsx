'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bulkLeads } from '@/app/lead-actions';
import { StatusPopup, outcomeLabel } from '@/components/StatusPopup';
import { SCORES, STATUS_LIST, fmtDT, fuState, fuText, stageChip, stageLabel, waLink } from '@/lib/crm';

export type LeadRow = {
  id: string; name: string; phone: string; phoneText: string; req: string; stage: string; score: string; source: string | null;
  project: string | null; agent: string | null; next_follow_up: string | null; last_outcome: string | null; last_outcome_at: string | null;
  last_activity_at: string | null; created_at: string;
};

const COLS = [
  { k: 'req', l: 'Looking for' }, { k: 'status', l: 'Status' }, { k: 'call', l: 'Last call' }, { k: 'interest', l: 'Interest' },
  { k: 'source', l: 'Source' }, { k: 'project', l: 'Project' }, { k: 'agent', l: 'Assigned to' }, { k: 'fu', l: 'Next follow-up' },
  { k: 'touched', l: 'Last updated' }, { k: 'created', l: 'Came in' },
] as const;
type Col = (typeof COLS)[number]['k'];
const DEFAULT: Col[] = ['req', 'status', 'call', 'source', 'agent', 'fu', 'touched'];
const KEY = 'ed_lead_cols';
const ago = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24); return d < 30 ? `${d} day${d === 1 ? '' : 's'} ago` : fmtDT(iso);
};

export function LeadsTable({ rows, agents, role, voice }: { rows: LeadRow[]; agents: { id: string; name: string }[]; role: string; voice: boolean }) {
  const router = useRouter();
  const mgr = role === 'owner' || role === 'manager';
  const [cols, setCols] = useState<Col[]>(DEFAULT);
  const [pickOpen, setPickOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [popup, setPopup] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (Array.isArray(v)) setCols(v.filter((c: string) => COLS.some((x) => x.k === c))); } catch { /* defaults */ } }, []);
  const saveCols = (c: Col[]) => { setCols(c); try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ } };
  const show = useMemo(() => COLS.filter((c) => cols.includes(c.k) && (c.k !== 'agent' || mgr)), [cols, mgr]);
  useEffect(() => { setSel(new Set()); }, [rows]);

  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const run = (op: 'assign' | 'score' | 'stage' | 'delete', value: string) => start(async () => {
    const r = await bulkLeads([...sel], op, value).catch(() => ({ error: 'Could not reach the server.' }));
    setMsg(r); if (!r.error) { setSel(new Set()); router.refresh(); }
  });

  const cell = (r: LeadRow, k: Col) => {
    const closed = ['booked', 'lost'].includes(r.stage);
    switch (k) {
      case 'req': return <span className="hint">{r.req || 'Requirement not filled'}</span>;
      case 'status': return <span className={`chip ${stageChip(r.stage)}`}>{stageLabel(r.stage)}</span>;
      case 'call': return r.last_outcome ? <span className={`chip oc-${r.last_outcome}`} title={r.last_outcome_at ? fmtDT(r.last_outcome_at) : ''}>{outcomeLabel(r.last_outcome)}</span> : <span className="hint">—</span>;
      case 'interest': return <span><span className={`dot ${r.score}`} />{SCORES.find((s) => s.k === r.score)?.l ?? r.score}</span>;
      case 'source': return <span className="hint">{r.source ?? ''}</span>;
      case 'project': return <span className="hint">{r.project ?? ''}</span>;
      case 'agent': return <span className="hint">{r.agent ?? 'Not assigned'}</span>;
      case 'fu': { const fs = fuState(r.next_follow_up); return <span className={`fu ${closed ? '' : fs}`}>{closed ? '' : fs ? fuText(r.next_follow_up) : 'No next step'}</span>; }
      case 'touched': return <span className="hint" title={r.last_activity_at ? fmtDT(r.last_activity_at) : ''}>{ago(r.last_activity_at || r.created_at)}</span>;
      case 'created': return <span className="hint">{fmtDT(r.created_at)}</span>;
    }
  };

  return (
    <>
      <div className="lt-bar">
        {sel.size > 0 ? (
          <div className="lt-bulk">
            <b>{sel.size} selected</b>
            {role === 'owner' && (
              <select defaultValue="" disabled={pending} onChange={(e) => { if (e.target.value) run('assign', e.target.value); e.target.value = ''; }} aria-label="Assign to">
                <option value="">Assign to…</option><option value="none">Nobody</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <select defaultValue="" disabled={pending} onChange={(e) => { if (e.target.value) run('stage', e.target.value); e.target.value = ''; }} aria-label="Change status">
              <option value="">Change status…</option>{STATUS_LIST.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}
            </select>
            <select defaultValue="" disabled={pending} onChange={(e) => { if (e.target.value) run('score', e.target.value); e.target.value = ''; }} aria-label="Change interest">
              <option value="">Interest…</option>{SCORES.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}
            </select>
            {mgr && <button type="button" className="btn sm ghost danger" disabled={pending} onClick={() => { if (confirm(`Delete ${sel.size} lead(s)? The admin can bring them back.`)) run('delete', ''); }}>Delete</button>}
            <button type="button" className="btn sm ghost" onClick={() => setSel(new Set())}>Clear</button>
          </div>
        ) : <span className="hint">Tick leads to assign, change status or delete many at once.</span>}
        <div className="lt-cols">
          <button type="button" className="btn sm" onClick={() => setPickOpen((x) => !x)} aria-expanded={pickOpen}>Columns</button>
          {pickOpen && (
            <div className="lt-pick" role="menu">
              {COLS.filter((c) => c.k !== 'agent' || mgr).map((c) => (
                <label key={c.k} className="check"><input type="checkbox" checked={cols.includes(c.k)} onChange={(e) => saveCols(e.target.checked ? [...cols, c.k] : cols.filter((x) => x !== c.k))} />{c.l}</label>
              ))}
              <button type="button" className="linkbtn" onClick={() => saveCols(DEFAULT)}>Reset</button>
            </div>
          )}
        </div>
      </div>
      {msg?.error && <p className="msg err">{msg.error}</p>}
      {msg?.ok && <p className="msg ok">{msg.ok}</p>}

      <div className="lt-wrap">
        <table className="lt">
          <thead>
            <tr>
              <th className="lt-ck"><input type="checkbox" aria-label="Select all on this page" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <th>Lead</th>
              {show.map((c) => <th key={c.k}>{c.l}</th>)}
              <th className="lt-act">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={sel.has(r.id) ? 'on' : ''}>
                <td className="lt-ck"><input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="lt-name"><Link href={`/leads/${r.id}`}><b><span className={`dot ${r.score}`} />{r.name}</b></Link><span className="hint mono">{r.phoneText}</span></td>
                {show.map((c) => <td key={c.k}>{cell(r, c.k)}</td>)}
                <td className="lt-act">
                  <a className="ic" href={`tel:${r.phone}`} title="Call" aria-label={`Call ${r.name}`}>📞</a>
                  <a className="ic" href={waLink(r.phone)} target="_blank" rel="noopener noreferrer" title="WhatsApp" aria-label={`WhatsApp ${r.name}`}>💬</a>
                  <button type="button" className="btn sm" onClick={() => setPopup(r.id)}>Update</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <StatusPopup leadId={popup} onClose={() => setPopup(null)} voice={voice} />
    </>
  );
}
