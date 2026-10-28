import { createAdminClient } from '@/lib/supabase/admin';
import { checkWaSignature } from '@/lib/whatsapp';
import { getChat } from '@/lib/waInbox';
import { ingest } from '@/lib/leadIntake';

// Meta sends every WhatsApp message and tick (sent / delivered / read) here.
// Meta app → WhatsApp → Configuration → Callback URL: https://YOUR-CRM/api/whatsapp/webhook  (field: messages)
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (q.get('hub.mode') === 'subscribe' && token && q.get('hub.verify_token') === token) return new Response(q.get('hub.challenge') ?? '', { status: 200 });
  return new Response('Forbidden', { status: 403 });
}

type Msg = {
  from: string; id: string; timestamp?: string; type: string;
  text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { id: string; mime_type?: string; caption?: string }; video?: { id: string; mime_type?: string; caption?: string };
  audio?: { id: string; mime_type?: string }; sticker?: { id: string; mime_type?: string };
  document?: { id: string; mime_type?: string; filename?: string; caption?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
};
type Value = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: Msg[];
  statuses?: { id: string; status: string; errors?: { title?: string; message?: string; error_data?: { details?: string } }[] }[];
};

function read(m: Msg): { kind: string; body: string; media?: { id: string; mime?: string; name?: string } } {
  switch (m.type) {
    case 'text': return { kind: 'text', body: m.text?.body ?? '' };
    case 'button': return { kind: 'text', body: m.button?.text ?? '' };
    case 'interactive': return { kind: 'text', body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '' };
    case 'image': return { kind: 'image', body: m.image?.caption ?? '', media: m.image && { id: m.image.id, mime: m.image.mime_type } };
    case 'video': return { kind: 'video', body: m.video?.caption ?? '', media: m.video && { id: m.video.id, mime: m.video.mime_type } };
    case 'audio': return { kind: 'audio', body: 'Voice note', media: m.audio && { id: m.audio.id, mime: m.audio.mime_type } };
    case 'sticker': return { kind: 'image', body: 'Sticker', media: m.sticker && { id: m.sticker.id, mime: m.sticker.mime_type } };
    case 'document': return { kind: 'document', body: m.document?.caption ?? '', media: m.document && { id: m.document.id, mime: m.document.mime_type, name: m.document.filename } };
    case 'location': {
      const l = m.location ?? {};
      return { kind: 'location', body: [l.name, l.address, l.latitude != null ? `https://maps.google.com/?q=${l.latitude},${l.longitude}` : ''].filter(Boolean).join(' · ') };
    }
    default: return { kind: 'other', body: `(${m.type} message: open WhatsApp on the phone to see it)` };
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await checkWaSignature(raw, req.headers.get('x-hub-signature-256')))) return new Response('Bad signature', { status: 401 });
  let body: { entry?: { changes?: { field?: string; value?: Value }[] }[] } = {};
  try { body = JSON.parse(raw); } catch { return new Response('ok'); }
  const admin = createAdminClient();
  if (!admin) return new Response('ok');

  for (const e of body.entry ?? []) {
    for (const c of e.changes ?? []) {
      const v = c.value;
      if (c.field !== 'messages' || !v?.metadata?.phone_number_id) continue;
      const { data: org } = await admin.from('organizations').select('id, wa_lead_source').eq('wa_phone_id', v.metadata.phone_number_id).maybeSingle();
      if (!org) continue;

      // Ticks for messages we sent
      for (const s of v.statuses ?? []) {
        const err = s.errors?.[0];
        await admin.from('wa_messages').update({ status: s.status, ...(err ? { error: err.error_data?.details || err.message || err.title || 'Not delivered' } : {}) }).eq('wa_id', s.id).eq('org_id', org.id);
      }

      // Messages from clients
      for (const m of v.messages ?? []) {
        const name = v.contacts?.find((x) => x.wa_id === m.from)?.profile?.name ?? v.contacts?.[0]?.profile?.name ?? null;
        let chat = await getChat(admin, org.id, m.from, { name });
        const r = read(m);
        const { data: inserted } = await admin.from('wa_messages').upsert({
          org_id: org.id, chat_id: chat.id, dir: 'in', kind: r.kind, body: r.body, wa_id: m.id, status: 'received',
          media_id: r.media?.id ?? null, media_mime: r.media?.mime ?? null, file_name: r.media?.name ?? null,
          created_at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
        }, { onConflict: 'wa_id', ignoreDuplicates: true }).select('id');
        if (!inserted?.length) continue; // Meta sent the same message twice

        // Someone new messaged us first → make them a lead (the agent gets the usual alert).
        if (!chat.lead_id) {
          let key = (org.wa_lead_source as string | null) ?? '';
          if (!key) {
            const { data: src } = await admin.from('lead_sources').select('key, name').eq('org_id', org.id).eq('active', true).order('created_at');
            key = (src ?? []).find((s) => /whats/i.test(s.name))?.key ?? '';
          }
          if (key) {
            const res = await ingest(key, { name: name || 'WhatsApp client', phone: m.from.slice(-10), message: r.body || `Sent a ${r.kind} on WhatsApp` }, { source_detail: 'WhatsApp message' }, { skipWelcome: true });
            if (res.ok && res.lead_id) { chat = await getChat(admin, org.id, m.from, { leadId: res.lead_id }); }
          }
        }

        const { data: cur } = await admin.from('wa_chats').select('unread').eq('id', chat.id).maybeSingle();
        const when = new Date().toISOString();
        await admin.from('wa_chats').update({
          last_text: (r.body || r.kind).slice(0, 120), last_at: when, last_in_at: when, unread: ((cur?.unread as number) ?? 0) + 1,
        }).eq('id', chat.id);
      }
    }
  }
  return new Response('ok');
}

