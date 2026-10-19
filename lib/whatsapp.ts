import 'server-only';

// Sends WhatsApp messages through Meta's WhatsApp Cloud API.
// Needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID (server-only, never NEXT_PUBLIC).

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

export function whatsappReady() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Turns 9876543210 / +91 98765 43210 into 919876543210 */
export function toWaNumber(phone: string) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return '91' + d;
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1);
  return d;
}

type Result = { ok: true; id?: string } | { ok: false; error: string; status: number };

async function send(body: Record<string, unknown>): Promise<Result> {
  if (!whatsappReady()) return { ok: false, error: 'WhatsApp is not connected yet', status: 503 };
  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) return { ok: false, error: json.error?.message || `WhatsApp error ${res.status}`, status: res.status };
    return { ok: true, id: json.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Could not reach WhatsApp', status: 502 };
  }
}

/** Login code. Uses an Authentication template with a "Copy code" button. */
export function sendLoginCode(phone: string, code: string) {
  return send({
    to: toWaNumber(phone),
    type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE_LOGIN || 'login_code',
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  });
}

/** Any approved Utility template with plain text variables {{1}}, {{2}}, ... */
export function sendTemplate(phone: string, name: string, params: string[]) {
  return send({
    to: toWaNumber(phone),
    type: 'template',
    template: {
      name,
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
      components: params.length
        ? [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: (t || '-').replace(/\s*\n\s*/g, ' ').slice(0, 200) })) }]
        : [],
    },
  });
}

/** Tells an agent a lead was assigned to them. Never throws. */
export async function notifyLeadAssigned(args: { agentPhone: string | null | undefined; agentName: string; leadName: string; leadPhone: string; source?: string | null }) {
  if (!args.agentPhone || !whatsappReady()) return;
  const r = await sendTemplate(args.agentPhone, process.env.WHATSAPP_TEMPLATE_LEAD_ASSIGNED || 'lead_assigned', [
    args.agentName.split(' ')[0] || 'there',
    args.leadName,
    args.leadPhone,
    args.source || 'Not given',
  ]);
  if (!r.ok) console.error('WhatsApp lead alert failed:', r.error);
}

/** A plain text reply. Free while the customer's 24-hour window is open (they just messaged us). */
export function sendText(phone: string, text: string) {
  return send({ to: toWaNumber(phone), type: 'text', text: { body: text.slice(0, 1000) } });
}

/** The company WhatsApp number clients message to verify (digits with country code), or null. */
export function verifyNumber() {
  const d = String(process.env.WHATSAPP_VERIFY_NUMBER || '').replace(/\D/g, '');
  return d.length >= 10 ? (d.length === 10 ? '91' + d : d) : null;
}
