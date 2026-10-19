import { createAnonClient } from '@/lib/supabase/admin';

// Shortlist links that open on the client website (e.g. Surestone): /shortlist.html?t=<token>
// GET ?t=…  → the homes picked for the client (no brochure / floor plan links; those need name + mobile)
// POST { t, action: 'seen' }                                → tells the advisor the client opened it
// POST { t, action: 'react', project, reaction, when? }     → like / not for me / book a site visit
export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const TOKEN = /^[a-f0-9]{24,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get('t') ?? '';
  if (!TOKEN.test(t)) return json({ ok: false, error: 'This link is not valid.' }, 400);
  const { data, error } = await createAnonClient().rpc('site_shortlist', { p_token: t });
  if (error) { console.error('site_shortlist failed:', error.message); return json({ ok: false, error: 'Could not load the homes. Please try again.' }, 500); }
  if (!data) return json({ ok: false, error: 'This link is not active any more. Please ask your property advisor for a new one.' }, 404);
  return json({ ok: true, ...(data as object) });
}

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch { /* empty */ }
  const t = String(b.t ?? '');
  if (!TOKEN.test(t)) return json({ ok: false }, 400);
  const db = createAnonClient();
  if (b.action === 'seen') { await db.rpc('shortlist_seen', { p_token: t }); return json({ ok: true }); }
  if (b.action === 'react') {
    const project = String(b.project ?? ''), reaction = String(b.reaction ?? '');
    if (!UUID.test(project) || !['like', 'no', 'visit'].includes(reaction)) return json({ ok: false }, 400);
    const when = typeof b.when === 'string' && !Number.isNaN(Date.parse(b.when)) ? new Date(b.when).toISOString() : null;
    const { data } = await db.rpc('shortlist_react', { p_token: t, p_project: project, p_reaction: reaction, p_when: reaction === 'visit' ? when : null });
    return json({ ok: !!data });
  }
  return json({ ok: false }, 400);
}
