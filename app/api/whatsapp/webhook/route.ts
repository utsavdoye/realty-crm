import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendText, whatsappReady } from '@/lib/whatsapp';

// WhatsApp Cloud API webhook (Meta → this link). Used for the website's "Verify on WhatsApp":
// a client sends "Verify TA4F2C9B", Meta tells us the sender's number, and that code is marked verified.
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const u = new URL(req.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN;
  if (token && u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === token) {
    return new Response(u.searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

type Msg = { from?: string; type?: string; text?: { body?: string }; button?: { text?: string } };

export async function POST(req: Request) {
  const raw = await req.text();
  // Only Meta can call this: every call is signed with the app secret.
  const secret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  if (!secret) return new Response('Not configured', { status: 503 });
  const sig = req.headers.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return new Response('Bad signature', { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return new Response('Not configured', { status: 503 });

  let body: { entry?: { changes?: { field?: string; value?: { messages?: Msg[] } }[] }[] } = {};
  try { body = JSON.parse(raw); } catch { return new Response('OK', { status: 200 }); }
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== 'messages') continue;
      for (const m of ch.value?.messages ?? []) {
        const text = m.text?.body ?? m.button?.text ?? '';
        if (!m.from || !text) continue;
        const { data, error } = await admin.rpc('verify_inbound', { p_from: m.from, p_body: text });
        if (error) { console.error('verify_inbound failed:', error.message); continue; }
        const r = data as { ok: boolean; reason?: string; again?: boolean; name?: string | null } | null;
        if (!r || r.reason === 'no_code' || !whatsappReady()) continue;
        // Free reply (the client just wrote to us).
        const first = (r.name ?? '').split(' ')[0];
        await sendText(m.from, r.ok
          ? `✅ Verified${first ? ', ' + first : ''}! Go back to the website, it opens there by itself.`
          : r.reason === 'expired' ? 'This code has expired. Please tap "Verify on WhatsApp" on the website again.'
          : 'We could not find this code. Please tap "Verify on WhatsApp" on the website again.');
      }
    }
  }
  return new Response('OK', { status: 200 });
}
