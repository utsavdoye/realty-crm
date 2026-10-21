import { createAnonClient } from '@/lib/supabase/admin';
import { normPhone, validPhone } from '@/lib/roles';

// The client requirement form, shown on the company's own website (find-home.html?f=<form token>&by=<advisor>).
// GET ?f=&by=  → company, advisor name and areas for the form
// POST { f, by, name, phone, bhk, ptype, bmin, bmax, location, purpose, timeline, loan, slot, note } → a lead in the CRM
export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const TOKEN = /^[a-f0-9]{24,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200, cache = 'no-store') => Response.json(body, { status, headers: { ...CORS, 'Cache-Control': cache } });

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const f = q.get('f') ?? '', by = q.get('by') ?? '';
  if (!TOKEN.test(f)) return json({ ok: false, error: 'This link is not complete.' }, 400);
  const { data } = await createAnonClient().rpc('get_requirement_form', { p_form: f, p_by: UUID.test(by) ? by.toLowerCase() : null });
  if (!data) return json({ ok: false, error: 'This link is not active.' }, 404);
  return json({ ok: true, ...(data as object) }, 200, 'public, s-maxage=60, stale-while-revalidate=300');
}

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch { /* empty */ }
  const s = (k: string, max = 120) => String(b[k] ?? '').trim().slice(0, max);
  const n = (k: string) => { const v = s(k, 12); return /^\d{1,6}$/.test(v) ? Number(v) : null; };
  const f = s('f', 64), by = s('by', 36), name = s('name'), phone = normPhone(s('phone', 30));
  if (!TOKEN.test(f)) return json({ ok: false, error: 'This link is not valid.' }, 400);
  if (name.length < 2) return json({ ok: false, error: 'Please enter your name.' }, 422);
  if (!validPhone(phone)) return json({ ok: false, error: 'Please enter a valid 10-digit mobile number.' }, 422);
  const { data, error } = await createAnonClient().rpc('submit_requirement', {
    p_form: f, p_by: UUID.test(by) ? by.toLowerCase() : null, p_name: name, p_phone: phone,
    p_bhk: s('bhk', 40), p_ptype: s('ptype', 40), p_bmin: n('bmin'), p_bmax: n('bmax'),
    p_location: s('location', 200), p_purpose: s('purpose', 40), p_timeline: s('timeline', 40),
    p_loan: s('loan', 20), p_slot: s('slot', 20), p_note: s('note', 500),
  });
  const r = data as { ok: boolean; fits?: number; advisor?: string | null; busy?: boolean } | null;
  if (r?.busy) return json({ ok: false, error: 'Too many forms right now. Please try again in a few minutes, or call us.' }, 429);
  if (error || !r?.ok) return json({ ok: false, error: 'Could not send. Please check your number and try again.' }, 500);
  return json({ ok: true, fits: r.fits ?? 0, advisor: r.advisor ?? null, name: name.split(' ')[0] });
}
