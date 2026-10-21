'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ORG_COOKIE, requireOrg } from '@/lib/context';
import { PHONE_HELP, siteUrl, normPhone, validPhone } from '@/lib/roles';
import { notifyLeadAssigned } from '@/lib/whatsapp';

export type FormState = { error?: string; ok?: string; link?: string; phone?: string; name?: string } | null;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 };

function friendly(msg?: string) {
  if (!msg) return 'Something went wrong. Please try again.';
  if (msg.includes('duplicate key') && msg.includes('leads')) return 'This mobile number is already in your CRM.';
  if (msg.includes('row-level security')) return 'You do not have permission to do that.';
  return msg;
}

export async function createCompany(_: FormState, fd: FormData): Promise<FormState> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('create_organization', {
    p_name: str(fd, 'company'),
    p_city: str(fd, 'city'),
    p_rera: str(fd, 'rera'),
    p_full_name: str(fd, 'full_name'),
  });
  if (error) return { error: friendly(error.message) };
  cookies().set(ORG_COOKIE, data as string, cookieOpts);
  redirect('/dashboard?welcome=1');
}

export async function acceptInvite(_: FormState, fd: FormData): Promise<FormState> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('accept_invite', {
    p_token: str(fd, 'token'),
    p_full_name: str(fd, 'full_name'),
  });
  if (error) return { error: friendly(error.message) };
  cookies().set(ORG_COOKIE, data as string, cookieOpts);
  redirect('/dashboard?joined=1');
}

export async function switchOrg(fd: FormData) {
  const id = str(fd, 'org_id');
  if (id) cookies().set(ORG_COOKIE, id, cookieOpts);
  redirect('/dashboard');
}

export async function createInvite(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await requireOrg(['owner', 'manager']);
  const name = str(fd, 'full_name');
  const phone = normPhone(str(fd, 'phone'));
  // People sign up with email (mobile sign-up needs paid SMS), so the invite must name their email.
  if (process.env.NEXT_PUBLIC_WHATSAPP_LOGIN !== 'true' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(fd, 'email'))) {
    return { error: 'Add their email. They will log in with it.' };
  }
  const { data, error } = await supabase.rpc('create_invite', {
    p_org: org.id,
    p_role: str(fd, 'role'),
    p_full_name: name,
    p_phone: phone,
    p_email: str(fd, 'email'),
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath('/team');
  return { ok: 'Invite link ready. Send it to them on WhatsApp.', link: `${siteUrl()}/join/${data}`, phone, name };
}

export async function revokeInvite(fd: FormData) {
  const { supabase } = await requireOrg(['owner', 'manager']);
  await supabase.from('invites').delete().eq('id', str(fd, 'id'));
  revalidatePath('/team');
}

export async function changeRole(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await requireOrg(['owner']);
  const { error } = await supabase.rpc('set_member_role', { p_org: org.id, p_user: str(fd, 'user_id'), p_role: str(fd, 'role') });
  if (error) return { error: friendly(error.message) };
  revalidatePath('/team');
  return { ok: 'Role updated' };
}

export async function deactivateMember(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await requireOrg(['owner', 'manager']);
  const to = str(fd, 'reassign_to');
  const { data, error } = await supabase.rpc('deactivate_member', {
    p_org: org.id,
    p_user: str(fd, 'user_id'),
    p_reassign_to: to || null,
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath('/team');
  return { ok: `Access removed. ${data ?? 0} open lead${data === 1 ? '' : 's'} moved.` };
}

/** Removes a person for good: off the Team page, and their login is deleted if they are in no other company.
 *  Their leads, calls and notes stay (they just show no person). Access must be removed first, so their leads are moved. */
export async function deleteMember(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, user, role } = await requireOrg(['owner', 'manager']);
  const target = str(fd, 'user_id');
  if (!/^[0-9a-f-]{36}$/i.test(target)) return { error: 'Person not found.' };
  if (target === user.id) return { error: 'You cannot delete yourself.' };
  const { data: m } = await supabase.from('members').select('user_id, role, active, full_name').eq('org_id', org.id).eq('user_id', target).maybeSingle();
  if (!m) return { error: 'Person not found.' };
  if (m.active) return { error: 'Remove their access first (so their leads move to someone else).' };
  if (role !== 'owner' && (m.role === 'owner' || m.role === 'manager')) return { error: 'Only an admin can delete an admin or a manager.' };
  const admin = createAdminClient();
  if (!admin) return { error: 'The server key is missing in Vercel (SUPABASE_SERVICE_ROLE_KEY).' };
  const { error } = await admin.from('members').delete().eq('org_id', org.id).eq('user_id', target);
  if (error) return { error: friendly(error.message) };
  await admin.from('join_requests').delete().eq('org_id', org.id).eq('user_id', target);
  const { count } = await admin.from('members').select('user_id', { count: 'exact', head: true }).eq('user_id', target);
  if (!count) await admin.auth.admin.deleteUser(target); // no other company: delete the login itself
  revalidatePath('/team');
  return { ok: `${m.full_name || 'This person'} was deleted.` };
}

/** Admin adds a person straight away with a temporary password: no email code needed (works even when
 *  sign-up emails hit Supabase's limit). They sign in with email or mobile + this password, then choose their own. */
export async function addMemberDirect(_: FormState, fd: FormData): Promise<FormState> {
  const { org, role: myRole } = await requireOrg(['owner', 'manager']);
  const name = str(fd, 'full_name').slice(0, 80);
  const email = str(fd, 'email').toLowerCase();
  const phone = normPhone(str(fd, 'phone'));
  const pick = str(fd, 'role');
  const password = str(fd, 'password');
  if (name.length < 2) return { error: 'Enter their full name.' };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Enter their email address.' };
  if (!validPhone(phone)) return { error: 'Enter their mobile number. ' + PHONE_HELP };
  if (password.length < 8) return { error: 'The temporary password needs at least 8 characters.' };
  if (!['agent', 'intern', 'manager', 'owner'].includes(pick)) return { error: 'Choose a role.' };
  if (myRole !== 'owner' && !['agent', 'intern'].includes(pick)) return { error: 'Only an admin can add a manager or an admin.' };
  const admin = createAdminClient();
  if (!admin) return { error: 'The server key is missing in Vercel (SUPABASE_SERVICE_ROLE_KEY).' };

  const meta = { full_name: name, phone, pw_set: false };
  let userId: string | null = null;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
  if (made.data.user) userId = made.data.user.id;
  else if (made.error && /already|registered|exists/i.test(made.error.message)) {
    // They started sign-up before (e.g. the email code never came): reuse that account and reset its password.
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 500 });
      const u = data?.users.find((x) => (x.email ?? '').toLowerCase() === email);
      if (u) userId = u.id;
      if (!data || data.users.length < 500) break;
    }
    if (!userId) return { error: 'This email already has an account, but it could not be found. Ask them to use "Forgot password".' };
    const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true, user_metadata: meta });
    if (error) return { error: friendly(error.message) };
  } else return { error: friendly(made.error?.message) };

  const { data: other } = await admin.from('members').select('user_id').eq('org_id', org.id).eq('phone', phone).eq('active', true).neq('user_id', userId).maybeSingle();
  if (other) return { error: 'Someone in your team already uses this mobile number.' };
  const { error } = await admin.from('members').upsert({
    org_id: org.id, user_id: userId, role: pick === 'intern' ? 'agent' : pick, is_intern: pick === 'intern',
    full_name: name, phone, email, active: true, deactivated_at: null,
  }, { onConflict: 'org_id,user_id' });
  if (error) return { error: friendly(error.message) };
  await admin.from('user_phones').upsert({ user_id: userId, phone }, { onConflict: 'user_id' }).then(() => {}, () => {});
  await admin.from('join_requests').delete().eq('org_id', org.id).eq('user_id', userId).then(() => {}, () => {});
  revalidatePath('/team');
  return { ok: `${name} is added. Send them their login below.`, name, phone, link: `${siteUrl()}/login` };
}

export async function reactivateMember(fd: FormData) {
  const { supabase, org } = await requireOrg(['owner', 'manager']);
  await supabase.rpc('reactivate_member', { p_org: org.id, p_user: str(fd, 'user_id') });
  revalidatePath('/team');
}

/** Your own mobile number (used on client pages, WhatsApp and for logging in with your number). */
export async function updateMyPhone(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase } = await requireOrg();
  const phone = normPhone(str(fd, 'phone'));
  if (!validPhone(phone)) return { error: PHONE_HELP };
  const { error } = await supabase.rpc('set_my_phone', { p_phone: phone });
  if (error) return { error: friendly(error.message) };
  await supabase.auth.updateUser({ data: { phone } });
  revalidatePath('/', 'layout');
  return { ok: 'Mobile number saved' };
}

/** Admin fixes someone's name (names cannot be changed by the person themselves). */
export async function renameMember(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await requireOrg(['owner']);
  const { error } = await supabase.rpc('set_member_name', { p_org: org.id, p_user: str(fd, 'user_id'), p_name: str(fd, 'full_name') });
  if (error) return { error: friendly(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Name saved' };
}

/** Someone opened the team join link: they ask to join, and wait for approval. */
export async function requestJoin(_: FormState, fd: FormData): Promise<FormState> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Please log in first.' };
  const phone = normPhone(str(fd, 'phone'));
  if (!validPhone(phone)) return { error: PHONE_HELP };
  const { data, error } = await supabase.rpc('request_to_join', {
    p_token: str(fd, 'token'), p_name: str(fd, 'full_name'), p_phone: phone, p_wants: str(fd, 'wants'),
  });
  if (error) return { error: friendly(error.message) };
  if (!user.user_metadata?.phone) await supabase.auth.updateUser({ data: { phone } });
  if (data === 'member') redirect('/dashboard');
  redirect('/onboarding');
}

export async function decideJoin(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase } = await requireOrg(['owner', 'manager']);
  const approve = str(fd, 'approve') === '1';
  const { error } = await supabase.rpc('decide_join', { p_id: str(fd, 'id'), p_approve: approve, p_role: approve ? str(fd, 'role') : null });
  if (error) return { error: friendly(error.message) };
  revalidatePath('/team');
  return { ok: approve ? 'Approved. They can log in now.' : 'Request turned down.' };
}

export async function clearJoinRequest(fd: FormData) {
  const { supabase } = await requireOrg(['owner']);
  await supabase.rpc('clear_join_request', { p_id: str(fd, 'id') });
  revalidatePath('/team');
}

/** Admin: who does each step of the client journey. */
export async function setStepTeam(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await requireOrg(['owner']);
  const step = str(fd, 'step');
  const users = fd.getAll('user').map(String).filter((u) => /^[0-9a-f-]{36}$/.test(u));
  const { error } = await supabase.rpc('set_step_team', { p_org: org.id, p_step: step, p_users: users });
  if (error) return { error: friendly(error.message) };
  revalidatePath('/team');
  return { ok: users.length ? 'Saved' : 'Saved. Nobody does this step now, so clients stay with the last person.' };
}

/** Admin: which manager a person reports to (managers see their team's clients). */
export async function setReportsTo(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await requireOrg(['owner']);
  const m = str(fd, 'manager_id');
  const { error } = await supabase.rpc('set_reports_to', { p_org: org.id, p_user: str(fd, 'user_id'), p_manager: m || null });
  if (error) return { error: friendly(error.message) };
  revalidatePath('/team');
  return { ok: 'Saved' };
}

export async function setJoinLink(fd: FormData) {
  const { supabase, org } = await requireOrg(['owner']);
  await supabase.rpc('set_join_link', { p_org: org.id, p_open: str(fd, 'open') === '1', p_new: str(fd, 'new') === '1' });
  revalidatePath('/team');
}

export async function updateCompany(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await requireOrg(['owner']);
  const { error } = await supabase.rpc('update_organization', {
    p_org: org.id, p_name: str(fd, 'company'), p_city: str(fd, 'city'), p_rera: str(fd, 'rera'),
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath('/', 'layout');
  return { ok: 'Company details saved' };
}

export async function addLead(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org, role, user } = await requireOrg();
  const name = str(fd, 'name');
  const phone = normPhone(str(fd, 'phone'));
  if (!name) return { error: 'Enter the client name' };
  if (!validPhone(phone)) return { error: PHONE_HELP };
  const assigned = role === 'owner' || role === 'manager' ? str(fd, 'assigned_to') || null : role === 'agent' ? user.id : null;
  const { data, error } = await supabase
    .from('leads')
    .insert({ org_id: org.id, name, phone, source: str(fd, 'source') || null, assigned_to: assigned })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') {
      return { error: role === 'owner' || role === 'manager'
        ? 'This mobile number is already in your CRM. Search for it in the list.'
        : 'This mobile number is already in your CRM under someone else. Ask your manager.' };
    }
    return { error: friendly(error.message) };
  }
  await supabase.from('activities').insert({ org_id: org.id, lead_id: data.id, type: 'created', body: `Lead added${str(fd, 'source') ? ' from ' + str(fd, 'source') : ''}` });
  if (assigned && assigned !== user.id) {
    const { data: agent } = await supabase.from('members').select('full_name, phone').eq('org_id', org.id).eq('user_id', assigned).single();
    if (agent) await notifyLeadAssigned({ agentPhone: agent.phone, agentName: agent.full_name, leadName: name, leadPhone: phone, source: str(fd, 'source') });
  }
  revalidatePath('/leads');
  revalidatePath('/dashboard');
  return { ok: 'Lead saved' };
}

// ---------- Lead sources (automatic lead capture) ----------
const KINDS = ['generic', '99acres', 'magicbricks', 'housing', 'website', 'meta', 'google'];

export async function createSource(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await requireOrg(['owner']);
  const kind = KINDS.includes(str(fd, 'kind')) ? str(fd, 'kind') : 'generic';
  const name = str(fd, 'name') || ({ '99acres': '99acres', magicbricks: 'MagicBricks', housing: 'Housing.com', website: 'Website', meta: 'Facebook / Instagram', google: 'Google Ads', generic: 'Other' } as Record<string, string>)[kind];
  const pageId = str(fd, 'page_id').replace(/\D/g, '');
  if (kind === 'meta' && !pageId) return { error: 'Enter your Facebook page ID.' };
  const { error } = await supabase.from('lead_sources').insert({
    org_id: org.id, name, kind, default_project_id: str(fd, 'project_id') || null, external_id: kind === 'meta' ? pageId : null,
  });
  if (error) return { error: error.message.includes('lead_sources_meta_page_idx') ? 'This Facebook page is already connected.' : friendly(error.message) };
  revalidatePath('/sources');
  return { ok: 'Lead source added. Copy its link below.' };
}

export async function toggleSource(fd: FormData) {
  const { supabase } = await requireOrg(['owner']);
  await supabase.from('lead_sources').update({ active: str(fd, 'active') === 'true' }).eq('id', str(fd, 'id'));
  revalidatePath('/sources');
}

/** Resale listings (e.g. a 99acres "certified agent" package) can send their leads to the Secondary list. */
export async function setSourceSegment(fd: FormData) {
  const { supabase, org } = await requireOrg(['owner']);
  const segment = str(fd, 'segment') === 'secondary' ? 'secondary' : 'primary';
  await supabase.from('lead_sources').update({ segment }).eq('id', str(fd, 'id')).eq('org_id', org.id);
  revalidatePath('/sources');
}

export async function saveMetaToken(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await requireOrg(['owner']);
  const id = str(fd, 'id'); const token = str(fd, 'token');
  if (token.length < 30) return { error: 'Paste the full page access token.' };
  const { data: src } = await supabase.from('lead_sources').select('id').eq('id', id).eq('org_id', org.id).eq('kind', 'meta').maybeSingle();
  if (!src) return { error: 'Source not found' };
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const admin = createAdminClient();
  if (!admin) return { error: 'The server is missing SUPABASE_SERVICE_ROLE_KEY. Add it in Vercel first.' };
  const { error } = await admin.from('lead_source_secrets').upsert({ source_id: id, page_token: token, updated_at: new Date().toISOString() });
  if (error) return { error: friendly(error.message) };
  return { ok: 'Facebook page connected.' };
}

export async function setAutoAssign(fd: FormData) {
  const { supabase, org } = await requireOrg(['owner']);
  await supabase.rpc('set_auto_assign', { p_org: org.id, p_on: str(fd, 'on') === 'true' });
  revalidatePath('/sources');
}

// ---------- Alerts ----------

export async function setReassignMinutes(fd: FormData) {
  const { supabase, org } = await requireOrg(['owner']);
  const v = Number(str(fd, 'minutes'));
  await supabase.rpc('set_reassign_minutes', { p_org: org.id, p_minutes: v >= 5 && v <= 240 ? v : null });
  revalidatePath('/sources');
}

export async function markAllRead() {
  const { supabase, user } = await requireOrg();
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
  revalidatePath('/notifications');
}

/** Alerts page: mark one alert as read (without leaving the page). */
export async function markAlertsRead(fd: FormData) {
  const { supabase, user } = await requireOrg();
  const id = str(fd, 'id');
  if (id) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
  revalidatePath('/notifications');
}

export async function openNotification(fd: FormData) {
  const { supabase, user } = await requireOrg();
  const id = str(fd, 'id');
  const { data } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id).select('link').maybeSingle();
  const link = data?.link ?? '';
  redirect(link.startsWith('/') && !link.startsWith('//') ? link : '/notifications');
}

// ---------- Client website ----------

export async function saveWebsiteUrl(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await requireOrg(['owner']);
  const { data, error } = await supabase.rpc('set_website_url', { p_org: org.id, p_url: str(fd, 'url').slice(0, 200) });
  if (error) return { error: /website address|admin/i.test(error.message) ? error.message : /function|column/i.test(error.message) ? 'Run patch-022 in Supabase first.' : friendly(error.message) };
  revalidatePath('/sources'); revalidatePath('/projects');
  return { ok: data ? `Saved. Links you send now open on ${data}.` : 'Removed. Links open on the CRM again.' };
}

export async function saveWebsitePhone(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await requireOrg(['owner']);
  const { data, error } = await supabase.rpc('set_website_phone', { p_org: org.id, p_phone: str(fd, 'phone').slice(0, 30) });
  if (error) return { error: /phone number|admin/i.test(error.message) ? error.message : /function|column/i.test(error.message) ? 'Run patch-023 in Supabase first.' : friendly(error.message) };
  revalidatePath('/sources');
  return { ok: data ? `Saved. The website call button now rings ${data}.` : 'Removed. The website hides the call button.' };
}

export async function setVerifyPhone(fd: FormData) {
  const { supabase, org } = await requireOrg(['owner']);
  await supabase.rpc('set_verify_phone', { p_org: org.id, p_on: str(fd, 'on') === 'true' });
  revalidatePath('/sources');
}
