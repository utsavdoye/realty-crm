import { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/context';
import { BHKS, LOST_REASONS, OUTCOMES, fmtBudget, stageLabel } from '@/lib/crm';

export const runtime = 'nodejs';
export const maxDuration = 30;
const MAX_BYTES = 3_500_000; // about 90 seconds

/**
 * After a call: the employee speaks a short voice note ("Client ne bola 3BHK chahiye, 80 lakh tak, Saturday 11 baje visit…").
 * Gemini turns it into the call form: what happened, note, next call time, site visit time, and updated needs.
 * Nothing is saved here — the employee checks the form and presses "Save call".
 */
export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: 'Voice filling is not set up yet. An admin needs to add GEMINI_API_KEY.' }, { status: 503 });
  const { supabase, org, role } = await requireOrg();
  const form = await req.formData().catch(() => null);
  const audio = form?.get('audio');
  const leadId = String(form?.get('lead_id') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(leadId)) return NextResponse.json({ error: 'Lead not found.' }, { status: 400 });
  if (!(audio instanceof Blob) || audio.size < 2000) return NextResponse.json({ error: 'Could not hear anything. Try again and speak a little longer.' }, { status: 400 });
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: 'Too long. Keep it under 90 seconds.' }, { status: 413 });
  if (audio.type && !/^audio\//.test(audio.type)) return NextResponse.json({ error: 'That is not a voice recording.' }, { status: 415 });
  if (role === 'partner') return NextResponse.json({ error: 'Voice filling is for the team only.' }, { status: 403 });
  const hindi = form?.get('lang') === 'hi';
  const noteLang = hindi ? 'simple Hindi in Devanagari script (हिंदी)' : 'simple English';
  // Daily limit per person (keeps the free AI quota for everyone). If the limit check itself is not set up yet, carry on.
  const { data: allowed, error: limitErr } = await supabase.rpc('ai_ok', { p_kind: 'voice' });
  if (!limitErr && allowed === false) return NextResponse.json({ error: 'Daily voice limit reached. Please type it for now; it resets tomorrow.' }, { status: 429 });

  // Only leads this person is allowed to see (database rules decide).
  const { data: lead } = await supabase.from('leads').select('name, stage, bhk, budget_min, budget_max, location').eq('id', leadId).eq('org_id', org.id).maybeSingle();
  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });

  const now = new Date();
  const today = now.toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const prompt = `A real-estate salesperson in India just finished a phone call with a client and is describing it in a voice note
(Hindi, English or Hinglish). Fill the call form from what they SAY. Use "" for anything not said. Never invent.

Client: ${lead.name}. Current stage: ${stageLabel(lead.stage)}. Known needs: ${[lead.bhk, fmtBudget(lead.budget_min, lead.budget_max), lead.location].filter(Boolean).join(', ') || 'none yet'}.
Right now it is ${today} (India time).

Fields:
- outcome: exactly one of ${OUTCOMES.map((o) => `"${o.k}" (${o.l})`).join(', ')}.
- reason: only if outcome is "notint": one of ${LOST_REASONS.map((r) => `"${r}"`).join(', ')}.
- next: when to call next, as "YYYY-MM-DDTHH:MM" in India time. Work out dates like "kal", "parso", "Saturday", "next week" from today. If only a day is said, use 11:00. If not said, "".
- visit_at: if a SITE VISIT was fixed, its time as "YYYY-MM-DDTHH:MM" (same rules). Else "".
- bhk: if they said what home they want: one of ${BHKS.map((b) => `"${b}"`).join(', ')}.
- budget: if a budget was said, short like "60 L to 80 L", "up to 1.2 Cr".
- location: areas they want, comma separated, proper spelling.
- note: a short clean summary of the call in ${noteLang} (family, loan, objections, what to send them). Keep it under 60 words.
- transcript: what was said, written in ${noteLang}. If they spoke another language, translate it faithfully.
- Keep names, places, numbers and the fixed choices above in English letters, whatever language is used for note and transcript.`;

  const bytes = Buffer.from(await audio.arrayBuffer()).toString('base64');
  const str = { type: 'STRING' };
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'audio/wav', data: bytes } }, { text: prompt }] }],
    generationConfig: {
      temperature: 0, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { transcript: str, outcome: str, reason: str, next: str, visit_at: str, bhk: str, budget: str, location: str, note: str }, required: ['transcript', 'outcome'] },
    },
  });
  // Try the main model, then a second one if the first is busy (free tier limits).
  let res: Response | null = null;
  for (const model of [process.env.GEMINI_MODEL || 'gemini-flash-latest', 'gemini-flash-lite-latest']) {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body, signal: AbortSignal.timeout(25000),
    }).catch(() => null);
    if (res?.ok) break;
  }
  if (!res || !res.ok) {
    return NextResponse.json({ error: res?.status === 429 ? 'Voice is busy right now. Wait a minute, or type this one.' : 'Voice service did not answer. Please type this one.' }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  let out: Record<string, string> = {};
  try { out = JSON.parse(text); } catch { return NextResponse.json({ error: 'Could not understand the recording. Try again.' }, { status: 502 }); }

  const s = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const when = (v: unknown) => {
    const x = s(v, 20);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x)) return '';
    const t = new Date(`${x}:00+05:30`).getTime();
    return t > Date.now() - 3600000 && t < Date.now() + 120 * 86400000 ? x : '';
  };
  const outcome = OUTCOMES.some((o) => o.k === out.outcome) ? out.outcome : '';
  const fields: Record<string, string> = {
    outcome,
    reason: outcome === 'notint' && LOST_REASONS.includes(out.reason as never) ? out.reason : '',
    next: when(out.next),
    visit_at: when(out.visit_at),
    upd_bhk: (BHKS as readonly string[]).includes(out.bhk) ? out.bhk : '',
    upd_budget: s(out.budget, 40),
    upd_location: s(out.location, 120),
    note: s(out.note),
  };
  return NextResponse.json({ transcript: s(out.transcript, 2000), fields });
}
