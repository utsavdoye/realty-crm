import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requestJoin } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { AuthShell } from '@/components/AuthShell';
import { PhoneInput } from '@/components/PhoneInput';
import { SignOutButtons } from '@/components/SignOutButtons';

export const metadata = { title: 'Join your team', robots: { index: false } };

export default async function JoinTeam({ params }: { params: { token: string } }) {
  const supabase = createClient();
  const token = params.token.replace(/[^a-f0-9]/gi, '').slice(0, 64);
  const [{ data: rows }, { data: { user } }] = await Promise.all([
    supabase.rpc('get_join_link', { p_token: token }),
    supabase.auth.getUser(),
  ]);
  const co = (rows as { org_name: string; city: string | null }[] | null)?.[0];

  if (!co) {
    return (
      <AuthShell>
        <div className="auth-card">
          <h1>Link not working</h1>
          <p className="muted">This team link was turned off or changed. Ask your admin for the new one.</p>
          {user && <Link className="btn" href="/dashboard">Go to my account</Link>}
        </div>
      </AuthShell>
    );
  }

  if (user) {
    const { data: mine } = await supabase.from('members').select('active').eq('user_id', user.id);
    if ((mine ?? []).some((m) => m.active)) redirect('/dashboard');
  }
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; phone?: string };

  return (
    <AuthShell>
      <div className="auth-card">
        <p className="label">Team link</p>
        <h1>Join {co.org_name}</h1>
        <p className="muted">{co.city ? `${co.city} · ` : ''}Fill this once. Your admin checks it and lets you in. You cannot see anything until then.</p>
        {!user ? (
          <>
            <Link className="btn primary block" href={`/login?next=${encodeURIComponent('/join/team/' + token)}`}>Log in or create an account</Link>
            <p className="hint">New here? Create an account with your email, then come back to this link.</p>
          </>
        ) : (
          <>
            <ActionForm action={requestJoin} className="stack">
              <input type="hidden" name="token" value={token} />
              <label className="field"><span className="label">Your full name</span><input name="full_name" required minLength={2} maxLength={80} defaultValue={meta.full_name ?? ''} placeholder="As on your ID" />
                <span className="hint">You cannot change it later. Only the admin can.</span></label>
              <label className="field"><span className="label">Your mobile number</span><PhoneInput required defaultValue={meta.phone ?? (user.phone ? '+' + user.phone : '')} /></label>
              <label className="field"><span className="label">I will work as</span>
                <select name="wants" defaultValue="agent" required>
                  <option value="agent">Employee (sales / calling)</option>
                  <option value="intern">Intern</option>
                  <option value="manager">Manager (the admin must approve)</option>
                </select>
              </label>
              <Submit className="btn primary block">Ask to join</Submit>
            </ActionForm>
            <p className="hint">Logged in as {user.phone ? '+' + user.phone : user.email}.</p>
            <SignOutButtons compact />
          </>
        )}
      </div>
    </AuthShell>
  );
}
