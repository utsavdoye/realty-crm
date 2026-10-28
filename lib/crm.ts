// Shared lists and formatting for the CRM screens. Safe on server and browser.

export const STAGES = [
  { k: 'new', l: 'New' },
  { k: 'contacted', l: 'Contacted' },
  { k: 'qualified', l: 'Interested' },
  { k: 'visit', l: 'Visit scheduled' },
  { k: 'visited', l: 'Visit done' },
  { k: 'negotiation', l: 'Negotiation' },
  { k: 'token', l: 'Token paid' },
  { k: 'booked', l: 'Booked' },
] as const;
export type StageKey = (typeof STAGES)[number]['k'] | 'lost';
export const STAGE_IDX: Record<string, number> = Object.fromEntries(STAGES.map((s, i) => [s.k, i]));
STAGE_IDX.noresponse = 0; // "No response": we called, nobody picked up. Same level as New.
export const stageLabel = (k: string) => (k === 'lost' ? 'Lost' : k === 'noresponse' ? 'No response' : STAGES.find((s) => s.k === k)?.l ?? k);
export const stageChip = (k: string) => (k === 'booked' || k === 'token' ? 'good' : k === 'lost' ? 'bad' : k === 'new' || k === 'noresponse' ? 'tape' : 'acc');
/** Status filter list: New, No response, Contacted … Booked */
export const STATUS_LIST = [STAGES[0], { k: 'noresponse', l: 'No response' }, ...STAGES.slice(1)];

/** Interest. One place to change it: the Status box on the lead page. */
export const SCORES = [
  { k: 'hot', l: 'Hot' }, { k: 'warm', l: 'Warm' }, { k: 'cold', l: 'Cold' }, { k: 'junk', l: 'Junk' }, { k: 'later', l: 'Maybe later' },
] as const;
export const SCORE_KEYS: string[] = SCORES.map((s) => s.k);
export const scoreLabel = (k: string) => SCORES.find((s) => s.k === k)?.l ?? k;

export const SOURCES = ['99acres', 'MagicBricks', 'Housing.com', 'Facebook', 'Instagram', 'Google Ads', 'Website', 'Walk-in', 'Referral', 'Channel partner', 'Cold calling', 'Other'];
/** What kind of property, first question on the form. */
export const CATEGORIES = ['Residential', 'Commercial', 'Res + Com', 'Plot', 'Farm land', 'Other'];
/** "Configuration" (was "BHK / type"). Not asked for Commercial. */
export const BHKS = ['1 BHK', '2 BHK', '2.5 BHK', '3 BHK', '3.5 BHK', '4 BHK', '4.5 BHK', '5+ BHK', 'Studio', 'Penthouse', 'Other'];
/** Property type of a lead. Office and Retail are commercial ("Shop" is now "Retail"). */
export const PTYPES = ['Apartment', 'Villa', 'Independent house', 'Plot', 'Office', 'Retail', 'Farm land', 'Other'];
/** Which property types fit each category (the form narrows the list). */
export const PTYPES_FOR: Record<string, string[]> = {
  Residential: ['Apartment', 'Villa', 'Independent house', 'Other'],
  Commercial: ['Office', 'Retail', 'Other'],
  'Res + Com': PTYPES,
  Plot: ['Plot', 'Other'],
  'Farm land': ['Farm land', 'Other'],
  Other: PTYPES,
};
/** Project types (projects keep the short list). */
export const PROJECT_TYPES = ['Apartment', 'Villa', 'Plot', 'Retail', 'Office', 'Commercial', 'Farm land'];
export const PROJECT_DEALS: [string, string][] = [['sale', 'For sale'], ['lease', 'For lease / rent'], ['both', 'Sale or lease']];
export const PURPOSES = ['Self use', 'Investment', 'Both', 'Other'];
/** What the client wants to do. */
export const WANTS = ['Buy', 'Rent', 'Sell', 'Lease out'];
export const FURNISHING = ['Unfurnished', 'Semi-furnished', 'Fully furnished', 'Any'];
export const POSSESSION_PREFS = ['Ready to move', 'Within 6 months', 'Within 1 year', '1–2 years', 'Any'];
export const OCCUPATIONS = ['Salaried', 'Self-employed', 'Business owner', 'Professional (doctor, CA…)', 'Investor', 'Retired', 'Other'];
export const FUNDING = ['Self-funded', 'Home loan / finance', 'Both', 'Not sure yet'];

/** Budget ranges in lakh, [min, max]; max null = "and above". The form saves these instead of typed amounts. */
export const BUDGETS: { k: string; l: string; min: number | null; max: number | null }[] = [
  [null, 25, 'Under ₹25 L'], [25, 50, '₹25 – 50 L'], [50, 100, '₹50 L – 1 Cr'], [100, 150, '₹1 – 1.5 Cr'], [150, 200, '₹1.5 – 2 Cr'],
  [200, 225, '₹2 – 2.25 Cr'], [225, 250, '₹2.25 – 2.5 Cr'], [250, 275, '₹2.5 – 2.75 Cr'], [275, 300, '₹2.75 – 3 Cr'],
  [300, 400, '₹3 – 4 Cr'], [400, null, '₹4 Cr+'],
].map(([min, max, l]) => ({ k: `${min ?? ''}-${max ?? ''}`, l: l as string, min: min as number | null, max: max as number | null }));
/** The range a saved budget belongs to ('' = none). Uses the top of the budget, or the bottom when only "from" is known. */
export function budgetKey(min?: number | null, max?: number | null) {
  const exact = BUDGETS.find((b) => (b.min ?? null) === (min ?? null) && (b.max ?? null) === (max ?? null));
  if (exact) return exact.k;
  if (max != null) return (BUDGETS.find((r) => (r.min == null || max > r.min) && (r.max == null || max <= r.max)) ?? BUDGETS[0]).k;
  if (min != null) return (BUDGETS.find((r) => (r.min == null || min >= r.min) && (r.max == null || min < r.max)) ?? BUDGETS[0]).k; // "2 Cr+" starts at 2 Cr
  return '';
}
/** "50-100" → { min: 50, max: 100 }; also reads typed text like "60 L to 80 L" (voice, old forms). */
export function readBudget(v: string): { min: number | null; max: number | null } | null {
  const r = BUDGETS.find((b) => b.k === v);
  if (r) return { min: r.min, max: r.max };
  return parseBudget(v);
}

/** Raipur areas for the area box (people can still type any other place). */
export const RAIPUR_AREAS = [
  'Shankar Nagar', 'Khamardih', 'VIP Road', 'Amlidih', 'Telibandha', 'Mowa', 'Saddu', 'Kachna', 'Devendra Nagar', 'Pandri', 'Avanti Vihar',
  'Civil Lines', 'Daldal Seoni', 'Labhandi', 'Tatibandh', 'Sejbahar', 'Dunda', 'Boriyakhurd', 'Kamal Vihar', 'Lalpur', 'Bhatagaon', 'Mana Camp',
  'Samta Colony', 'Choubey Colony', 'Shailendra Nagar', 'Fafadih', 'Gudhiyari', 'Tikrapara', 'Sundar Nagar', 'Purani Basti', 'Mathpurena',
  'Amanaka', 'Ring Road No. 1', 'Ring Road No. 2', 'GE Road', 'Raipura', 'Kota', 'Byron Bazar', 'Moudhapara', 'Khamtarai', 'Urkura', 'Birgaon',
  'Abhanpur', 'Naya Raipur (sector not sure)',
  ...Array.from({ length: 40 }, (_, i) => `Naya Raipur – Sector ${i + 1}`),
];
export const PROJECT_STATUS = ['Pre-launch', 'Under construction', 'Ready to move', 'Sold out'];
export const DOC_KINDS = ['PAN', 'Aadhaar', 'Agreement', 'Cheque', 'Payment receipt', 'Photo', 'Other'];
export const LOST_REASONS = ['Budget mismatch', 'Location not suitable', 'Bought elsewhere', 'Not responding', 'Just exploring', 'Loan not approved', 'Wrong number', 'Other'];
export const TEMPLATE_USES = ['Welcome', 'Follow-up', 'Visit reminder', 'After visit', 'Birthday', 'Price / offer', 'Other'];
export const TEMPLATE_VARS = ['name', 'agent', 'agent_phone', 'company', 'project', 'visit_time', 'budget', 'location', 'bhk'];

/** Call results. `hours` = default next follow-up; null = none. */
export const OUTCOMES = [
  { k: 'interested', l: 'Talked, interested', hours: 24 },
  { k: 'callback', l: 'Asked to call back', hours: 20 },
  { k: 'notint', l: 'Not interested', hours: null },
  { k: 'noanswer', l: 'No answer', hours: 3 },
  { k: 'busy', l: 'Busy / cut the call', hours: 2 },
  { k: 'off', l: 'Switched off', hours: 5 },
  { k: 'wrong', l: 'Wrong number', hours: null },
] as const;

export function fmtL(l: number | null | undefined) {
  if (l == null || Number.isNaN(Number(l))) return '';
  const n = Number(l);
  if (n >= 100) return `₹${Math.round((n / 100) * 100) / 100} Cr`;
  return `₹${Math.round(n * 10) / 10} L`;
}
export function fmtBudget(min?: number | null, max?: number | null) {
  if (min && max && min !== max) return `${fmtL(min)} – ${fmtL(max).replace('₹', '')}`;
  if (max) return `Up to ${fmtL(max)}`;
  if (min) return `${fmtL(min)}+`;
  return '';
}
export function parseBudget(input?: string | null): { min: number | null; max: number | null } | null {
  if (!input) return null;
  const s = input.toLowerCase().replace(/,/g, '').replace(/rs\.?|inr|₹/g, ' ').replace(/^up to\s*/, '');
  const parts = s.split(/\s*(?:-|–|to)\s*/);
  const vals: [number, string][] = [];
  for (const p of parts) { const m = p.match(/(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lac|lacs|lakh|lakhs|k|thousand)?/); if (m) vals.push([Number(m[1]), m[2] || '']); }
  if (!vals.length) return null;
  const unit = (u: string) => (u ? (u[0] === 'c' ? 'cr' : u[0] === 'l' ? 'l' : 'k') : '');
  const lastU = unit(vals[vals.length - 1][1]);
  const toL = ([n, u]: [number, string]) => { const x = unit(u) || lastU; if (x === 'cr') return n * 100; if (x === 'l') return n; if (x === 'k') return n / 100; if (n >= 100000) return n / 100000; if (n < 10) return n * 100; return n; };
  const nums = vals.map(toL).map((x) => Math.round(x * 100) / 100);
  if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  // one number: "1.2 Cr+", "above 80 L", "from 60 L" = at least; otherwise "up to"
  if (nums.length === 1) return /\+|above|over|more than|min|from|plus|onwards|se (zyada|jyada)/.test(s) ? { min: nums[0], max: null } : { min: null, max: nums[0] };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

const TZ = 'Asia/Kolkata';
export const fmtDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }) : '');
export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '');
export const fmtDT = (iso?: string | null) => (iso ? `${fmtDay(iso)}, ${fmtTime(iso)}` : '');
export const fmtDate = (d?: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Day key in India time, e.g. 2026-10-05 */
export const istDay = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });

export function rel(iso?: string | null) {
  if (!iso) return '';
  const d = (new Date(iso).getTime() - Date.now()) / 60000;
  const a = Math.abs(d);
  if (a < 1) return 'just now';
  const s = a < 60 ? `${Math.round(a)} min` : a < 1440 ? `${Math.round(a / 60)} hr` : `${Math.round(a / 1440)} d`;
  return d < 0 ? `${s} ago` : `in ${s}`;
}
export function fuState(iso?: string | null): '' | 'over' | 'today' | 'later' {
  if (!iso) return '';
  const t = new Date(iso);
  if (t.getTime() < Date.now()) return 'over';
  return istDay(t) === istDay(new Date()) ? 'today' : 'later';
}
export function fuText(iso?: string | null) {
  const s = fuState(iso);
  if (!s) return '';
  if (s === 'over') return `Overdue ${rel(iso).replace(' ago', '')}`;
  if (s === 'today') return `Today ${fmtTime(iso)}`;
  return fmtDT(iso);
}

/** "2026-10-06T11:00" for <input type="datetime-local">, in India time */
export function toLocalInput(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 330 * 60000);
  return d.toISOString().slice(0, 16);
}
/** Reads <input type="datetime-local"> value as India time */
export function fromLocalInput(v?: string | null) {
  if (!v) return null;
  const d = new Date(v + ':00+05:30');
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** A time in India: days from today at hour:minute */
export function istAt(days: number, hour: number, minute = 0) {
  const today = istDay(new Date());
  const base = new Date(`${today}T00:00:00+05:30`).getTime();
  return new Date(base + days * 86400000 + (hour * 60 + minute) * 60000).toISOString();
}

export function waLink(phone: string, text?: string) {
  const d = String(phone || '').replace(/\D/g, '');
  const n = d.length === 10 ? '91' + d : d;
  return `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}`;
}

export type TemplateContext = { name?: string | null; agent?: string; agent_phone?: string; company?: string; project?: string; visit_time?: string; budget?: string; location?: string | null; bhk?: string | null };
export function fillTemplate(body: string, c: TemplateContext) {
  const map: Record<string, string> = {
    name: (c.name || '').split(' ')[0] || 'there',
    agent: c.agent || '', agent_phone: c.agent_phone || '', company: c.company || '',
    // When the lead has no value, use words that still read well in a sentence.
    project: c.project || 'our projects', visit_time: c.visit_time || 'the planned time', budget: c.budget || 'your budget',
    location: c.location || 'your area', bhk: c.bhk || 'home',
  };
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (map[k] != null ? map[k] : m));
}
