'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { moveStage } from '@/app/crm-actions';
import { STAGES, fmtBudget, fuState, fuText } from '@/lib/crm';

type L = { id: string; name: string; stage: string; score: string; bhk: string | null; budget_min: number | null; budget_max: number | null; location: string | null; next_follow_up: string | null; agent?: string };

export function LeadBoard({ leads }: { leads: L[] }) {
  const [items, setItems] = useState(leads);
  const [over, setOver] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [, start] = useTransition();
  const cols = [...STAGES.map((s) => ({ k: s.k as string, l: s.l as string })), { k: 'lost', l: 'Lost' }];
  function drop(stage: string, id: string) {
    setOver(null);
    const lead = items.find((x) => x.id === id);
    if (!lead || lead.stage === stage) return;
    if (stage === 'lost') { setErr('To mark a lead as lost, open it and pick a reason.'); return; }
    const before = items;
    setItems(items.map((x) => (x.id === id ? { ...x, stage } : x)));
    start(async () => { const r = await moveStage(id, stage); if (r.error) { setItems(before); setErr(r.error); } });
  }
  return (
    <>
      <p className="hint">Drag a card to another column to change its stage.</p>
      {err && <p className="msg err" role="alert">{err}</p>}
      <div className="board">
        {cols.map((c) => {
          const ls = items.filter((l) => l.stage === c.k);
          return (
            <div key={c.k} className={`col ${over === c.k ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(c.k); }}
              onDragLeave={() => setOver((o) => (o === c.k ? null : o))}
              onDrop={(e) => drop(c.k, e.dataTransfer.getData('text/plain'))}>
              <div className="col-h">{c.l}<span className="mono">{ls.length}</span></div>
              {ls.slice(0, 80).map((l) => (
                <Link key={l.id} href={`/leads/${l.id}`} className="card" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', l.id)}>
                  <span className="t"><span className={`dot ${l.score}`} />{l.name}</span>
                  <span className="s">{[l.bhk, fmtBudget(l.budget_min, l.budget_max), l.location].filter(Boolean).join(' · ') || 'Requirement not filled'}</span>
                  {l.next_follow_up && !['booked', 'lost'].includes(l.stage) && <span className={`s fu ${fuState(l.next_follow_up)}`}>{fuText(l.next_follow_up)}</span>}
                  {l.agent && <span className="s">{l.agent}</span>}
                </Link>
              ))}
              {ls.length > 80 && <p className="hint">+{ls.length - 80} more. Use the list view.</p>}
            </div>
          );
        })}
      </div>
    </>
  );
}
