import { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/context';
import { BHKS, PTYPES, PURPOSES, SOURCES } from '@/lib/crm';

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
  const { supabase, org } = await requireOrg();

  const form = await req.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!(audio instanceof Blob) || audio.size < 2000) return NextResponse.json({ error: 'Could not hear anything. Try again and speak a little longer.' }, { status: 400 });
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: 'Too long. Keep it under 90 seconds.' }, { status: 413 });

  const { data: projects } = await supabase.from('projects').select('name').eq('org_id', org.id).limit(100);
  const projectNames = (projects ?? []).map((p) => p.name);

  const prompt = `You help a real-estate sales team in Bengaluru, India fill a new client (lead) form.
Listen to the voice note. The person may speak Hindi, English, Kannada words, or a mix (Hinglish).
Return ONLY what was actually said. Use "" for anything not mentioned. Never invent details.

Rules:
- name: the client's name in English letters (e.g. "राहुल शर्मा" → "Rahul Sharma").
- phone: digits only. Numbers may be spoken in Hindi ("nau aath chaar…") or English or in groups ("double five"). If you are not sure of every digit, return "".
- email: lower case, "at" → "@", "dot" → ".".
- budget: short form like "80 L to 1 Cr", "1.2 Cr", "up to 60 L". "lakh/lac/lakhs" → L, "crore/cr" → Cr.
- bhk: one of ${BHKS.map((x) => `"${x}"`).join(', ')}.
- property_type: one of ${PTYPES.map((x) => `"${x}"`).join(', ')}. (flat = Apartment, plot/site/land = Plot, office/shop = Commercial)
- location: the area(s) in Bengaluru they want, comma separated, proper spelling (e.g. "Whitefield, Sarjapur Road").
- purpose: one of ${PURPOSES.map((x) => `"${x}"`).join(', ')}. (rehne ke liye / own use = Self use; investment / rent = Investment)
- preferred_slot: when to call or meet, short English (e.g. "Saturday morning", "Weekdays after 7 PM").
- source: where the client came from, one of ${SOURCES.map((x) => `"${x}"`).join(', ')}.
- project: if they named one of these projects, return its exact name: ${projectNames.length ? projectNames.map((x) => `"${x}"`).join(', ') : '(none)'}.
- score: "hot" if ready to buy soon or wants a visit, "cold" if just looking, else "warm". "" if unclear.
- dob: client's date of birth as YYYY-MM-DD only if fully said.
- note: everything else useful, in short simple English (family, loan status, timeline, must-haves).
- transcript: what was said, word for word, in the language spoken (Roman letters for Hindi are fine).`;

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
          properties: { transcript: str, name: str, phone: str, email: str, budget: str, bhk: str, property_type: str, location: str, purpose: str, preferred_slot: str, source: str, project: str, score: str, dob: str, note: str },
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
  const digits = String(out.phone ?? '').replace(/\D/g, '');
  const phone = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  return NextResponse.json({
    transcript: pick(out.transcript),
    fields: {
      name: pick(out.name).slice(0, 120),
      phone: /^[6-9]\d{9}$/.test(phone) ? phone : '',
      email: /^\S+@\S+\.\S+$/.test(String(out.email ?? '')) ? pick(out.email).toLowerCase() : '',
      budget: pick(out.budget).slice(0, 40),
      bhk: pick(out.bhk, BHKS),
      property_type: pick(out.property_type, PTYPES),
      location: pick(out.location).slice(0, 120),
      purpose: pick(out.purpose, PURPOSES),
      preferred_slot: pick(out.preferred_slot).slice(0, 80),
      source: pick(out.source, SOURCES),
      project: pick(out.project, projectNames),
      score: pick(out.score, ['hot', 'warm', 'cold']),
      dob: /^\d{4}-\d{2}-\d{2}$/.test(String(out.dob ?? '')) ? String(out.dob) : '',
      note: pick(out.note),
    },
  });
}
