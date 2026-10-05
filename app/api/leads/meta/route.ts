import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { ingest, mapPayload } from '@/lib/leadIntake';

// Facebook & Instagram lead ads. One link for all companies; each company's
// Facebook page is matched to its "Meta" lead source by page ID.
export const dynamic = 'force-dynamic';
const API_VERSION = process.env.META_API_VERSION || 'v21.0';

// Meta checks the link once when you subscribe.
export function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === process.env.META_VERIFY_TOKEN) {
    return new Response(u.searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

type Change = { field?: string; value?: { leadgen_id?: string; page_id?: string; form_id?: string } };

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.META_APP_SECRET;
  const sig = req.headers.get('x-hub-signature-256') || '';
  if (!secret) return new Response('Not configured', { status: 503 });
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return new Response('Bad signature', { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return new Response('Not configured', { status: 503 });

  const body = JSON.parse(raw) as { entry?: { changes?: Change[] }[] };
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== 'leadgen' || !ch.value?.leadgen_id || !ch.value.page_id) continue;
      const { data: src } = await admin.from('lead_sources').select('id, key').eq('kind', 'meta').eq('external_id', ch.value.page_id).eq('active', true).maybeSingle();
      if (!src) { console.error('No Meta lead source for page', ch.value.page_id); continue; }
      const { data: sec } = await admin.from('lead_source_secrets').select('page_token').eq('source_id', src.id).maybeSingle();
      if (!sec) { console.error('No page token for source', src.id); continue; }
      const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${ch.value.leadgen_id}?fields=field_data,created_time,form_id,ad_name,campaign_name&access_token=${encodeURIComponent(sec.page_token)}`, { cache: 'no-store' });
      if (!res.ok) { console.error('Meta lead fetch failed', res.status, await res.text().catch(() => '')); continue; }
      const lead = (await res.json()) as { field_data?: { name: string; values?: string[] }[]; campaign_name?: string; ad_name?: string };
      const flat: Record<string, string> = {};
      for (const f of lead.field_data ?? []) if (f.values?.[0]) flat[f.name] = f.values[0];
      const mapped = mapPayload(flat);
      if (!mapped.message) {
        const extra = Object.entries(flat).filter(([k]) => !/name|phone|email|city/i.test(k)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`);
        if (lead.campaign_name) extra.unshift(`Campaign: ${lead.campaign_name}`);
        mapped.message = extra.join('\n') || undefined;
      }
      await ingest(src.key, mapped, flat);
    }
  }
  return new Response('OK', { status: 200 });
}
