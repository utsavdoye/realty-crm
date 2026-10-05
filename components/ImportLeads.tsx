'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { importLeads, type ImportRow } from '@/app/crm-actions';
import { BHKS, SOURCES, parseBudget } from '@/lib/crm';
import { normPhone, validPhone } from '@/lib/roles';

type Person = { user_id: string; full_name: string };
type Project = { id: string; name: string };

const FIELDS = [
  { k: 'name', l: 'Name', words: ['name', 'customer', 'client', 'lead name', 'full name', 'buyer'] },
  { k: 'phone', l: 'Mobile', words: ['mobile', 'phone', 'contact', 'number', 'whatsapp', 'cell'] },
  { k: 'email', l: 'Email', words: ['email', 'e-mail', 'mail'] },
  { k: 'location', l: 'Area / city', words: ['location', 'city', 'area', 'locality', 'address', 'place'] },
  { k: 'budget', l: 'Budget', words: ['budget', 'price', 'amount', 'range'] },
  { k: 'bhk', l: 'BHK / type', words: ['bhk', 'configuration', 'config', 'unit', 'requirement', 'type'] },
  { k: 'source', l: 'Source', words: ['source', 'portal', 'channel', 'medium', 'campaign'] },
  { k: 'note', l: 'Notes', words: ['note', 'remark', 'comment', 'message', 'feedback', 'query'] },
] as const;
type FieldKey = (typeof FIELDS)[number]['k'];

const CHUNK = 500;

/** Simple CSV reader that handles quotes, commas inside quotes and new lines inside quotes. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function guess(headers: string[]): Record<FieldKey, number> {
  const used = new Set<number>();
  const out = {} as Record<FieldKey, number>;
  for (const f of FIELDS) {
    let idx = -1;
    for (const w of f.words) {
      idx = headers.findIndex((h, i) => !used.has(i) && h.toLowerCase().trim() === w);
      if (idx < 0) idx = headers.findIndex((h, i) => !used.has(i) && h.toLowerCase().includes(w));
      if (idx >= 0) break;
    }
    out[f.k] = idx;
    if (idx >= 0) used.add(idx);
  }
  return out;
}

const tenDigits = (v: string) => normPhone(v);
function fixBhk(v: string) {
  const s = v.trim();
  if (!s) return '';
  const n = s.match(/^(\d)\s*(bhk|rk|bed)?/i);
  if (n) return Number(n[1]) >= 5 ? '5+ BHK' : `${n[1]} BHK`;
  return BHKS.find((b) => b.toLowerCase() === s.toLowerCase()) ?? s.slice(0, 20);
}
function fixSource(v: string) {
  const s = v.trim();
  if (!s) return '';
  const low = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SOURCES.find((x) => x.toLowerCase().replace(/[^a-z0-9]/g, '') === low)
    ?? (low.includes('99') ? '99acres' : low.includes('magic') ? 'MagicBricks' : low.includes('housing') ? 'Housing.com'
      : low.includes('facebook') || low === 'fb' ? 'Facebook' : low.includes('insta') ? 'Instagram' : low.includes('google') ? 'Google Ads' : s.slice(0, 60));
}

export function ImportLeads({ people, projects }: { people: Person[]; projects: Project[] }) {
  const [fileName, setFileName] = useState('');
  const [grid, setGrid] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<FieldKey, number> | null>(null);
  const [source, setSource] = useState('');
  const [assign, setAssign] = useState('auto');
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<{ added: number; updated: number; skipped: number } | null>(null);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);

  async function readFile(f: File) {
    setError(''); setResult(null); setGrid([]); setMap(null);
    if (f.size > 15 * 1024 * 1024) return setError('This file is too big. Split it into files under 15 MB.');
    setFileName(f.name);
    try {
      let rows: string[][];
      if (/\.xlsx$/i.test(f.name)) {
        const readXlsxFile = (await import('read-excel-file')).default;
        const raw = await readXlsxFile(f);
        rows = raw.map((r) => r.map((c) => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))));
      } else if (/\.(csv|txt)$/i.test(f.name)) {
        rows = parseCSV((await f.text()).replace(/^﻿/, ''));
      } else {
        return setError('Use an Excel file (.xlsx) or a CSV file. Old .xls files: open in Excel and "Save as" .xlsx first.');
      }
      rows = rows.filter((r) => r.some((x) => String(x).trim()));
      if (rows.length < 2) return setError('The file has no rows under the heading row.');
      setGrid(rows);
      setMap(guess(rows[0].map(String)));
    } catch {
      setError('Could not read this file. Open it in Excel, "Save as" .xlsx or .csv, and try again.');
    }
  }

  const headers = grid[0] ?? [];
  const body = grid.slice(1);
  const rows: (ImportRow & { ok: boolean })[] = useMemo(() => {
    if (!map) return [];
    const get = (r: string[], k: FieldKey) => (map[k] >= 0 ? String(r[map[k]] ?? '').trim() : '');
    return body.map((r) => {
      const b = parseBudget(get(r, 'budget'));
      const phone = tenDigits(get(r, 'phone'));
      const name = get(r, 'name');
      return {
        name, phone, email: get(r, 'email'), location: get(r, 'location'),
        budget_min: b?.min ?? null, budget_max: b?.max ?? null,
        bhk: fixBhk(get(r, 'bhk')), source: fixSource(get(r, 'source')), note: get(r, 'note'),
        ok: !!name && validPhone(phone),
      };
    });
  }, [body, map]);
  const good = rows.filter((r) => r.ok);

  async function run() {
    setBusy(true); setError(''); setResult(null);
    const total = { added: 0, updated: 0, skipped: rows.length - good.length };
    const send = good.map(({ ok: _ok, ...r }) => r); // eslint-disable-line @typescript-eslint/no-unused-vars
    for (let i = 0; i < send.length; i += CHUNK) {
      setProgress(`Saving ${Math.min(i + CHUNK, send.length)} of ${send.length}…`);
      const res = await importLeads(send.slice(i, i + CHUNK), source, assign, project);
      if (res.error) { setError(`${res.error} (${total.added} added before this stopped)`); break; }
      total.added += res.added ?? 0; total.updated += res.updated ?? 0; total.skipped += res.skipped ?? 0;
    }
    setResult(total); setProgress(''); setBusy(false);
  }

  if (result) {
    return (
      <section className="panel narrow">
        <div className="panel-h"><h2>Import finished</h2></div>
        <div className="panel-b stack">
          <div className="kpis">
            <div className="kpi"><span className="label">New leads added</span><span className="n">{result.added}</span></div>
            <div className="kpi"><span className="label">Already in CRM</span><span className="n">{result.updated}</span><span className="hint">Noted on the existing lead</span></div>
            <div className="kpi"><span className="label">Skipped</span><span className="n">{result.skipped}</span><span className="hint">No name or bad mobile</span></div>
          </div>
          {error && <p className="msg err">{error}</p>}
          <div className="row-btns">
            <Link className="btn primary" href="/leads">See leads</Link>
            <button className="btn" onClick={() => { setResult(null); setGrid([]); setMap(null); setFileName(''); }}>Import another file</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="stack narrow">
      <section className="panel">
        <div className="panel-h"><h2>1. Choose your file</h2><span className="hint">Excel (.xlsx) or CSV · first row must be headings</span></div>
        <div className="panel-b">
          <label className={`drop ${over ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) readFile(f); }}>
            <input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
            <b>{fileName || 'Drop the file here or tap to choose'}</b>
            <div className="hint">{grid.length ? `${body.length} rows found` : 'Your old Excel sheet, a portal download, or a Google Sheet saved as CSV'}</div>
          </label>
          {error && !result && <p className="msg err" role="alert">{error}</p>}
        </div>
      </section>

      {map && (
        <>
          <section className="panel">
            <div className="panel-h"><h2>2. Match the columns</h2><span className="hint">We guessed. Fix anything wrong.</span></div>
            <div className="panel-b map-grid">
              {FIELDS.map((f) => (
                <label key={f.k} className="field">
                  <span className="label">{f.l}{(f.k === 'name' || f.k === 'phone') && ' *'}</span>
                  <select value={map[f.k]} onChange={(e) => setMap({ ...map, [f.k]: Number(e.target.value) })}>
                    <option value={-1}>— Not in file —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{String(h) || `Column ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>3. Check</h2><span className="hint">{good.length} ready · {rows.length - good.length} will be skipped</span></div>
            <div className="table-wrap"><table className="tbl preview">
              <thead><tr><th></th><th>Name</th><th>Mobile</th><th>Area</th><th>Budget</th><th>BHK</th><th>Source</th></tr></thead>
              <tbody>{rows.slice(0, 8).map((r, i) => (
                <tr key={i} style={r.ok ? undefined : { opacity: 0.5 }}>
                  <td>{r.ok ? '✓' : '✗'}</td><td>{r.name || '—'}</td><td className="mono">{r.phone || '—'}</td><td>{r.location}</td>
                  <td>{r.budget_min || r.budget_max ? [r.budget_min, r.budget_max].filter(Boolean).map((n) => `₹${(Number(n) / 100000).toFixed(1)}L`).join(' – ') : ''}</td>
                  <td>{r.bhk}</td><td>{r.source}</td>
                </tr>
              ))}</tbody>
            </table></div>
            {rows.length > 8 && <p className="hint" style={{ padding: '8px 16px 14px', margin: 0 }}>Showing the first 8 of {rows.length}.</p>}
          </section>

          <section className="panel">
            <div className="panel-h"><h2>4. Import</h2></div>
            <div className="panel-b stack">
              <div className="map-grid">
                <label className="field"><span className="label">Source (if the file has none)</span>
                  <select value={source} onChange={(e) => setSource(e.target.value)}><option value="">Other</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
                </label>
                <label className="field"><span className="label">Give the leads to</span>
                  <select value={assign} onChange={(e) => setAssign(e.target.value)}>
                    <option value="auto">Share evenly among agents</option>
                    <option value="">Nobody for now</option>
                    {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
                  </select>
                </label>
                {projects.length > 0 && (
                  <label className="field"><span className="label">Project</span>
                    <select value={project} onChange={(e) => setProject(e.target.value)}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  </label>
                )}
              </div>
              <p className="hint">Numbers already in your CRM are not copied. The old lead gets a note that it came again.</p>
              <div className="row-btns">
                <button className="btn primary" disabled={busy || !good.length || map.name < 0 || map.phone < 0} onClick={run}>
                  {busy ? progress : `Import ${good.length} lead${good.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
