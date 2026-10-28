import { createAdminClient } from '@/lib/supabase/admin';
import { checkMetaSignature, readMetaLead } from '@/lib/social';
import { ingest, mapPayload } from '@/lib/leadIntake';

// Facebook / Instagram lead ads → a lead in the CRM within seconds (and the agent is alerted).
// Set this URL in your Meta app → Webhooks → Page → field "leadgen": https://YOUR-CRM/api/social/meta/webhook
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get('hub.mode') === 'subscribe' && process.env.META_WEBHOOK_VERIFY_TOKEN && q.get('hub.verify_token') === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(q.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!checkMetaSignature(raw, req.headers.get('x-hub-signature-256'))) return new Response('Bad signature', { status: 401 });
  let body: { entry?: { id?: string; changes?: { field?: string; value?: { leadgen_id?: string; page_id?: string; form_id?: string; ad_id?: string } }[] }[] } = {};
  try { body = JSON.parse(raw); } catch { return new Response('ok'); }
  const admin = createAdminClient();
  if (!admin) return new Response('ok');
  for (const e of body.entry ?? []) {
    for (const c of e.changes ?? []) {
      if (c.field !== 'leadgen' || !c.value?.leadgen_id) continue;
      const pageId = c.value.page_id || e.id || '';
      const got = await readMetaLead(pageId, c.value.leadgen_id).catch(() => null);
      if (!got) continue;
      const { data: org } = await admin.from('organizations').select('meta_lead_source').eq('id', got.orgId).maybeSingle();
      let key = (org as { meta_lead_source?: string | null } | null)?.meta_lead_source ?? '';
      if (!key) {
        const { data: src } = await admin.from('lead_sources').select('key, name').eq('org_id', got.orgId).eq('active', true).order('created_at');
        key = (src ?? []).find((s) => /facebook|meta|instagram/i.test(s.name))?.key ?? src?.[0]?.key ?? '';
      }
      if (!key) continue;
      const fields: Record<string, string> = {};
      for (const f of got.lead.field_data ?? []) fields[f.name] = (f.values ?? []).join(', ');
      const where = got.lead.platform === 'ig' ? 'Instagram' : 'Facebook';
      const extra = Object.entries(fields).filter(([k]) => !/name|phone|email/i.test(k)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n');
      const payload = { ...fields, message: `${where} lead form${got.lead.ad_name ? ` · ad: ${got.lead.ad_name}` : ''}${got.lead.campaign_name ? ` · campaign: ${got.lead.campaign_name}` : ''}${extra ? '\n' + extra : ''}` };
      await ingest(key, mapPayload(payload), { ...payload, meta_lead_id: c.value.leadgen_id, form_id: c.value.form_id, ad_id: c.value.ad_id, source_detail: `${where} lead ad` });
    }
  }
  return new Response('ok');
}
