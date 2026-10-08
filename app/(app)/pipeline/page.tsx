import Link from 'next/link';
import { requireOrg } from '@/lib/context';
import { fetchAll } from '@/lib/fetchAll';
import { STEPS, currentStep } from '@/lib/journey';
import { AutoFilterForm } from '@/components/AutoFilterForm';

export const metadata = { title: 'Journey board' };

// How many days a client may stay at a step before it shows red.
const LIMIT: Record<string, number> = { call: 1, presentation: 2, visit: 4, followup: 3, payment: 7 };

type L = { id: string; name: string; score: string; stage: string; assigned_to: string | null; assigned_at: string | null; created_at: string };

export default async function Pipeline({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { supabase, org, role } = await requireOrg(['owner', 'manager']);
  const admin = role === 'owner';
  const who = typeof searchParams.who === 'string' ? searchParams.who : '';
  const [leads, steps, { data: people }] = await Promise.all([
    fetchAll<L>(() => supabase.from('leads').select('id, name, score, stage, assigned_to, assigned_at, created_at').eq('org_id', org.id).not('stage', 'in', '(booked,lost)').order('id')),
    fetchAll<{ lead_id: string; step: string }>(() => supabase.from('lead_steps').select('id, lead_id, step').eq('org_id', org.id).order('id')),
    supabase.from('members').select('user_id, full_name, active, role').eq('org_id', org.id),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const done = new Map<string, Set<string>>();
  steps.forEach((s) => { const d = done.get(s.lead_id) ?? new Set<string>(); d.add(s.step); done.set(s.lead_id, d); });
  const cols = STEPS.filter((s) => s.k !== 'received' && (s.k !== 'payment' || admin));
  const byCol = new Map<string, (L & { days: number })[]>(cols.map((c) => [c.k, []]));
  const now = Date.now();
  let everyone = 0, nobody = 0;
  const perPerson = new Map<string, number>();
  for (const l of leads) {
    const cur = currentStep(done.get(l.id) ?? new Set(['received']), admin);
    if (!cur || !byCol.has(cur)) continue;
    everyone++;
    if (!l.assigned_to) nobody++; else perPerson.set(l.assigned_to, (perPerson.get(l.assigned_to) ?? 0) + 1);
    if (who && (who === 'none' ? l.assigned_to : l.assigned_to !== who)) continue;
    const since = new Date(l.assigned_at ?? l.created_at).getTime();
    byCol.get(cur)!.push({ ...l, days: Math.max(0, Math.floor((now - since) / 86400000)) });
  }
  byCol.forEach((list) => list.sort((a, b) => b.days - a.days));
  const total = [...byCol.values()].reduce((a, b) => a + b.length, 0);
  const staff = (people ?? []).filter((p) => p.active && p.role !== 'partner');

  return (
    <>
      <div className="top">
        <h1>Journey board</h1>
        <AutoFilterForm className="row-gap" action="/pipeline">
          <select name="who" defaultValue={who} key={who} aria-label="Whose clients">
            <option value="">Everyone ({everyone})</option>
            <option value="none">Not given to anyone ({nobody})</option>
            {staff.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name} ({perPerson.get(p.user_id) ?? 0})</option>)}
          </select>
        </AutoFilterForm>
      </div>
      {who && <p className="msg ok" style={{ marginTop: 0 }}>Showing {total} client{total === 1 ? '' : 's'} {who === 'none' ? 'not given to anyone' : `with ${nameOf.get(who) ?? 'this person'}`}. <a href="/pipeline">Show everyone</a></p>}
      <p className="hint" style={{ marginTop: -6 }}>Open clients by the step they are at. Red = waiting too long at this step ({Object.entries(LIMIT).filter(([k]) => admin || k !== 'payment').map(([k, d]) => `${STEPS.find((s) => s.k === k)?.short} ${d}d`).join(', ')}).</p>
      <div className="jboard">
        {cols.map((c) => {
          const list = byCol.get(c.k) ?? [];
          const late = list.filter((l) => l.days > LIMIT[c.k]).length;
          return (
            <section key={c.k} className="jcol">
              <div className="jcol-h"><b>{c.l}</b><span className="chip">{list.length}</span>{late > 0 && <span className="chip bad">{late} late</span>}</div>
              <div className="jcards">
                {list.slice(0, 80).map((l) => (
                  <Link key={l.id} href={`/leads/${l.id}`} className={`jcard ${l.days > LIMIT[c.k] ? 'late' : ''}`}>
                    <b>{l.name}</b>
                    <span className="hint">{l.assigned_to ? nameOf.get(l.assigned_to) ?? '—' : 'Not given to anyone'}</span>
                    <span className="jmeta"><span className={`chip ${l.score}`}>{l.score}</span><span>{l.days === 0 ? 'today' : `${l.days} day${l.days === 1 ? '' : 's'}`} with them</span></span>
                  </Link>
                ))}
                {list.length > 80 && <p className="hint">+{list.length - 80} more</p>}
                {!list.length && <p className="hint">Nobody here.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
