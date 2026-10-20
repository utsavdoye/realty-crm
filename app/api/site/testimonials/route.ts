import { createAnonClient } from '@/lib/supabase/admin';

// Testimonials on the client website.
// GET ?org=<id>  → approved testimonials (shown on the website)
// GET ?r=<token> → one request link (first name + project), for the "write a testimonial" form
// POST { r, name, place, rating, text } → the client's testimonial; it waits for an admin to approve it
export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOK = /^[a-f0-9]{32}$/;
const json = (body: unknown, status = 200, cache = 'no-store') => Response.json(body, { status, headers: { ...CORS, 'Cache-Control': cache } });

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const db = createAnonClient();
  const r = q.get('r') ?? '';
  if (TOK.test(r)) {
    const { data } = await db.rpc('site_testimonial_get', { p_token: r });
    return data ? json({ ok: true, ...(data as object) }) : json({ ok: false, error: 'This link is not active.' }, 404);
  }
  const org = q.get('org') ?? '';
  if (!UUID.test(org)) return json({ ok: false }, 400);
  const { data } = await db.rpc('site_testimonials', { p_org: org.toLowerCase() });
  return json({ ok: true, testimonials: data ?? [] }, 200, 'public, s-maxage=30, stale-while-revalidate=120');
}

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch { /* empty */ }
  const r = String(b.r ?? ''), rating = Math.round(Number(b.rating)), text = String(b.text ?? '').trim();
  // "Share your experience" on the website (no request link): needs the website key, a name and a few words.
  if (!r && typeof b.key === 'string') {
    if (!/^[a-f0-9]{32,64}$/.test(b.key)) return json({ ok: false }, 400);
    if (!(rating >= 1 && rating <= 5)) return json({ ok: false, error: 'Please pick a rating.' }, 422);
    if (String(b.name ?? '').trim().length < 2) return json({ ok: false, error: 'Please enter your name.' }, 422);
    if (text.length < 10) return json({ ok: false, error: 'Please write a few words (at least 10 letters).' }, 422);
    const { data } = await createAnonClient().rpc('site_testimonial_open', { p_key: b.key, p_name: String(b.name).slice(0, 80), p_phone: String(b.phone ?? '').slice(0, 20) || null, p_place: String(b.place ?? '').slice(0, 80), p_rating: rating, p_body: text.slice(0, 1200) });
    return data ? json({ ok: true }) : json({ ok: false, error: 'Could not send right now. Please try again later.' }, 429);
  }
  if (!TOK.test(r)) return json({ ok: false, error: 'This link is not complete.' }, 400);
  if (!(rating >= 1 && rating <= 5)) return json({ ok: false, error: 'Please pick a rating.' }, 422);
  if (text.length < 10) return json({ ok: false, error: 'Please write a few words (at least 10 letters).' }, 422);
  const { data } = await createAnonClient().rpc('site_testimonial_submit', { p_token: r, p_name: String(b.name ?? '').slice(0, 80), p_place: String(b.place ?? '').slice(0, 80), p_rating: rating, p_body: text.slice(0, 1200) });
  return data ? json({ ok: true }) : json({ ok: false, error: 'This link was already used or is not active.' }, 409);
}
