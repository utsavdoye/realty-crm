import { createAdminClient, createAnonClient } from '@/lib/supabase/admin';
import { ingest, KEY_RE } from '@/lib/leadIntake';
import { siteUrl } from '@/lib/roles';

// Client website: brochure / floor plans open only after the visitor leaves name + mobile.
// POST { key, project, name, phone, what: 'brochure' | 'plans', t? } → saves the lead, then returns the files.
// With t (a shortlist link sent by the team), the project may be any project in that shortlist.
export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERR: Record<string, [number, string]> = {
  unknown_key: [404, 'This website is not connected to the CRM right now.'],
  plan_ended: [402, 'This website is not connected to the CRM right now.'],
  bad_phone: [422, 'Please enter a valid mobile number (India: 10 digits).'],
  too_many: [429, 'Too many requests right now. Please try again in a while.'],
  server_error: [500, 'Could not save your details. Please try again.'],
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch { /* empty */ }
  const key = String(b.key ?? ''), project = String(b.project ?? ''), name = String(b.name ?? '').trim().slice(0, 120), phone = String(b.phone ?? '').trim().slice(0, 30);
  const what = b.what === 'plans' ? 'floor plans' : 'brochure';
  const t = typeof b.t === 'string' && /^[a-f0-9]{24,64}$/.test(b.t) ? b.t : '';
  if (!KEY_RE.test(key) || !UUID.test(project)) return json({ ok: false, error: 'Something is wrong with this page. Please refresh and try again.' }, 400);
  if (name.length < 2) return json({ ok: false, error: 'Please enter your name.' }, 422);
  if (typeof b.website === 'string' && b.website.trim()) return json({ ok: false, error: 'Please try again.' }, 400); // spam bots

  const db = createAdminClient() ?? createAnonClient();
  const r = await ingest(key, { name, phone, project: String(b.projectName ?? '').slice(0, 200) || undefined, message: `Asked for the ${what} on the website${t ? ' (from the homes link the team sent)' : ''}.` }, { name, phone, what, project, from: t ? 'website shortlist' : 'website' });
  if (!r.ok) { const [s, m] = ERR[r.error ?? 'server_error'] ?? ERR.server_error; return json({ ok: false, error: m }, s); }

  // The advisor who sent the link also gets the usual "opened prices" alert on that client.
  if (t) await createAnonClient().rpc('shortlist_react', { p_token: t, p_project: project, p_reaction: 'details', p_when: null });
  const { data, error } = t
    ? await db.rpc('site_shortlist_files', { p_token: t, p_project: project, p_phone: phone })
    : await db.rpc('site_project_files', { p_key: key, p_project: project, p_phone: phone });
  if (error) { console.error('site_project_files failed:', error.message); return json({ ok: false, error: ERR.server_error[1] }, 500); }
  if (!data) return json({ ok: false, error: 'This project is not available any more.' }, 404);
  const d = data as { name: string; link: string | null; floor_plans: { url: string; label?: string }[] };
  const safe = (u: unknown) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : typeof u === 'string' && /^\/[^/]/.test(u) ? siteUrl() + u : typeof u === 'string' && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u) ? 'https://' + u : null);
  return json({
    ok: true,
    name: d.name,
    brochure: safe(d.link),
    plans: (d.floor_plans ?? []).map((p) => ({ url: safe(p?.url), label: String(p?.label ?? '').slice(0, 80) })).filter((p) => p.url),
  });
}
