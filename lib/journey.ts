import { fmtBudget, fmtDT, stageLabel } from '@/lib/crm';

/** The client journey, in order. "received" and "payment" tick by themselves; payment is admin-only. */
export const STEPS = [
  { k: 'received', l: 'Lead received', short: 'Received' },
  { k: 'call', l: 'First call', short: 'Call' },
  { k: 'presentation', l: 'Project presentation', short: 'Presentation' },
  { k: 'visit', l: 'Site visit', short: 'Site visit' },
  { k: 'followup', l: 'Follow-up', short: 'Follow-up' },
  { k: 'payment', l: 'Payment', short: 'Payment' },
] as const;
export type StepKey = (typeof STEPS)[number]['k'];
export const WORK_STEPS: StepKey[] = ['call', 'presentation', 'visit', 'followup'];
export const stepLabel = (k: string) => STEPS.find((s) => s.k === k)?.l ?? k;

export type StepRow = { step: string; done_at: string; done_by: string | null; summary: string | null; details: Record<string, unknown> | null };
export type Act = { id: string; type: string; body: string; by_user: string | null; created_at: string };

/** The first step that is not done yet (payment only counts for the admin). */
export function currentStep(done: Set<string>, admin: boolean): StepKey | null {
  for (const s of STEPS) {
    if (s.k === 'payment' && !admin) continue;
    if (!done.has(s.k)) return s.k;
  }
  return null;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

type LeadLike = {
  name: string; bhk?: string | null; property_type?: string | null; location?: string | null; budget_min?: number | null; budget_max?: number | null;
  purpose?: string | null; score: string; stage: string; assigned_to?: string | null; created_at: string; source?: string | null;
};

/** Who spoke to the client, what they did and their latest notes. Newest person first. */
export function peopleWhoSpoke(acts: Act[], steps: StepRow[], nameOf: Map<string, string>) {
  const by = new Map<string, { id: string; name: string; steps: string[]; calls: number; notes: string[]; first: string; last: string }>();
  const get = (id: string, at: string) => {
    let p = by.get(id);
    if (!p) { p = { id, name: nameOf.get(id) ?? 'Former team member', steps: [], calls: 0, notes: [], first: at, last: at }; by.set(id, p); }
    if (at < p.first) p.first = at;
    if (at > p.last) p.last = at;
    return p;
  };
  for (const s of steps) if (s.done_by && s.step !== 'received' && s.step !== 'payment') get(s.done_by, s.done_at).steps.push(stepLabel(s.step));
  for (const a of [...acts].sort((x, y) => y.created_at.localeCompare(x.created_at))) {
    if (!a.by_user || !['call', 'note', 'visit', 'whatsapp', 'step'].includes(a.type)) continue;
    const p = get(a.by_user, a.created_at);
    if (a.type === 'call') p.calls++;
    if (a.type !== 'whatsapp' && p.notes.length < 3 && a.body.trim()) p.notes.push(`${day(a.created_at)}: ${clip(a.body.replace(/\s+/g, ' '), 220)}`);
  }
  return [...by.values()].sort((a, b) => b.last.localeCompare(a.last));
}

/** A short plain-English summary of the whole client, built from what the team saved (no AI needed). */
export function clientSummary(lead: LeadLike, steps: StepRow[], acts: Act[], nameOf: Map<string, string>, projectName?: string | null, nextStep?: string | null) {
  const first = lead.name.split(' ')[0];
  const want = [lead.bhk, lead.property_type].filter(Boolean).join(' ') || 'a home';
  const where = lead.location ? ` in ${lead.location}` : '';
  const budget = fmtBudget(lead.budget_min ?? null, lead.budget_max ?? null);
  const parts: string[] = [];
  parts.push(`${first} wants ${want}${where}${budget ? `, budget ${budget}` : ''}${lead.purpose ? ` (${lead.purpose.toLowerCase()})` : ''}.`);
  parts.push(`Interest: ${lead.score}. Came in ${day(lead.created_at)}${lead.source ? ` from ${lead.source}` : ''}.`);
  const doneSteps = steps.filter((s) => s.step !== 'received').sort((a, b) => a.done_at.localeCompare(b.done_at));
  if (doneSteps.length) {
    parts.push('Done so far: ' + doneSteps.map((s) => `${stepLabel(s.step).toLowerCase()}${s.done_by && nameOf.get(s.done_by) ? ` by ${nameOf.get(s.done_by)!.split(' ')[0]}` : ''} (${day(s.done_at)})`).join(', ') + '.');
  } else {
    const calls = acts.filter((a) => a.type === 'call').length;
    parts.push(calls ? `${calls} call${calls === 1 ? '' : 's'} logged, no step finished yet.` : 'Nobody has spoken to them yet.');
  }
  if (projectName) parts.push(`Project discussed: ${projectName}.`);
  const latest = [...doneSteps].reverse().find((s) => s.summary)?.summary
    ?? acts.find((a) => ['call', 'note', 'visit'].includes(a.type) && a.by_user)?.body;
  if (latest) parts.push(`Latest: “${clip(latest.replace(/\s+/g, ' '), 200)}”`);
  parts.push(`Now: ${stageLabel(lead.stage)}${nextStep ? `, next is ${stepLabel(nextStep).toLowerCase()}` : ''}${lead.assigned_to && nameOf.get(lead.assigned_to) ? ` with ${nameOf.get(lead.assigned_to)}` : ''}.`);
  return parts.join(' ');
}

export const whenDone = (iso: string) => fmtDT(iso);
