import { createAdminClient } from '@/lib/supabase/admin';
import { verifyFirebaseToken } from '@/lib/firebaseToken';
import { ingest, KEY_RE } from '@/lib/leadIntake';
import { normPhone } from '@/lib/roles';

// Shortlist links that open on the client website (e.g. Surestone): /shortlist.html?t=<token>
// The visitor must be signed in on the website. The CRM checks WHO is signed in:
//   * the client the homes were picked for  → their own page (name, note, reactions, "opened" alert to the advisor)
//   * anyone else (the link was forwarded)   → the same homes as a normal visitor, under their own name;
//                                              their likes / visit requests go on THEIR OWN lead, never on the first client's.
// POST { t, idToken, key?, action: 'load' | 'seen' | 'react', project?, reaction?, when? }
export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const TOKEN = /^[a-f0-9]{24,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export function GET() {
  return json({ ok: false, needLogin: true, error: 'Please sign in to see these homes.' }, 401);
}

type Lead = { id: string; name: string; phone: string | null; email: string | null; other_phones: string[] | null };
type Client = { id: string; name: string | null; email: string | null; phone: string | null; contact_phone: string | null; lead_id: string | null };

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch { /* empty */ }
  const t = String(b.t ?? '');
  if (!TOKEN.test(t)) return json({ ok: false, error: 'This link is not complete. Please ask your property advisor for it again.' }, 400);

  // Who is looking: a signed-in website account (checked token), or the name + mobile they typed on the website.
  const token = typeof b.idToken === 'string' && b.idToken ? await verifyFirebaseToken(b.idToken) : null;
  const typedPhone = normPhone(String(b.phone ?? '').slice(0, 20));
  const typedName = String(b.name ?? '').trim().slice(0, 120);
  if (!token && !typedPhone) return json({ ok: false, needLogin: true, error: 'Please tell us your name and mobile number to see these homes.' }, 401);
  const who = token ?? { uid: '', name: typedName, email: null as string | null, email_verified: false, phone_number: null as string | null };
  const admin = createAdminClient();
  if (!admin) return json({ ok: false, error: 'This link is not available right now. Please call us.' }, 503);

  const { data: sl } = await admin.from('shortlists').select('org_id, lead_id').eq('token', t).maybeSingle();
  if (!sl) return json({ ok: false, error: 'This link is not active any more. Please ask your property advisor for a new one.' }, 404);
  const s = sl as { org_id: string; lead_id: string };
  const [{ data: leadRow }, { data: clientRow }, { data: orgRow }] = await Promise.all([
    admin.from('leads').select('id, name, phone, email, other_phones').eq('id', s.lead_id).maybeSingle(),
    who.uid ? admin.from('website_clients').select('id, name, email, phone, contact_phone, lead_id').eq('org_id', s.org_id).eq('uid', who.uid).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('organizations').select('verify_phone').eq('id', s.org_id).maybeSingle(),
  ]);
  // With "Verify clients' mobile" on, only an SMS-checked number counts; otherwise the typed number does.
  const strict = (orgRow as { verify_phone?: boolean } | null)?.verify_phone === true;
  const lead = leadRow as Lead | null, client = clientRow as Client | null;

  // Is the signed-in person the client these homes were picked for?
  const phones = [who.phone_number, client?.phone, strict ? null : client?.contact_phone, strict ? null : typedPhone].map((p) => normPhone(p ?? '')).filter(Boolean);
  const leadPhones = [lead?.phone, ...(lead?.other_phones ?? [])].map((p) => normPhone(p ?? '')).filter(Boolean);
  const emailOk = !!who.email && who.email_verified && !!lead?.email && who.email.toLowerCase() === lead.email.toLowerCase();
  const owner = !!lead && ((client?.lead_id === lead.id) || phones.some((p) => leadPhones.includes(p)) || emailOk);
  if (owner && client && !client.lead_id) await admin.from('website_clients').update({ lead_id: lead!.id }).eq('id', client.id);
  const myPhone = phones[0] ?? typedPhone ?? '';
  const myName = (client?.name || who.name || '').trim();

  if (b.action === 'load' || !b.action) {
    const { data, error } = await admin.rpc('site_shortlist', { p_token: t });
    if (error) { console.error('site_shortlist failed:', error.message); return json({ ok: false, error: 'Could not load the homes. Please try again.' }, 500); }
    if (!data) return json({ ok: false, error: 'This link is not active any more. Please ask your property advisor for a new one.' }, 404);
    const d = data as Record<string, unknown>;
    if (owner) return json({ ok: true, owner: true, ...d });
    return json({ ok: true, owner: false, ...d, client: myName.split(' ')[0] || null, note: null, reactions: {}, needPhone: !myPhone });
  }

  if (b.action === 'seen') {
    if (owner) await admin.rpc('shortlist_seen', { p_token: t });
    return json({ ok: true });
  }

  if (b.action === 'react') {
    const project = String(b.project ?? ''), reaction = String(b.reaction ?? '');
    if (!UUID.test(project) || !['like', 'no', 'visit'].includes(reaction)) return json({ ok: false }, 400);
    const when = typeof b.when === 'string' && !Number.isNaN(Date.parse(b.when)) ? new Date(b.when).toISOString() : null;
    if (owner) {
      const { data } = await admin.rpc('shortlist_react', { p_token: t, p_project: project, p_reaction: reaction, p_when: reaction === 'visit' ? when : null });
      return json({ ok: !!data });
    }
    // Someone the link was forwarded to: this goes on their own lead.
    if (reaction === 'no') return json({ ok: true });
    if (!myPhone) return json({ ok: false, needPhone: true, error: 'Please add your mobile number first.' }, 422);
    const key = String(b.key ?? '');
    if (!KEY_RE.test(key)) return json({ ok: false }, 400);
    const { data: p } = await admin.from('projects').select('name').eq('id', project).eq('org_id', s.org_id).maybeSingle();
    const pname = (p as { name?: string } | null)?.name ?? '';
    const whenText = when ? new Date(when).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '';
    const r = await ingest(key, {
      name: myName || undefined, phone: myPhone, email: who.email ?? undefined, project: pname || undefined,
      message: reaction === 'visit' ? `Wants a site visit at ${pname}${whenText ? ' on ' + whenText : ''} (from a homes link another client shared).` : `Liked ${pname} (from a homes link another client shared).`,
    }, { from: 'website shortlist (forwarded)', reaction, project });
    return json({ ok: r.ok });
  }
  return json({ ok: false }, 400);
}
