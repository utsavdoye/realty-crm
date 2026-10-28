import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendTemplate, toWaNumber, whatsappReady } from '@/lib/whatsapp';

// The CRM's WhatsApp inbox: saving chats/messages, the welcome + brochure for new leads, visit reminders.

export const TPL_WELCOME = () => process.env.WHATSAPP_TEMPLATE_WELCOME || 'welcome_brochure';
export const TPL_REMINDER = () => process.env.WHATSAPP_TEMPLATE_VISIT_REMINDER || 'visit_reminder';

export const welcomeText = (p: string[]) => `Hi ${p[0]}, thank you for your interest in ${p[1]}. I am ${p[2]} from ${p[3]}. Here are the details and brochure: ${p[4]}. Reply here any time for prices, floor plans or a site visit.`;
export const reminderText = (p: string[]) => `Hi ${p[0]}, a reminder of your site visit to ${p[1]} on ${p[2]}. ${p[3]} (${p[4]}) will meet you there. Reply here if you need to change the time.`;

const last10 = (p: string) => String(p || '').replace(/\D/g, '').slice(-10);
const istTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const firstName = (n: string | null | undefined) => (n || '').trim().split(/\s+/)[0] || 'there';

export async function findLead(admin: SupabaseClient, orgId: string, phone: string) {
  const d = last10(phone);
  if (d.length < 10) return null;
  const { data } = await admin.from('leads').select('id, name').eq('org_id', orgId).ilike('phone', `%${d}`).limit(1).maybeSingle();
  return data as { id: string; name: string } | null;
}

export async function getChat(admin: SupabaseClient, orgId: string, phone: string, extra: { name?: string | null; leadId?: string | null } = {}) {
  const wa = toWaNumber(phone);
  const { data: found } = await admin.from('wa_chats').select('id, lead_id, name').eq('org_id', orgId).eq('phone', wa).maybeSingle();
  if (found) {
    const patch: Record<string, unknown> = {};
    if (!found.lead_id && extra.leadId) patch.lead_id = extra.leadId;
    if (!found.name && extra.name) patch.name = extra.name;
    if (Object.keys(patch).length) await admin.from('wa_chats').update(patch).eq('id', found.id);
    return { id: found.id as string, lead_id: (found.lead_id ?? extra.leadId ?? null) as string | null };
  }
  const lead = extra.leadId ? { id: extra.leadId } : await findLead(admin, orgId, wa);
  const { data, error } = await admin.from('wa_chats').upsert({ org_id: orgId, phone: wa, name: extra.name ?? null, lead_id: lead?.id ?? null }, { onConflict: 'org_id,phone' }).select('id, lead_id').single();
  if (error || !data) throw new Error(error?.message || 'Could not open the chat');
  return data as { id: string; lead_id: string | null };
}

/** Saves a message we sent and moves the chat to the top. */
export async function logOut(admin: SupabaseClient, orgId: string, chatId: string, m: { kind: string; body: string; waId?: string; error?: string; by?: string | null; fileName?: string }) {
  await admin.from('wa_messages').insert({
    org_id: orgId, chat_id: chatId, dir: 'out', kind: m.kind, body: m.body, wa_id: m.waId ?? null,
    status: m.error ? 'failed' : 'sent', error: m.error ?? null, sent_by: m.by ?? null, file_name: m.fileName ?? null,
  });
  await admin.from('wa_chats').update({ last_text: (m.error ? '⚠ ' : 'You: ') + m.body.slice(0, 120), last_at: new Date().toISOString() }).eq('id', chatId);
}

/** New lead → welcome message with the project and brochure link (only if turned on). Never throws. */
export async function welcomeNewLead(leadId: string) {
  try {
    const admin = createAdminClient();
    if (!admin || !whatsappReady()) return;
    const { data: lead } = await admin.from('leads').select('id, org_id, name, phone, project_id, assigned_to').eq('id', leadId).maybeSingle();
    if (!lead) return;
    const { data: org } = await admin.from('organizations').select('name, website_url, wa_auto_welcome, wa_phone_id').eq('id', lead.org_id).maybeSingle();
    if (!org?.wa_auto_welcome || org.wa_phone_id !== process.env.WHATSAPP_PHONE_NUMBER_ID) return;
    const [{ data: project }, { data: agent }] = await Promise.all([
      lead.project_id ? admin.from('projects').select('name, link').eq('id', lead.project_id).maybeSingle() : Promise.resolve({ data: null }),
      lead.assigned_to ? admin.from('members').select('full_name').eq('org_id', lead.org_id).eq('user_id', lead.assigned_to).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const p = project as { name?: string; link?: string | null } | null;
    const params = [
      firstName(lead.name), p?.name || 'our projects', firstName((agent as { full_name?: string } | null)?.full_name) || 'your advisor', org.name,
      p?.link || org.website_url || 'Reply "details" and we will send them',
    ];
    const r = await sendTemplate(lead.phone, TPL_WELCOME(), params);
    const chat = await getChat(admin, lead.org_id, lead.phone, { name: lead.name, leadId: lead.id });
    await logOut(admin, lead.org_id, chat.id, { kind: 'template', body: welcomeText(params), waId: r.ok ? r.id : undefined, error: r.ok ? undefined : r.error });
    if (r.ok) await admin.from('activities').insert({ org_id: lead.org_id, lead_id: lead.id, type: 'whatsapp', body: 'Welcome message and brochure sent automatically on WhatsApp.', by_user: null });
  } catch (e) {
    console.error('WhatsApp welcome failed:', (e as Error).message);
  }
}

/** Site visits in the next 24 hours → one reminder to the client. Run every few minutes. */
export async function sendVisitReminders(): Promise<{ sent: number; failed: number }> {
  const admin = createAdminClient();
  if (!admin || !whatsappReady()) return { sent: 0, failed: 0 };
  const { data: orgs } = await admin.from('organizations').select('id').eq('wa_visit_reminders', true).eq('wa_phone_id', process.env.WHATSAPP_PHONE_NUMBER_ID!);
  const ids = (orgs ?? []).map((o) => o.id as string);
  if (!ids.length) return { sent: 0, failed: 0 };
  const now = Date.now();
  const { data: visits } = await admin.from('visits')
    .select('id, org_id, at, agent_id, lead:leads(id, name, phone, assigned_to), project:projects(name)')
    .in('org_id', ids).eq('status', 'scheduled').is('wa_reminded_at', null)
    .gte('at', new Date(now + 60 * 60_000).toISOString()).lte('at', new Date(now + 24 * 60 * 60_000).toISOString()).limit(50);
  let sent = 0, failed = 0;
  for (const v of (visits ?? []) as unknown as { id: string; org_id: string; at: string; agent_id: string | null; lead: { id: string; name: string; phone: string; assigned_to: string | null } | null; project: { name: string } | null }[]) {
    if (!v.lead?.phone) continue;
    // Claim it first so two runs never double-send.
    const { data: claimed } = await admin.from('visits').update({ wa_reminded_at: new Date().toISOString() }).eq('id', v.id).is('wa_reminded_at', null).select('id');
    if (!claimed?.length) continue;
    const agentId = v.agent_id || v.lead.assigned_to;
    const { data: agent } = agentId ? await admin.from('members').select('full_name, phone').eq('org_id', v.org_id).eq('user_id', agentId).maybeSingle() : { data: null };
    const a = agent as { full_name?: string; phone?: string } | null;
    const params = [firstName(v.lead.name), v.project?.name || 'the project', istTime(v.at), firstName(a?.full_name) || 'Our advisor', a?.phone || 'our office'];
    const r = await sendTemplate(v.lead.phone, TPL_REMINDER(), params);
    const chat = await getChat(admin, v.org_id, v.lead.phone, { name: v.lead.name, leadId: v.lead.id });
    await logOut(admin, v.org_id, chat.id, { kind: 'template', body: reminderText(params), waId: r.ok ? r.id : undefined, error: r.ok ? undefined : r.error });
    if (r.ok) sent++; else failed++;
  }
  return { sent, failed };
}
