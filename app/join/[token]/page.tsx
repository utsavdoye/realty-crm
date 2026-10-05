import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { acceptInvite } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { AuthShell } from '@/components/AuthShell';
import { ROLE_HELP, ROLE_LABEL, type Role } from '@/lib/roles';
import { SignOutButtons } from '@/components/SignOutButtons';

export const metadata = { title: 'Join team' };

export default async function Join({ params }: { params: { token: string } }) {
  const supabase = createClient();
  const token = params.token.replace(/[^a-f0-9]/gi, '').slice(0, 80);
  const [{ data: rows }, { data: { user } }] = await Promise.all([
    supabase.rpc('get_invite', { p_token: token }),
    supabase.auth.getUser(),
  ]);
  const inv = (rows as { org_name: string; role: Role; full_name: string | null; contact_hint: string | null; status: string }[] | null)?.[0];

  if (!inv || inv.status !== 'ok') {
    const msg = inv?.status === 'used' ? 'This invite link was already used.' : inv?.status === 'expired' ? 'This invite link has expired.' : 'This invite link is not valid.';
    return (
      <AuthShell>
        <div className="auth-card">
          <h1>Link not working</h1>
          <p className="muted">{msg} Ask the person who invited you to send a new link.</p>
          {user && <Link className="btn" href="/dashboard">Go to my account</Link>}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="auth-card">
        <p className="label">You are invited</p>
        <h1>Join {inv.org_name}</h1>
        <p className="muted">as <b>{ROLE_LABEL[inv.role]}</b>. {ROLE_HELP[inv.role]}</p>
        {!user ? (
          <>
            <p className="hint">Log in with the {inv.contact_hint || 'mobile number this invite was sent to'}.</p>
            <Link className="btn primary block" href={`/login?next=${encodeURIComponent('/join/' + token)}`}>Log in to accept</Link>
          </>
        ) : (
          <>
            <ActionForm action={acceptInvite} className="stack">
              <input type="hidden" name="token" value={token} />
              <label className="field"><span className="label">Your name</span><input name="full_name" required defaultValue={inv.full_name ?? ''} /></label>
              <Submit className="btn primary block">Join team</Submit>
            </ActionForm>
            <p className="hint">Logged in as {user.phone ? '+' + user.phone : user.email}. This invite is for the {inv.contact_hint}.</p>
            <SignOutButtons compact />
          </>
        )}
      </div>
    </AuthShell>
  );
}
