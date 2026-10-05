import { Webhook } from 'standardwebhooks';
import { sendLoginCode } from '@/lib/whatsapp';

// Supabase calls this when someone asks for a login code by mobile number.
// We deliver the code on WhatsApp instead of SMS.
export const dynamic = 'force-dynamic';

function fail(message: string, code = 500) {
  return Response.json({ error: { http_code: code, message } }, { status: code });
}

export async function POST(req: Request) {
  const secret = process.env.SEND_SMS_HOOK_SECRET;
  if (!secret) return fail('Login hook secret is not set on the server');

  const payload = await req.text();
  let data: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    const wh = new Webhook(secret.replace('v1,whsec_', ''));
    data = wh.verify(payload, Object.fromEntries(req.headers)) as typeof data;
  } catch {
    return fail('Invalid signature', 401);
  }

  const phone = data.user?.phone;
  const otp = data.sms?.otp;
  if (!phone || !otp) return fail('Missing phone or code', 400);

  const r = await sendLoginCode(phone, otp);
  if (!r.ok) {
    console.error('WhatsApp login code failed:', r.error);
    return fail('Could not send the code on WhatsApp. Try email login.', 502);
  }
  return Response.json({});
}
