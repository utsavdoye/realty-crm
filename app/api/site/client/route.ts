import { createAdminClient, createAnonClient } from '@/lib/supabase/admin';
import { KEY_RE } from '@/lib/leadIntake';
import { verifyFirebaseToken } from '@/lib/firebaseToken';

// Website accounts and saved homes (patch-027).
// POST { action: 'register', key, idToken, name? }      → { ok, saves: [project ids] } or { conflict: 'email'|'phone' } or { needEmailVerify }
// POST { action: 'save', key, idToken, project, on }    → signed-in client saves / un-saves a home
// POST { action: 'save_anon', org, voter, project, on } → visitor not signed in (counted, no name)
export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch { /* empty */ }

  if (b.action === 'save_anon') {
    const org = String(b.org ?? ''), project = String(b.project ?? ''), voter = String(b.voter ?? '');
    if (!UUID.test(org) || !UUID.test(project) || !/^[a-f0-9]{32,64}$/.test(voter)) return json({ ok: false }, 400);
    const { data } = await createAnonClient().rpc('site_save_anon', { p_org: org.toLowerCase(), p_project: project.toLowerCase(), p_voter: voter, p_on: b.on !== false });
    return json({ ok: data === true });
  }

  const key = String(b.key ?? '');
  if (!KEY_RE.test(key) || typeof b.idToken !== 'string') return json({ ok: false }, 400);
  const who = await verifyFirebaseToken(b.idToken);
  if (!who) return json({ ok: false, error: 'Please sign in again.' }, 401);
  const admin = createAdminClient();
  if (!admin) return json({ ok: false, error: 'not_configured' }, 503);

  if (b.action === 'register') {
    // Only a checked email (link clicked) or a checked mobile (SMS) can register.
    const email = who.email && who.email_verified ? who.email : null;
    const phone = who.phone_number ?? null;
    if (!email && !phone) return json({ ok: false, needEmailVerify: !!who.email });
    const name = String(b.name ?? '').trim().slice(0, 120) || who.name || '';
    const { data, error } = await admin.rpc('site_client_upsert', { p_key: key, p_uid: who.uid, p_name: name, p_email: email, p_phone: phone });
    if (error) { console.error('site_client_upsert failed:', error.message); return json({ ok: false }, 500); }
    return json(data ?? { ok: false });
  }

  if (b.action === 'save') {
    const project = String(b.project ?? '');
    if (!UUID.test(project)) return json({ ok: false }, 400);
    const { data, error } = await admin.rpc('site_client_save', { p_key: key, p_uid: who.uid, p_project: project.toLowerCase(), p_on: b.on !== false });
    if (error) { console.error('site_client_save failed:', error.message); return json({ ok: false }, 500); }
    return json(data ?? { ok: false });
  }
  return json({ ok: false }, 400);
}
