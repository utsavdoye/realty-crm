'use server';

import { requireOrg } from '@/lib/context';
import { PAGES, leadsHref, parseLocal, rangeDays, type Intent, type LeadFilters, type PageKey, type Range } from '@/lib/ask';
import { BHKS, SOURCES, STAGES, fmtBudget, fmtDT, stageLabel } from '@/lib/crm';
import { AREAS } from '@/lib/places';
import { isManager } from '@/lib/roles';

export type AskItem = { title: string; sub?: string; href?: string; tel?: string };
export type AskAnswer = { text: string; items?: AskItem[]; link?: { href: string; label: string }; via: 'quick' | 'ai' | 'search'; error?: string };

// --- small protections so the free AI never gets flooded ---
const cache = new Map<string, { at: number; intent: Intent }>();
const hits = new Map<string, number[]>();
const tooMany = (uid: string) => {
  const now = Date.now();
  const list = (hits.get(uid) ?? []).filter((t) => now - t < 60_000);
  list.push(now); hits.set(uid, list);
  return list.length > 12; // more than 12 AI questions a minute from one person
};

/** Asks Gemini (free tier) to turn a question into the same safe search format. Never sees any data. */
async function aiIntent(question: string): Promise<Intent | null> {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  const norm = question.trim().toLowerCase();
  const c = cache.get(norm); if (c && Date.now() - c.at < 86_400_000) return c.intent;
  const str = { type: 'STRING' }, num = { type: 'NUMBER' };
  const prompt = `You turn a question from a real-estate sales team in India (English, Hindi or Hinglish) into a search.
Kinds:
- "leads": find clients by filters. Fields: q (name or free text), stage (${STAGES.map((s) => s.k).join('/')}/lost), score (hot/warm/cold),
  source (${SOURCES.join('/')}), area (place name), bhk (${BHKS.join('/')}), purpose (Self use/Investment/Both),
  bmin and bmax (budget in LAKH; 1 crore = 100), fu (over = follow-up missed, today = due today, none = no next call, stale = untouched 14+ days),
  range (today/week/month/last_month) for when the lead came in.
- "lead": one client by name or mobile, put it in "who".
- "visits": site visits list, range today/tomorrow/week.
- "count": a number. what = leads/booked/visits_done, range = today/week/month/last_month.
- "projects": projects for sale, optional area, bmax (lakh), bhk.
- "page": the person asks how/where to do something. page = one of ${Object.keys(PAGES).join(', ')}.
- "unknown": anything else.
Only fill fields the question actually mentions. Question: ${JSON.stringify(question.slice(0, 300))}`;
  const models = [process.env.GEMINI_ASK_MODEL || 'gemini-flash-lite-latest', 'gemini-flash-latest'];
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0, responseMimeType: 'application/json',
          responseSchema: { type: 'OBJECT', properties: { kind: str, q: str, stage: str, score: str, source: str, area: str, bhk: str, purpose: str, bmin: num, bmax: num, fu: str, range: str, who: str, what: str, page: str }, required: ['kind'] },
        },
      }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!res) continue;
    if (!res.ok) { if (res.status === 429 || res.status === 404 || res.status >= 500) continue; return null; }
    const data = await res.json().catch(() => null);
    const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    try {
      const intent = toIntent(JSON.parse(text));
      cache.set(norm, { at: Date.now(), intent });
      if (cache.size > 500) cache.delete(cache.keys().next().value!);
      return intent;
    } catch { return null; }
  }
  return null;
}

/** Cleans what the AI returned: only known values get through. */
function toIntent(o: Record<string, unknown>): Intent {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined);
  const n = (v: unknown) => (typeof v === 'number' && v > 0 && v < 100000 ? v : undefined);
  const range = (v: unknown): Range | undefined => (['today', 'tomorrow', 'week', 'month', 'last_month'].includes(v as string) ? (v as Range) : undefined);
  switch (o.kind) {
    case 'leads': {
      const f: LeadFilters = {};
      const stage = s(o.stage); if (stage && (STAGES.some((x) => x.k === stage) || stage === 'lost')) f.stage = stage;
      const score = s(o.score); if (score && ['hot', 'warm', 'cold'].includes(score)) f.score = score;
      const source = s(o.source); if (source && SOURCES.includes(source)) f.source = source;
      const bhk = s(o.bhk); if (bhk && (BHKS as readonly string[]).includes(bhk)) f.bhk = bhk;
      const purpose = s(o.purpose); if (purpose && ['Self use', 'Investment', 'Both'].includes(purpose)) f.purpose = purpose;
      const fu = s(o.fu); if (fu && ['over', 'today', 'none', 'stale'].includes(fu)) f.fu = fu as LeadFilters['fu'];
      const area = s(o.area); if (area) f.area = Object.keys(AREAS).find((a) => a.toLowerCase() === area.toLowerCase()) ?? area;
      if (n(o.bmin)) f.bmin = n(o.bmin); if (n(o.bmax)) f.bmax = n(o.bmax);
      const q = s(o.q); if (q) f.q = q;
      const r = range(o.range); if (r) Object.assign(f, rangeDays(r));
      return Object.keys(f).length ? { kind: 'leads', f } : { kind: 'unknown' };
    }
    case 'lead': return s(o.who) ? { kind: 'lead', who: s(o.who)! } : { kind: 'unknown' };
    case 'visits': return { kind: 'visits', range: range(o.range) ?? 'today' };
    case 'count': {
      const what = ['leads', 'booked', 'visits_done'].includes(o.what as string) ? (o.what as 'leads') : 'leads';
      return { kind: 'count', what, range: range(o.range) ?? 'month' };
    }
    case 'projects': return { kind: 'projects', area: s(o.area), bmax: n(o.bmax), bhk: s(o.bhk) };
    case 'page': return s(o.page) && s(o.page)! in PAGES ? { kind: 'page', page: s(o.page) as PageKey } : { kind: 'unknown' };
    default: return { kind: 'unknown' };
  }
}

const clean = (v: string) => v.replace(/[%_,()."'\\]/g, '').slice(0, 60);
const RANGE_WORD: Record<Range, string> = { today: 'today', tomorrow: 'tomorrow', week: 'in the last 7 days', month: 'this month', last_month: 'last month' };

/** The Ask box. Uses the person's own login, so an employee only ever sees their own leads. */
export async function askHelper(question: string): Promise<AskAnswer> {
  const { supabase, org, role, user } = await requireOrg();
  const qText = String(question ?? '').trim().slice(0, 300);
  if (qText.length < 2) return { text: 'Type what you are looking for, e.g. “hot leads on VIP Road under 60 lakh”.', via: 'quick' };

  let intent = parseLocal(qText);
  let via: AskAnswer['via'] = 'quick';
  if (intent.kind === 'unknown' && !tooMany(user.id)) {
    const ai = await aiIntent(qText);
    if (ai && ai.kind !== 'unknown') { intent = ai; via = 'ai'; }
  }
  // Never get stuck: if nothing understood it, search lead names and areas with the words typed.
  if (intent.kind === 'unknown') { intent = { kind: 'leads', f: { q: qText.split(/\s+/).slice(0, 3).join(' ') } }; via = 'search'; }

  const mgr = isManager(role);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  if (intent.kind === 'page') {
    const p = PAGES[intent.page];
    const blocked = (intent.page === 'money' && role !== 'owner') || (['reports', 'sources', 'team', 'import'].includes(intent.page) && !mgr);
    return blocked
      ? { text: `${p.help} You don’t have access to this page; ask an admin.`, via }
      : { text: p.help, link: { href: p.href, label: `Open ${p.label}` }, via };
  }

  if (intent.kind === 'lead') {
    const who = clean(intent.who);
    const digits = who.replace(/\D/g, '');
    let q = supabase.from('leads').select('id, name, phone, stage, location, bhk, budget_min, budget_max').eq('org_id', org.id).limit(6);
    q = digits.length >= 5 ? q.ilike('phone', `%${digits}%`) : q.ilike('name', `%${who}%`);
    const { data } = await q;
    const rows = data ?? [];
    if (!rows.length) return { text: `No lead found for “${intent.who}”.${mgr ? '' : ' You only see leads given to you.'}`, via };
    return {
      text: rows.length === 1 ? `Found ${rows[0].name}.` : `Found ${rows.length}${rows.length === 6 ? '+' : ''} leads.`,
      items: rows.map((l) => ({ title: l.name, sub: [stageLabel(l.stage), l.bhk, fmtBudget(l.budget_min, l.budget_max), l.location].filter(Boolean).join(' · '), href: `/leads/${l.id}`, tel: l.phone })),
      link: digits.length >= 5 ? undefined : { href: `/leads?q=${encodeURIComponent(who)}`, label: 'See all matches' }, via,
    };
  }

  if (intent.kind === 'visits') {
    const r = rangeDays(intent.range === 'week' ? 'week' : intent.range);
    const from = intent.range === 'week' ? today : r.from;
    const to = intent.range === 'week' ? new Date(Date.now() + 6 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : r.to;
    let q = supabase.from('visits').select('id, at, status, lead_id, agent_id, leads(name, phone), projects(name)', { count: 'exact' })
      .eq('org_id', org.id).gte('at', `${from}T00:00:00+05:30`).lte('at', `${to}T23:59:59+05:30`).order('at').limit(6);
    if (!mgr) q = q.eq('agent_id', user.id);
    const { data, count } = await q;
    type V = { id: string; at: string; status: string; lead_id: string; leads: { name: string; phone: string } | null; projects: { name: string } | null };
    const rows = (data ?? []) as unknown as V[];
    const word = intent.range === 'week' ? 'in the next 7 days' : intent.range;
    return {
      text: count ? `${count} site visit${count === 1 ? '' : 's'} ${word}.` : `No site visits ${word}.`,
      items: rows.map((v) => ({ title: `${fmtDT(v.at)} · ${v.leads?.name ?? 'Client'}`, sub: [v.projects?.name, v.status !== 'scheduled' ? v.status : ''].filter(Boolean).join(' · '), href: `/leads/${v.lead_id}`, tel: v.leads?.phone })),
      link: { href: '/visits', label: 'Open site visits' }, via,
    };
  }

  if (intent.kind === 'count') {
    const r = rangeDays(intent.range);
    const a = `${r.from}T00:00:00+05:30`, b = `${r.to}T23:59:59+05:30`;
    if (intent.what === 'visits_done') {
      let q = supabase.from('visits').select('id', { count: 'exact', head: true }).eq('org_id', org.id).eq('status', 'done').gte('at', a).lte('at', b);
      if (!mgr) q = q.eq('agent_id', user.id);
      const { count } = await q;
      return { text: `${count ?? 0} site visit${count === 1 ? '' : 's'} done ${RANGE_WORD[intent.range]}.`, link: { href: '/visits', label: 'Open site visits' }, via };
    }
    const col = intent.what === 'booked' ? 'booked_at' : 'created_at';
    const { count } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('org_id', org.id).gte(col, a).lte(col, b);
    const noun = intent.what === 'booked' ? 'booking' : 'new lead';
    const f: LeadFilters = intent.what === 'booked' ? { stage: 'booked' } : { from: r.from, to: r.to };
    return { text: `${count ?? 0} ${noun}${count === 1 ? '' : 's'} ${RANGE_WORD[intent.range]}${mgr ? '' : ' (your leads)'}.`, link: { href: leadsHref(f), label: 'See them' }, via };
  }

  if (intent.kind === 'projects') {
    let q = supabase.from('projects').select('id, name, location, configs, price_from, price_to, status').eq('org_id', org.id).neq('status', 'Sold out').order('price_from').limit(6);
    if (intent.area) q = q.ilike('location', `%${clean(intent.area)}%`);
    if (intent.bmax) q = q.lte('price_from', intent.bmax);
    if (intent.bhk) q = q.ilike('configs', `%${clean(intent.bhk.replace(/\s*BHK/i, ''))}%`);
    const { data } = await q;
    const rows = data ?? [];
    return {
      text: rows.length ? `${rows.length}${rows.length === 6 ? '+' : ''} project${rows.length === 1 ? '' : 's'} match.` : 'No projects match that. Try a bigger budget or another area.',
      items: rows.map((p) => ({ title: p.name, sub: [p.location, p.configs, fmtBudget(p.price_from, p.price_to), p.status].filter(Boolean).join(' · '), href: '/projects' })),
      link: { href: '/projects', label: 'Open projects' }, via,
    };
  }

  // leads list
  const f = intent.f;
  let q = supabase.from('leads').select('id, name, phone, stage, score, location, bhk, budget_min, budget_max, next_follow_up', { count: 'exact' }).eq('org_id', org.id);
  const now = new Date().toISOString();
  const ors: string[] = [];
  if (f.stage) q = q.eq('stage', f.stage);
  if (f.score) q = q.eq('score', f.score);
  if (f.source) q = q.eq('source', f.source);
  if (f.bhk) q = q.eq('bhk', f.bhk);
  if (f.purpose) q = q.eq('purpose', f.purpose);
  if (f.area) q = q.ilike('location', `%${clean(f.area)}%`);
  if (f.bmin) q = q.gte('budget_max', f.bmin);
  if (f.bmax) ors.push(`budget_min.lte.${f.bmax},and(budget_min.is.null,budget_max.lte.${f.bmax})`);
  if (f.from) q = q.gte('created_at', `${f.from}T00:00:00+05:30`);
  if (f.to) q = q.lte('created_at', `${f.to}T23:59:59+05:30`);
  if (f.fu === 'over') q = q.lt('next_follow_up', now).not('stage', 'in', '(booked,lost)');
  if (f.fu === 'today') q = q.gte('next_follow_up', now).lt('next_follow_up', `${today}T23:59:59+05:30`).not('stage', 'in', '(booked,lost)');
  if (f.fu === 'none') q = q.is('next_follow_up', null).not('stage', 'in', '(new,booked,lost)');
  if (f.q) ors.push(`name.ilike.%${clean(f.q)}%,location.ilike.%${clean(f.q)}%`);
  if (ors.length === 1) q = q.or(ors[0]); else if (ors.length > 1) q = q.or(`and(${ors.map((o) => `or(${o})`).join(',')})`);
  const { data, count } = await q.order('next_follow_up', { ascending: true, nullsFirst: false }).limit(5);
  const rows = data ?? [];
  const n = count ?? rows.length;
  const before = [f.score, f.stage && stageLabel(f.stage).toLowerCase(), f.bhk].filter(Boolean).join(' ');
  const after = [f.area && `in ${f.area}`, (f.bmin || f.bmax) && `(${fmtBudget(f.bmin ?? null, f.bmax ?? null)})`, f.source && `from ${f.source}`,
    f.fu === 'over' && 'with a missed follow-up', f.fu === 'today' && 'to call today', f.fu === 'none' && 'with no next call planned']
    .filter(Boolean).join(' ');
  const noun = (k: number) => `${before ? before + ' ' : ''}lead${k === 1 ? '' : 's'}${after ? ' ' + after : ''}`;
  const text = !n
    ? via === 'search' ? `I could not find anything for “${qText}”. Try words like “hot leads VIP Road”, “visits today” or “how to import leads”.` : `No ${noun(2)}.${mgr ? '' : ' (You only see leads given to you.)'}`
    : n > 5 ? `${n} ${noun(n)}. Here are the first 5; open the list to see all.` : `${n} ${noun(n)}.`;
  return {
    text: text.replace(/\s+/g, ' '),
    items: rows.map((l) => ({ title: l.name, sub: [stageLabel(l.stage), l.bhk, fmtBudget(l.budget_min, l.budget_max), l.location].filter(Boolean).join(' · '), href: `/leads/${l.id}`, tel: l.phone })),
    link: n ? { href: leadsHref(f), label: n > 5 ? `Open all ${n}` : 'Open in Leads' } : undefined, via,
  };
}
