'use server';

import { revalidatePath } from 'next/cache';
import { requireOrg } from '@/lib/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { markRead, sendDocumentLink, sendTemplate, sendText, whatsappReady } from '@/lib/whatsapp';
import { getChat, logOut, TPL_WELCOME, welcomeText } from '@/lib/waInbox';

type R = { ok?: string; error?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 24 * 60 * 60_000;
const first = (n?: string | null) => (n || '').trim().split(/\s+/)[0] || 'there';

/** Loads a chat the signed-in person is allowed to see, and checks WhatsApp is connected for this company. */
async function chatFor(chatId: string) {
  const ctx = await requireOrg();
  if (!UUID.test(chatId)) throw new Error('Chat not found.');
  const { data: chat } = await ctx.supabase.from('wa_chats').select('id, org_id, phone, name, lead_id, last_in_at').eq('id', chatId).eq('org_id', ctx.org.id).maybeSingle();
  if (!chat) throw new Error('Chat not found.');
  const admin = createAdminClient();
  if (!admin || !whatsappReady()) throw new Error('WhatsApp is not connected yet. See the setup steps on this page.');
  const { data: o } = await admin.from('organizations').select('wa_phone_id').eq('id', ctx.org.id).maybeSingle();
  if (o?.wa_phone_id !== process.env.WHATSAPP_PHONE_NUMBER_ID) throw new Error('Press "Use this WhatsApp number" in WhatsApp settings first.');
  return { ...ctx, chat, admin };
}
const open = (last: string | null) => !!last && Date.now() - Date.parse(last) < DAY;
const closedMsg = 'The client has not written in the last 24 hours, so WhatsApp only allows an approved template. Use “Send welcome + brochure” to restart the chat.';

async function note(admin: NonNullable<ReturnType<typeof createAdminClient>>, orgId: string, leadId: string | null, by: string, body: string) {
  if (leadId) await admin.from('activities').insert({ org_id: orgId, lead_id: leadId, type: 'whatsapp', body, by_user: by });
}

export async function sendWaText(chatId: string, text: string): Promise<R> {
  try {
    const t = String(text ?? '').trim();
    if (!t) return { error: 'Type a message.' };
    const { chat, admin, user, org } = await chatFor(chatId);
    if (!open(chat.last_in_at)) return { error: closedMsg };
    const r = await sendText(chat.phone, t);
    await logOut(admin, org.id, chat.id, { kind: 'text', body: t, waId: r.ok ? r.id : undefined, error: r.ok ? undefined : r.error, by: user.id });
    revalidatePath('/whatsapp');
    return r.ok ? { ok: 'Sent' } : { error: r.error };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function sendWaBrochure(chatId: string, projectId: string): Promise<R> {
  try {
    const { chat, admin, user, org, supabase } = await chatFor(chatId);
    if (!open(chat.last_in_at)) return { error: closedMsg };
    const { data: p } = await supabase.from('projects').select('name, link').eq('id', projectId).eq('org_id', org.id).maybeSingle();
    if (!p) return { error: 'Project not found.' };
    if (!p.link) return { error: `${p.name} has no brochure yet. Add it on the Projects page.` };
    const isFile = /\.pdf($|\?)/i.test(p.link) || p.link.includes('/storage/v1/object/public/');
    const r = isFile ? await sendDocumentLink(chat.phone, p.link, `${p.name} brochure.pdf`, `${p.name} – brochure`) : await sendText(chat.phone, `${p.name} – brochure and details: ${p.link}`);
    await logOut(admin, org.id, chat.id, { kind: isFile ? 'document' : 'text', body: `${p.name} brochure`, fileName: isFile ? `${p.name} brochure.pdf` : undefined, waId: r.ok ? r.id : undefined, error: r.ok ? undefined : r.error, by: user.id });
    if (r.ok) await note(admin, org.id, chat.lead_id, user.id, `Sent ${p.name} brochure on WhatsApp.`);
    revalidatePath('/whatsapp');
    return r.ok ? { ok: 'Brochure sent' } : { error: r.error };
  } catch (e) { return { error: (e as Error).message }; }
}

/** The approved template: works any time, also to start a new conversation. */
export async function sendWaWelcome(chatId: string, projectId: string): Promise<R> {
  try {
    const { chat, admin, user, org, supabase, me } = await chatFor(chatId);
    const { data: p } = projectId ? await supabase.from('projects').select('name, link').eq('id', projectId).eq('org_id', org.id).maybeSingle() : { data: null };
    const { data: o } = await admin.from('organizations').select('name, website_url').eq('id', org.id).maybeSingle();
    const params = [first(chat.name), p?.name || 'our projects', first(me.full_name), o?.name || org.name, p?.link || o?.website_url || 'Reply here and we will share them'];
    const r = await sendTemplate(chat.phone, TPL_WELCOME(), params);
    await logOut(admin, org.id, chat.id, { kind: 'template', body: welcomeText(params), waId: r.ok ? r.id : undefined, error: r.ok ? undefined : r.error, by: user.id });
    if (r.ok) await note(admin, org.id, chat.lead_id, user.id, `Sent the WhatsApp welcome message${p ? ` for ${p.name}` : ''}.`);
    revalidatePath('/whatsapp');
    return r.ok ? { ok: 'Sent' } : { error: /template/i.test(r.error) ? `${r.error} — check the "${TPL_WELCOME()}" template is approved in WhatsApp Manager.` : r.error };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function markChatRead(chatId: string): Promise<void> {
  try {
    const ctx = await requireOrg();
    if (!UUID.test(chatId)) return;
    const { data: chat } = await ctx.supabase.from('wa_chats').select('id, unread').eq('id', chatId).maybeSingle();
    if (!chat || !chat.unread) return;
    const admin = createAdminClient();
    if (!admin) return;
    await admin.from('wa_chats').update({ unread: 0 }).eq('id', chatId);
    const { data: last } = await admin.from('wa_messages').select('wa_id').eq('chat_id', chatId).eq('dir', 'in').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (last?.wa_id) await markRead(last.wa_id);
  } catch { /* not important */ }
}

/** From a lead page: open (or start) the WhatsApp chat with that client. */
export async function chatIdForLead(leadId: string): Promise<{ id?: string; error?: string }> {
  try {
    const { supabase, org } = await requireOrg();
    const { data: lead } = await supabase.from('leads').select('id, name, phone').eq('id', leadId).eq('org_id', org.id).maybeSingle();
    if (!lead) return { error: 'Lead not found.' };
    const admin = createAdminClient();
    if (!admin) return { error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).' };
    const chat = await getChat(admin, org.id, lead.phone, { name: lead.name, leadId: lead.id });
    return { id: chat.id };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function saveWaSettings(_: unknown, fd: FormData): Promise<R> {
  const { org } = await requireOrg(['owner']);
  const admin = createAdminClient();
  if (!admin) return { error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).' };
  const patch: Record<string, unknown> = {
    wa_auto_welcome: fd.get('wa_auto_welcome') === 'on',
    wa_visit_reminders: fd.get('wa_visit_reminders') === 'on',
    wa_lead_source: String(fd.get('wa_lead_source') || '') || null,
  };
  if (fd.get('connect') === 'on') {
    if (!process.env.WHATSAPP_PHONE_NUMBER_ID) return { error: 'Add WHATSAPP_PHONE_NUMBER_ID in Vercel first.' };
    patch.wa_phone_id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
  const { error } = await admin.from('organizations').update(patch).eq('id', org.id);
  revalidatePath('/whatsapp');
  if (error) return { error: /wa_/.test(error.message) ? 'Run supabase/patch-040-whatsapp-inbox.sql in Supabase first.' : /organizations_wa_phone_idx|duplicate/.test(error.message) ? 'This WhatsApp number is already used by another company in the CRM.' : error.message };
  return { ok: 'Saved.' };
}
