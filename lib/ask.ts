// "Ask" helper: turns a question (English, Hindi in Roman letters, or Hinglish) into a safe search.
// This file works WITHOUT any AI, so most questions are answered instantly and never hit a limit.
// The AI (Gemini) is only asked when this cannot understand the question.

import { AREAS } from '@/lib/places';
import { BHKS, SOURCES } from '@/lib/crm';

export type LeadFilters = {
  q?: string; stage?: string; score?: string; source?: string; area?: string; bhk?: string; ptype?: string; purpose?: string;
  bmin?: number; bmax?: number; fu?: 'over' | 'today' | 'none' | 'stale'; from?: string; to?: string;
};
export type Range = 'today' | 'tomorrow' | 'week' | 'month' | 'last_month';
export type Intent =
  | { kind: 'leads'; f: LeadFilters }
  | { kind: 'lead'; who: string }
  | { kind: 'visits'; range: Range }
  | { kind: 'count'; what: 'leads' | 'booked' | 'visits_done'; range: Range }
  | { kind: 'projects'; area?: string; bmax?: number; bhk?: string }
  | { kind: 'page'; page: PageKey }
  | { kind: 'unknown' };

export const PAGES = {
  add_lead: { href: '/leads/new', label: 'Add a lead', help: 'Leads → “+ Add lead”. You can also fill it by voice.' },
  import: { href: '/leads/import', label: 'Import leads', help: 'Leads → Import. Drop an Excel or CSV file; columns are matched by themselves and repeat numbers are not added twice.' },
  team: { href: '/team', label: 'Team', help: 'Team → “Invite someone”. Pick Employee, Intern, Manager or Admin, then send the link on WhatsApp.' },
  projects: { href: '/projects', label: 'Projects', help: 'Projects → “Add a project” at the bottom. Add price, homes, location and photos.' },
  client_form: { href: '/profile#form', label: 'Your client form', help: 'Profile → “Your client form”. Send the link; the client fills budget, area and home type, and it comes to you as a lead.' },
  share: { href: '/projects', label: 'Projects', help: 'To send one project: Projects → “Turn on client link” → WhatsApp. To send a few homes to one client: open the lead → “Send homes to the client”.' },
  sources: { href: '/sources', label: 'Lead sources', help: 'Lead sources: connect 99acres, MagicBricks, Housing, Facebook, Google Ads or your website so leads come in by themselves.' },
  reports: { href: '/reports', label: 'Reports', help: 'Reports: leads in, calls, visits, bookings, which source works, and a calendar. Admins and managers only.' },
  money: { href: '/money', label: 'Money', help: 'Money (admins only): deals, buyer payments, commission, expenses and incentives.' },
  map: { href: '/map', label: 'Map', help: 'Map: all projects in 3D, with buildings showing where your leads want to buy.' },
  visits: { href: '/visits', label: 'Site visits', help: 'Site visits: today, tomorrow and later. To book one, open the lead → “Site visit”.' },
  messages: { href: '/messages', label: 'Message templates', help: 'Messages: ready WhatsApp messages with the client’s name filled in.' },
  profile: { href: '/profile', label: 'Profile', help: 'Profile: your name, your client form link, and log out on all devices.' },
  alerts: { href: '/notifications', label: 'Alerts', help: 'Alerts: new leads given to you, client link opened, matches and more.' },
  today: { href: '/dashboard', label: 'Today', help: 'Today: overdue calls, new leads, visits and bookings at a glance.' },
} as const;
export type PageKey = keyof typeof PAGES;

const has = (s: string, re: RegExp) => re.test(s);
const areaNames = Object.keys(AREAS).sort((a, b) => b.length - a.length);

function istDayOffset(days: number) {
  return new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
export function rangeDays(r: Range): { from: string; to: string } {
  const today = istDayOffset(0);
  if (r === 'today') return { from: today, to: today };
  if (r === 'tomorrow') { const t = istDayOffset(1); return { from: t, to: t }; }
  if (r === 'week') return { from: istDayOffset(-6), to: today };
  if (r === 'month') return { from: today.slice(0, 8) + '01', to: today };
  const d = new Date(today.slice(0, 8) + '01T00:00:00Z'); d.setUTCDate(0);
  const end = d.toISOString().slice(0, 10);
  return { from: end.slice(0, 8) + '01', to: end };
}

function findRange(s: string): Range | null {
  if (has(s, /\b(tomorrow|kal)\b/)) return 'tomorrow';
  if (has(s, /\b(today|aaj|aj)\b/)) return 'today';
  if (has(s, /last month|pichhle mahine|pichle mahine/)) return 'last_month';
  if (has(s, /\b(this month|is mahine|month|mahina|mahine)\b/)) return 'month';
  if (has(s, /\b(week|hafte|hafta|7 days|saat din)\b/)) return 'week';
  return null;
}

function budget(s: string): { bmin?: number; bmax?: number } {
  const m = s.match(/(\d+(?:\.\d+)?)\s*(l|lac|lacs|lakh|lakhs|cr|crore|crores)\b/);
  if (!m) return {};
  const v = Number(m[1]) * (/^c/.test(m[2]) ? 100 : 1);
  if (has(s, /(under|below|upto|up to|max|tak|se kam|andar|within)/)) return { bmax: v };
  if (has(s, /(above|over|more than|min|se zyada|se jyada|plus|\+)/)) return { bmin: v };
  return { bmin: Math.round(v * 0.8), bmax: Math.round(v * 1.2) };
}

/** Understands common questions without any AI. Returns 'unknown' when not sure. */
export function parseLocal(raw: string): Intent {
  const s = ` ${raw.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ')} `;

  // phone number → find that lead
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 5 && !/(lakh|lac|cr|crore|bhk|\d\s*l\b)/i.test(raw)) return { kind: 'lead', who: digits };

  // "how do I…", "where is…", "kaise…", "kahan…" → explain + link
  if (has(s, /(how|kaise|kese|kaha|kahan|where|steps|help|kya karu|kaise karu)/)) {
    const map: [RegExp, PageKey][] = [
      [/import|excel|csv|upload|bought|kharid/, 'import'], [/invite|team|employee|intern|manager|staff|add (a )?person/, 'team'],
      [/client form|requirement form|form link/, 'client_form'], [/share|send.*(project|home|link)|client link|whatsapp.*project/, 'share'],
      [/99acres|magicbricks|housing|facebook|portal|source|google ads/, 'sources'], [/report|performance/, 'reports'],
      [/money|payment|commission|expense|incentive|deal/, 'money'], [/project/, 'projects'], [/map/, 'map'],
      [/visit/, 'visits'], [/template|message/, 'messages'], [/password|profile|log ?out/, 'profile'], [/alert|notification/, 'alerts'],
      [/lead/, 'add_lead'],
    ];
    for (const [re, key] of map) if (re.test(s)) return { kind: 'page', page: key };
  }

  // counts: "how many visits this week", "kitne booking is mahine"
  if (has(s, /(how many|kitne|kitni|count|total|number of)/)) {
    const range = findRange(s) ?? 'month';
    if (has(s, /book/)) return { kind: 'count', what: 'booked', range };
    if (has(s, /visit/)) return { kind: 'count', what: 'visits_done', range };
    if (has(s, /lead|enquir|client/)) return { kind: 'count', what: 'leads', range };
  }

  // site visits list
  if (has(s, /visit/) && !has(s, /visit done|visited/) && findRange(s)) return { kind: 'visits', range: findRange(s)! };

  // projects: "projects under 60 lakh on VIP Road"
  if (has(s, /(project|property|properties|flat|available|inventory)/) && !has(s, /lead|client/)) {
    const area = areaNames.find((a) => s.includes(` ${a.toLowerCase()}`));
    const b = budget(s);
    const bhk = s.match(/(\d)\s*bhk/);
    return { kind: 'projects', area, bmax: b.bmax ?? b.bmin, bhk: bhk ? `${bhk[1]} BHK` : undefined };
  }

  // leads with filters
  const f: LeadFilters = {};
  const area = areaNames.find((a) => s.includes(` ${a.toLowerCase()}`));
  if (area) f.area = area;
  const bhk = s.match(/(\d)\s*(bhk|bed)/);
  if (bhk) f.bhk = BHKS.find((b) => b.startsWith(bhk[1])) ?? `${bhk[1]} BHK`;
  if (has(s, /\b(plot|plots|zameen|land)\b/)) f.bhk = 'Plot';
  if (has(s, /\b(villa|villas)\b/)) f.bhk = 'Villa';
  if (has(s, /\b(shop|office|commercial|dukaan)\b/)) f.bhk = 'Shop / Office';
  Object.assign(f, budget(s));
  if (has(s, /\b(hot|garam|serious|ready)\b/)) f.score = 'hot';
  else if (has(s, /\b(cold|thanda)\b/)) f.score = 'cold';
  else if (has(s, /\bwarm\b/)) f.score = 'warm';
  if (has(s, /\b(lost|chhod|gaya|gaye|rejected)\b/)) f.stage = 'lost';
  else if (has(s, /\b(booked|booking|bik gaya)\b/)) f.stage = 'booked';
  else if (has(s, /(visit done|visited|visit ho gaya)/)) f.stage = 'visited';
  else if (has(s, /(negotiat|bargain|mol bhav)/)) f.stage = 'negotiation';
  else if (has(s, /\b(token)\b/)) f.stage = 'token';
  else if (has(s, /\b(interested)\b/)) f.stage = 'qualified';
  else if (has(s, /\b(new|naye|naya|fresh|not called)\b/)) f.stage = 'new';
  if (has(s, /(overdue|missed|late|pending|baaki|chhoot)/)) f.fu = 'over';
  else if (has(s, /(follow ?up|call).*(today|aaj)|(today|aaj).*(call|follow)/)) f.fu = 'today';
  else if (has(s, /(no next|not planned|no follow)/)) f.fu = 'none';
  else if (has(s, /(untouched|nobody touched|stale|purane|old leads)/)) f.fu = 'stale';
  const src = SOURCES.find((x) => s.includes(` ${x.toLowerCase()}`) || (x === 'Facebook' && s.includes(' fb ')));
  if (src) f.source = src;
  if (has(s, /(investment|invest)/)) f.purpose = 'Investment';
  const r = findRange(s);
  if (r && has(s, /(came|aaye|aayi|new lead|enquir|leads? (from|in))/)) Object.assign(f, rangeDays(r));
  if (Object.keys(f).length) return { kind: 'leads', f };

  // "Rahul ka number", "find Priya", "show lead Amit"
  const name = raw.match(/^(?:find|search|show|open|call|lead)?\s*([A-Za-z][A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(?:ka|ki|ke)\s+(?:number|phone|details|lead)/i)
    || raw.match(/^(?:find|search|show|open|call)\s+(?:lead\s+)?([A-Za-z][A-Za-z]+(?:\s+[A-Za-z]+)?)\s*$/i);
  if (name) return { kind: 'lead', who: name[1].trim() };

  return { kind: 'unknown' };
}

/** Builds the Leads page link for a set of filters (so the person can open the full list). */
export function leadsHref(f: LeadFilters) {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v !== undefined && v !== '') p.set(k, String(v)); });
  return `/leads${p.toString() ? '?' + p : ''}`;
}
