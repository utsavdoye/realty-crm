import { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/context';
import { BHKS, CATEGORIES, FUNDING, OCCUPATIONS, PTYPES, PURPOSES, SCORE_KEYS, SOURCES, budgetKey, parseBudget } from '@/lib/crm';
import { normPhone, validPhone } from '@/lib/roles';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BYTES = 3_500_000; // about 90 seconds of voice

/**
 * Voice → lead form. Gets a short WAV recording, asks Gemini to hear it (Hindi, English or Hinglish)
 * and returns the form fields. Nothing is saved here: the person checks the form and presses Save.
 */
export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: 'Voice filling is not set up yet. An admin needs to add GEMINI_API_KEY.' }, { status: 503 });
  const { supabase, org, role } = await requireOrg();

  const form = await req.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!(audio instanceof Blob) || audio.size < 2000) return NextResponse.json({ error: 'Could not hear anything. Try again and speak a little longer.' }, { status: 400 });
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: 'Too long. Keep it under 90 seconds.' }, { status: 413 });
  if (audio.type && !/^audio\//.test(audio.type)) return NextResponse.json({ error: 'That is not a voice recording.' }, { status: 415 });
  if (role === 'partner') return NextResponse.json({ error: 'Voice filling is for the team only.' }, { status: 403 });
  const hindi = form?.get('lang') === 'hi';
  const noteLang = hindi ? 'simple Hindi in Devanagari script (हिंदी)' : 'simple English';
  // Daily limit per person (keeps the free AI quota for everyone). If the limit check itself is not set up yet, carry on.
  const { data: allowed, error: limitErr } = await supabase.rpc('ai_ok', { p_kind: 'voice' });
  if (!limitErr && allowed === false) return NextResponse.json({ error: 'Daily voice limit reached. Please type it for now; it resets tomorrow.' }, { status: 429 });

  const { data: projects } = await supabase.from('projects').select('name').eq('org_id', org.id).limit(100);
  const projectNames = (projects ?? []).map((p) => p.name);

  const prompt = `You help a real-estate sales team in India fill a new client (lead) form.
Listen to the voice note. The person may speak Hindi, English, other Indian-language words, or a mix (Hinglish).
Return ONLY what was actually said. Use "" for anything not mentioned. Never invent details.

Rules:
- name: the client's name in English letters (e.g. "राहुल शर्मा" → "Rahul Sharma").
- phone: digits only; for a number outside India start with + and the country code (e.g. +971501234567). Numbers may be spoken in Hindi ("nau aath chaar…") or English or in groups ("double five"). If you are not sure of every digit, return "".
- email: lower case, "at" → "@", "dot" → ".".
- budget: short form like "80 L to 1 Cr", "1.2 Cr", "up to 60 L". "lakh/lac/lakhs" → L, "crore/cr" → Cr.
- category: one of ${CATEGORIES.map((x) => `"${x}"`).join(', ')}. (flat/villa/house = Residential, shop/office = Commercial, khet/farm = Farm land)
- bhk (configuration): one of ${BHKS.map((x) => `"${x}"`).join(', ')}. "" for shops, offices and plots.
- property_type: one of ${PTYPES.map((x) => `"${x}"`).join(', ')}. (flat = Apartment, plot/site = Plot, shop/showroom = Retail, office = Office, khet = Farm land)
- city: the city where the client lives now, if said (e.g. "Raipur", "Bilaspur").
- pincode: 6-digit pincode of where they live, only if said.
- occupation: one of ${OCCUPATIONS.map((x) => `"${x}"`).join(', ')}, only if said.
- funding: one of ${FUNDING.map((x) => `"${x}"`).join(', ')}. (loan / bank / finance = "Home loan / finance"; own money = "Self-funded")
- location: the area(s) they want, comma separated, proper spelling. For Naya Raipur use "Naya Raipur – Sector N" or "Naya Raipur (sector not sure)" (e.g. "Whitefield, Sarjapur Road").
- purpose: one of ${PURPOSES.map((x) => `"${x}"`).join(', ')}. (rehne ke liye / own use = Self use; investment / rent = Investment)
- preferred_slot: when to call or meet, short English (e.g. "Saturday morning", "Weekdays after 7 PM").
- source: where the client came from, one of ${SOURCES.map((x) => `"${x}"`).join(', ')}.
- project: if they named one of these projects, return its exact name: ${projectNames.length ? projectNames.map((x) => `"${x}"`).join(', ') : '(none)'}.
- score: "hot" if ready to buy soon or wants a visit, "cold" if just looking, "later" if they will buy after some months, else "warm". "" if unclear.
- dob: client's date of birth as YYYY-MM-DD only if fully said.
- note: everything else useful, in short ${noteLang} (family, loan status, timeline, must-haves).
- transcript: what was said, written in ${noteLang}. If they spoke another language, translate it faithfully.
- name, phone, email, location, preferred_slot and the fixed choices stay in English letters, whatever language is used for note and transcript.`;

  const bytes = Buffer.from(await audio.arrayBuffer()).toString('base64');
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const str = { type: 'STRING' };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'audio/wav', data: bytes } }, { text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { transcript: str, name: str, phone: str, email: str, budget: str, category: str, bhk: str, property_type: str, city: str, pincode: str, occupation: str, funding: str, location: str, purpose: str, preferred_slot: str, source: str, project: str, score: str, dob: str, note: str },
          required: ['transcript'],
        },
      },
    }),
  }).catch(() => null);

  if (!res || !res.ok) {
    const detail = res ? await res.text().catch(() => '') : '';
    console.error('voice: gemini error', res?.status, detail.slice(0, 300));
    return NextResponse.json({ error: res?.status === 429 ? 'Too many voice notes right now. Wait a minute and try again.' : 'Voice service did not answer. Please type this one.' }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  let out: Record<string, string> = {};
  try { out = JSON.parse(text); } catch { return NextResponse.json({ error: 'Could not understand the recording. Try again.' }, { status: 502 }); }

  // keep only safe, known values
  const pick = (v: unknown, list?: readonly string[]) => {
    const s = typeof v === 'string' ? v.trim().slice(0, 500) : '';
    if (!s) return '';
    if (!list) return s;
    return list.find((x) => x.toLowerCase() === s.toLowerCase()) ?? '';
  };
  const phone = normPhone(String(out.phone ?? ''));
  return NextResponse.json({
    transcript: pick(out.transcript),
    fields: {
      name: pick(out.name).slice(0, 120),
      phone: validPhone(phone) ? phone : '',
      email: /^\S+@\S+\.\S+$/.test(String(out.email ?? '')) ? pick(out.email).toLowerCase() : '',
      budget: (() => { const b = parseBudget(pick(out.budget).slice(0, 40)); return b ? budgetKey(b.min, b.max) : ''; })(),
      category: pick(out.category, CATEGORIES),
      bhk: pick(out.bhk, BHKS),
      property_type: pick(out.property_type, PTYPES),
      city: pick(out.city).slice(0, 80),
      pincode: /^[1-9]\d{5}$/.test(String(out.pincode ?? '').replace(/\s/g, '')) ? String(out.pincode).replace(/\s/g, '') : '',
      occupation: pick(out.occupation, OCCUPATIONS),
      funding: pick(out.funding, FUNDING),
      location: pick(out.location).slice(0, 120),
      purpose: pick(out.purpose, PURPOSES),
      preferred_slot: pick(out.preferred_slot).slice(0, 80),
      source: pick(out.source, SOURCES),
      project: pick(out.project, projectNames),
      score: pick(out.score, SCORE_KEYS),
      dob: /^\d{4}-\d{2}-\d{2}$/.test(String(out.dob ?? '')) ? String(out.dob) : '',
      note: pick(out.note),
    },
  });
}
