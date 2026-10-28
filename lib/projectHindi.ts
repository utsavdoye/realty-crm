import 'server-only';
import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

// Hindi version of a project's details, made once when the project is saved (Gemini, free key)
// and stored in projects.hi. The website shows it when a visitor picks हिंदी.

export const HI_FIELDS = ['location', 'type', 'configs', 'status', 'possession', 'amenities', 'highlights', 'towers', 'developer'] as const;
type Src = Partial<Record<(typeof HI_FIELDS)[number], string | null>>;

const fingerprint = (s: Src) => createHash('sha1').update(JSON.stringify(HI_FIELDS.map((k) => (s[k] ?? '').trim()))).digest('hex').slice(0, 16);

async function gemini(src: Record<string, string>): Promise<Record<string, string> | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const prompt = `Translate these real estate project details from English to natural, simple Hindi (Devanagari) for an Indian property website.
Rules:
- Write place names in Devanagari as people in Chhattisgarh say them (Naya Raipur → नया रायपुर, Atal Nagar → अटल नगर, Sector 31 → सेक्टर 31, Shankar Nagar → शंकर नगर).
- Keep numbers as digits. Keep "BHK", "RERA", "CCTV", "GST", bank names and company or brand names in English letters.
- Lists separated by commas stay lists separated by commas, same order, same count. Drop the word "Others".
- Month names in Hindi (Oct, 2031 → अक्टूबर 2031).
- Do not add anything that is not in the English.
Return JSON with exactly the same keys.
${JSON.stringify(src)}`;
  for (const model of [process.env.GEMINI_TRANSLATE_MODEL || 'gemini-flash-latest', 'gemini-flash-lite-latest']) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res?.ok) continue;
    const data = await res.json().catch(() => null);
    const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    try {
      const out = JSON.parse(text) as Record<string, unknown>;
      const clean: Record<string, string> = {};
      for (const k of Object.keys(src)) if (typeof out[k] === 'string' && out[k]) clean[k] = (out[k] as string).slice(0, 1200);
      if (Object.keys(clean).length) return clean;
    } catch { /* next model */ }
  }
  return null;
}

/** Makes / refreshes the Hindi copy of one project if its English changed. Never throws. */
export async function translateProject(projectId: string): Promise<'done' | 'same' | 'skipped' | 'failed'> {
  try {
    const admin = createAdminClient();
    if (!admin || !process.env.GEMINI_API_KEY) return 'skipped';
    const { data: p, error } = await admin.from('projects').select(`id, hi_src, ${HI_FIELDS.join(', ')}`).eq('id', projectId).maybeSingle();
    if (error || !p) return 'skipped'; // patch-041 not run yet
    const row = p as unknown as Src & { hi_src: string | null };
    const fp = fingerprint(row);
    if (row.hi_src === fp) return 'same';
    const src: Record<string, string> = {};
    for (const k of HI_FIELDS) { const v = (row[k] ?? '').trim(); if (v) src[k] = v; }
    const hi = Object.keys(src).length ? await gemini(src) : {};
    if (!hi) return 'failed';
    await admin.from('projects').update({ hi, hi_src: fp }).eq('id', projectId);
    return 'done';
  } catch { return 'failed'; }
}

/** Fills in Hindi for projects that don't have it yet (or whose English changed). Small batches, so it stays quick. */
export async function translateMissing(orgId: string, max = 4): Promise<{ done: number; left: number }> {
  const admin = createAdminClient();
  if (!admin || !process.env.GEMINI_API_KEY) return { done: 0, left: 0 };
  const { data, error } = await admin.from('projects').select(`id, hi_src, ${HI_FIELDS.join(', ')}`).eq('org_id', orgId);
  if (error || !data) return { done: 0, left: 0 };
  const stale = (data as unknown as (Src & { id: string; hi_src: string | null })[]).filter((p) => p.hi_src !== fingerprint(p));
  let done = 0;
  for (const p of stale.slice(0, max)) if ((await translateProject(p.id)) === 'done') done++;
  return { done, left: Math.max(0, stale.length - done) };
}
