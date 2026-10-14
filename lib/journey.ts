import { fmtBudget, fmtDT, scoreLabel, stageLabel } from '@/lib/crm';

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
  purpose?: string | null; funding?: string | null; score: string; stage: string; assigned_to?: string | null; created_at: string; source?: string | null;
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
  parts.push(`${first} wants ${want}${where}${budget ? `, budget ${budget}` : ''}${lead.purpose ? ` (${lead.purpose.toLowerCase()})` : ''}${lead.funding ? `, ${lead.funding.toLowerCase()}` : ''}.`);
  parts.push(`Interest: ${scoreLabel(lead.score).toLowerCase()}. Came in ${day(lead.created_at)}${lead.source ? ` from ${lead.source}` : ''}.`);
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

/* Hindi version of the client summary, shown when the app is switched to हिंदी. */
const STEP_HI: Record<string, string> = { received: 'लीड मिली', call: 'पहली कॉल', presentation: 'प्रोजेक्ट प्रेज़ेंटेशन', visit: 'साइट विज़िट', followup: 'फ़ॉलो-अप', payment: 'पेमेंट' };
const STAGE_HI: Record<string, string> = { new: 'नया', noresponse: 'जवाब नहीं',  contacted: 'संपर्क हुआ', qualified: 'इच्छुक', visit: 'विज़िट तय', visited: 'विज़िट हो गई', negotiation: 'मोलभाव', token: 'टोकन दिया', booked: 'बुक हो गया', lost: 'लॉस्ट' };
const SCORE_HI: Record<string, string> = { hot: 'हॉट', warm: 'वार्म', cold: 'कोल्ड', junk: 'जंक', later: 'बाद में' };
const PURPOSE_HI: Record<string, string> = { 'Self use': 'खुद रहने के लिए', Investment: 'इन्वेस्टमेंट', Both: 'दोनों', Other: 'अन्य' };
const PTYPE_HI: Record<string, string> = { Apartment: 'अपार्टमेंट', Villa: 'विला', Plot: 'प्लॉट', Commercial: 'कमर्शियल', Office: 'ऑफ़िस', Retail: 'दुकान / शोरूम', 'Farm land': 'फ़ार्म लैंड', 'Independent house': 'इंडिपेंडेंट घर', Other: 'प्रॉपर्टी' };
const dayHi = (iso: string) => new Date(iso).toLocaleDateString('hi-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export function clientSummaryHi(lead: LeadLike, steps: StepRow[], acts: Act[], nameOf: Map<string, string>, projectName?: string | null, nextStep?: string | null) {
  const first = lead.name.split(' ')[0];
  const want = [lead.bhk, lead.property_type ? PTYPE_HI[lead.property_type] ?? lead.property_type : ''].filter(Boolean).join(' ') || 'घर';
  const budget = fmtBudget(lead.budget_min ?? null, lead.budget_max ?? null).replace(/^Up to (.*)$/, '$1 तक');
  const parts: string[] = [];
  parts.push(`${first} को ${lead.location ? `${lead.location} में ` : ''}${want} चाहिए${budget ? `, बजट ${budget}` : ''}${lead.purpose ? ` (${PURPOSE_HI[lead.purpose] ?? lead.purpose})` : ''}${lead.funding === 'Home loan / finance' ? ', लोन से' : lead.funding === 'Self-funded' ? ', अपने पैसे से' : ''}।`);
  parts.push(`रुचि: ${SCORE_HI[lead.score] ?? lead.score}। ${dayHi(lead.created_at)} को आई${lead.source ? `, ${lead.source} से` : ''}।`);
  const doneSteps = steps.filter((s) => s.step !== 'received').sort((a, b) => a.done_at.localeCompare(b.done_at));
  if (doneSteps.length) {
    parts.push('अब तक: ' + doneSteps.map((s) => `${STEP_HI[s.step] ?? s.step}${s.done_by && nameOf.get(s.done_by) ? ` (${nameOf.get(s.done_by)!.split(' ')[0]})` : ''} ${dayHi(s.done_at)}`).join(', ') + '।');
  } else {
    const calls = acts.filter((a) => a.type === 'call').length;
    parts.push(calls ? `${calls} कॉल हुईं, अभी कोई स्टेप पूरा नहीं।` : 'अभी तक किसी ने बात नहीं की।');
  }
  if (projectName) parts.push(`प्रोजेक्ट जिस पर बात हुई: ${projectName}।`);
  const latest = [...doneSteps].reverse().find((s) => s.summary)?.summary
    ?? acts.find((a) => ['call', 'note', 'visit'].includes(a.type) && a.by_user)?.body;
  if (latest) parts.push(`आख़िरी नोट: “${clip(latest.replace(/\s+/g, ' '), 200)}”`);
  parts.push(`अभी: ${STAGE_HI[lead.stage] ?? lead.stage}${nextStep ? `, अगला: ${STEP_HI[nextStep] ?? nextStep}` : ''}${lead.assigned_to && nameOf.get(lead.assigned_to) ? ` — ${nameOf.get(lead.assigned_to)} के पास` : ''}।`);
  return parts.join(' ');
}
