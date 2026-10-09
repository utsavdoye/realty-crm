'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { importUnits } from '@/app/crm-actions';
import { parseInventory, parseRateCard, rateFor, type ParseResult, type Sheet } from '@/lib/units';
import { fmtL } from '@/lib/crm';

const LABEL: Record<string, string> = { open: 'Open', hold: 'On hold', booked: 'Booked', mortgage: 'Mortgage' };

/** Upload the builder's inventory Excel (or CSV). Shows what was understood before saving. */
export function UnitImport({ projectId, rateCard, hasUnits }: { projectId: string; rateCard: string; hasUnits: boolean }) {
  const router = useRouter();
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [file, setFile] = useState('');
  const [rates, setRates] = useState(rateCard);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  const bands = useMemo(() => parseRateCard(rates), [rates]);
  const result = useMemo<ParseResult | { error: string } | null>(() => (sheets ? parseInventory(sheets, bands) : null), [sheets, bands]);
  const ok = result && !('error' in result) ? result : null;

  async function read(f: File) {
    setMsg(null); setFile(f.name); setBusy('Reading the file…');
    try {
      if (/\.csv$/i.test(f.name)) {
        const text = await f.text();
        const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
        const rows = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setSheets([{ name: f.name, rows }]);
      } else {
        const mod = await import('read-excel-file');
        const names = await mod.readSheetNames(f);
        const list: Sheet[] = [];
        for (const name of names) list.push({ name, rows: (await mod.default(f, { sheet: name })) as Sheet['rows'] });
        setSheets(list);
      }
    } catch {
      setSheets(null); setMsg({ error: 'Could not read this file. Save it as .xlsx or .csv and try again.' });
    }
    setBusy('');
  }

  async function save() {
    if (!ok) return;
    setBusy('Saving flats…'); setMsg(null);
    const card = bands.filter((b) => b.from >= 0).map((b) => ({ floors: b.from === b.to ? String(b.from) : `${b.from}–${b.to}`, rate: b.rate }));
    const r = await importUnits(projectId, ok.units.map((u) => ({ ...u, rate: u.rate ?? rateFor(bands, u.floor) })), replace, card);
    setBusy(''); setMsg(r);
    if (r.ok) { setSheets(null); setFile(''); router.refresh(); }
  }

  const counts = ok ? ok.units.reduce<Record<string, number>>((a, u) => { a[u.status] = (a[u.status] ?? 0) + 1; return a; }, {}) : {};
  const priced = ok ? ok.units.filter((u) => u.status === 'open' && u.sba && u.rate).map((u) => (u.sba! * u.rate!) / 100000) : [];

  return (
    <div className="stack">
      <div className="mp-row">
        <div><b>{hasUnits ? 'Update flats from Excel' : 'Add flats from Excel'}</b><span className="hint">The builder&apos;s inventory sheet (.xlsx or .csv). Flat numbers, type, size and status are found by themselves.</span></div>
        <label className="btn sm primary">{busy === 'Reading the file…' ? busy : 'Choose file'}<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }} /></label>
      </div>
      <label className="field"><span className="label">Rate card (₹ per sq ft by floor)</span>
        <input value={rates} onChange={(e) => setRates(e.target.value)} placeholder="e.g. 1-3: 4700, 4-6: 4800, 7-9: 4900   (or one number for all floors)" />
        <span className="hint">{bands.length ? `Understood: ${bands.map((b) => (b.from < 0 ? `all floors ₹${b.rate}` : `floors ${b.from}–${b.to} ₹${b.rate}`)).join(' · ')}` : 'Used when the sheet has no rate or price column.'}</span>
      </label>
      {file && <p className="hint">File: {file}</p>}
      {result && 'error' in result && <p className="msg err">{result.error}</p>}
      {ok && (
        <>
          <div className="msg ok">
            Found <b>{ok.units.length} flats</b> in the &quot;{ok.sheet}&quot; sheet: {Object.entries(counts).map(([k, v]) => `${v} ${LABEL[k].toLowerCase()}`).join(', ')}.
            {priced.length > 0 && <> Open flats cost {fmtL(Math.round(Math.min(...priced) * 10) / 10)} to {fmtL(Math.round(Math.max(...priced) * 10) / 10).replace('₹', '')}.</>}
          </div>
          <p className="hint">Columns used: {Object.entries(ok.columns).map(([k, v]) => `${k} ← “${v}”`).join(' · ')}</p>
          {ok.notes.map((n) => <p key={n} className="hint">• {n}</p>)}
          <div className="table-wrap"><table className="tbl small">
            <thead><tr><th>Flat</th><th>Floor</th><th>Type</th><th>Super area</th><th>Carpet</th><th>Rate</th><th>Price</th><th>Status</th></tr></thead>
            <tbody>{ok.units.slice(0, 8).map((u) => {
              const rate = u.rate ?? rateFor(bands, u.floor);
              return <tr key={u.unit_no}><td className="mono">{u.unit_no}</td><td>{u.floor ?? '—'}</td><td>{u.bhk ?? '—'}</td><td>{u.sba ? Math.round(u.sba) : '—'}</td><td>{u.carpet ? Math.round(u.carpet) : '—'}</td><td>{rate ?? '—'}</td><td>{u.sba && rate ? fmtL(Math.round((u.sba * rate) / 10000) / 10) : '—'}</td><td>{LABEL[u.status]}</td></tr>;
            })}</tbody>
          </table></div>
          {ok.units.length > 8 && <p className="hint">Showing the first 8 of {ok.units.length}.</p>}
          {hasUnits && (
            <div className="stack">
              <label className="check"><input type="radio" name="mode" checked={replace} onChange={() => setReplace(true)} /> Replace all flats with this file (best when the builder sends a fresh full list)</label>
              <label className="check"><input type="radio" name="mode" checked={!replace} onChange={() => setReplace(false)} /> Only add new flats and update the ones in this file</label>
            </div>
          )}
          <div><button type="button" className="btn primary" disabled={!!busy} onClick={save}>{busy || `Save ${ok.units.length} flats`}</button></div>
        </>
      )}
      {msg?.ok && <p className="msg ok">{msg.ok}</p>}
      {msg?.error && <p className="msg err">{msg.error}</p>}
    </div>
  );
}
