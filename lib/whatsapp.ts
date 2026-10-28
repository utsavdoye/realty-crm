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


// ---------- Chat (inside the 24-hour window after the client last wrote) ----------

export function sendText(phone: string, text: string) {
  return send({ to: toWaNumber(phone), type: 'text', text: { body: text.slice(0, 4096), preview_url: true } });
}

/** A PDF / file by public link (brochure, floor plan). */
export function sendDocumentLink(phone: string, link: string, fileName: string, caption?: string) {
  return send({ to: toWaNumber(phone), type: 'document', document: { link, filename: fileName.slice(0, 120), ...(caption ? { caption: caption.slice(0, 1024) } : {}) } });
}

export function sendImageLink(phone: string, link: string, caption?: string) {
  return send({ to: toWaNumber(phone), type: 'image', image: { link, ...(caption ? { caption: caption.slice(0, 1024) } : {}) } });
}

/** Shows blue ticks to the client. */
export async function markRead(waMessageId: string) {
  if (!whatsappReady()) return;
  await fetch(`https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: waMessageId }),
  }).catch(() => null);
}

/** Downloads a photo / voice note / file a client sent. */
export async function downloadMedia(mediaId: string): Promise<{ body: ArrayBuffer; mime: string } | null> {
  if (!whatsappReady() || !/^\d+$/.test(mediaId)) return null;
  const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
  const meta = await fetch(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, { headers: auth, cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { url?: string; mime_type?: string } | null;
  if (!meta?.url) return null;
  const res = await fetch(meta.url, { headers: auth, cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  return { body: await res.arrayBuffer(), mime: meta.mime_type || res.headers.get('content-type') || 'application/octet-stream' };
}

/** Checks that a webhook call really came from Meta. */
export async function checkWaSignature(raw: string, header: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith('sha256=')) return false;
  const { createHmac, timingSafeEqual } = await import('crypto');
  const want = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}
