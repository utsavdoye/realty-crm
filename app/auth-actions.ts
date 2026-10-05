'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normPhone, safeNext, siteUrl, validPhone } from '@/lib/roles';

export type AuthState = { error?: string; ok?: string } | null;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

async function emailForPhone(phone: string): Promise<{ email?: string; error?: string }> {
  const admin = createAdminClient();
  if (!admin) return { error: 'Mobile sign-in is not switched on yet. Use your email.' };
  const { data } = await admin.rpc('login_email_for_phone', { p_phone: phone });
  return { email: (data as string | null) ?? undefined };
}

/** Sign in with email + password, or mobile + password. */
export async function signInAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const via = str(fd, 'via');
  const password = String(fd.get('password') ?? '');
  const next = safeNext(str(fd, 'next'));
  if (!password) return { error: 'Enter your password.' };
  const supabase = createClient();
  let email = str(fd, 'email').toLowerCase();
  if (via === 'phone') {
    const phone = normPhone(str(fd, 'phone'));
    if (!validPhone(phone)) return { error: 'Enter a valid mobile number.' };
    const found = await emailForPhone(phone);
    if (found.error) return { error: found.error };
    if (!found.email) {
      // accounts made with a mobile number only
      const { error } = await supabase.auth.signInWithPassword({ phone: phone.startsWith('+') ? phone : '+91' + phone, password });
      if (error) return { error: 'Wrong mobile number or password.' };
      redirect(next);
    }
    email = found.email!;
  } else if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Enter a valid email address.' };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (/confirm/i.test(error.message)) return { error: 'Please finish sign-up first: use "Create account" with this email.' };
    return { error: via === 'phone' ? 'Wrong mobile number or password.' : 'Wrong email or password. New here? Use "Create account".' };
  }
  redirect(next);
}

/** After the email code / link: choose a password and save the mobile number. Also used after "forgot password". */
export async function setPasswordAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your sign-in link expired. Please start again.' };
  const password = String(fd.get('password') ?? '');
  const confirm = String(fd.get('confirm') ?? '');
  const next = safeNext(str(fd, 'next'));
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return { error: 'Use letters and numbers in the password.' };
  if (password !== confirm) return { error: 'The two passwords are not the same.' };

  const phoneTyped = str(fd, 'phone');
  const meta: Record<string, unknown> = { pw_set: true };
  if (phoneTyped) {
    const phone = normPhone(phoneTyped);
    if (!validPhone(phone)) return { error: 'Enter a valid mobile number, or leave it empty.' };
    const { error } = await supabase.rpc('set_my_phone', { p_phone: phone });
    if (error) return { error: error.message.includes('already used') ? 'This mobile number is already used by another account.' : error.message };
    meta.phone = phone;
  } else if (str(fd, 'require_phone') === '1' && !user.user_metadata?.phone) {
    return { error: 'Add your mobile number, so you can also sign in with it.' };
  }
  const name = str(fd, 'full_name');
  if (name) meta.full_name = name.slice(0, 80);

  const { error } = await supabase.auth.updateUser({ password, data: meta });
  if (error) return { error: /same/i.test(error.message) ? 'Choose a password different from your old one.' : error.message };
  redirect(next);
}

/** Forgot password: send a reset link to the account's email. Works with email or mobile number. */
export async function forgotAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const via = str(fd, 'via');
  let email = str(fd, 'email').toLowerCase();
  if (via === 'phone') {
    const phone = normPhone(str(fd, 'phone'));
    if (!validPhone(phone)) return { error: 'Enter a valid mobile number.' };
    const found = await emailForPhone(phone);
    if (found.error) return { error: found.error };
    if (!found.email) return { ok: 'If this number has an account, we have sent a reset link to its email.' };
    email = found.email;
  } else if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Enter a valid email address.' };

  const { error } = await createClient().auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent('/auth/set-password?mode=reset')}`,
  });
  if (error && /rate|seconds/i.test(error.message)) return { error: 'Too many tries. Wait a minute and try again.' };
  return { ok: via === 'phone' ? 'We have sent a reset link to the email linked to this number. Open it on this device.' : 'If this email has an account, a reset link is on its way. Open it on this device.' };
}
