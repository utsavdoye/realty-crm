import { createAnonClient } from '@/lib/supabase/admin';
import { KEY_RE } from '@/lib/leadIntake';
import { verifyNumber } from '@/lib/whatsapp';

// Mobile check on the client website through WhatsApp (free, cannot be faked).
// POST { action: 'start', key, name }   → { ok, token, code, wa }   (wa = number to send the code to)
// POST { action: 'status', key, token } → { ok, verified, phone? }  (phone shown masked)
export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });
const mask = (p: string) => (p.length >= 10 ? `${p.slice(0, -10) ? '+' + p.slice(0, -10) + ' ' : ''}${p.slice(-10, -8)}xxx xx${p.slice(-3)}` : 'your number');

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch { /* empty */ }
  const key = String(b.key ?? '');
  if (!KEY_RE.test(key)) return json({ ok: false, error: 'This website is not connected to the CRM right now.' }, 400);
  const db = createAnonClient();

  if (b.action === 'start') {
    const wa = verifyNumber();
    if (!wa) return json({ ok: false, error: 'WhatsApp check is not set up yet. Please call us.' }, 503);
    const { data, error } = await db.rpc('site_verify_start', { p_key: key, p_name: String(b.name ?? '').trim().slice(0, 120) });
    const d = data as { token?: string; code?: string; error?: string } | null;
    if (error || !d?.token) return json({ ok: false, error: d?.error === 'too_many' ? 'Too many requests right now. Please try again later.' : 'Could not start the check. Please try again.' }, d?.error === 'too_many' ? 429 : 500);
    return json({ ok: true, token: d.token, code: d.code, wa });
  }

  if (b.action === 'status') {
    const token = String(b.token ?? '');
    if (!/^[a-f0-9]{64}$/.test(token)) return json({ ok: false }, 400);
    const { data } = await db.rpc('site_verify_status', { p_token: token, p_key: key });
    const d = data as { verified: boolean; expired?: boolean; phone?: string } | null;
    if (!d) return json({ ok: false, verified: false, expired: true });
    return json({ ok: true, verified: d.verified, expired: !!d.expired, phone: d.phone ? mask(d.phone) : undefined });
  }
  return json({ ok: false }, 400);
}
