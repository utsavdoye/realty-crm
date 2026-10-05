import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AuthShell } from '@/components/AuthShell';
import { safeNext, fmtPhone } from '@/lib/roles';
import { SetPasswordForm } from './SetPasswordForm';

export const metadata = { title: 'Choose a password' };

export default async function SetPassword({ searchParams }: { searchParams: { next?: string; mode?: string } }) {
  const { data: { user } } = await createClient().auth.getUser();
  if (!user) redirect('/login?error=link');
  const reset = searchParams.mode === 'reset';
  const phone = (user.user_metadata?.phone as string | undefined) ?? (user.phone ? '+' + user.phone : undefined);
  return (
    <AuthShell>
      <div className="auth-card">
        <h1>{reset ? 'Set a new password' : 'Choose your password'}</h1>
        <p className="muted">{user.email ?? fmtPhone(phone)} {reset ? '' : '— next time you can sign in with this and your password.'}</p>
        <SetPasswordForm next={safeNext(searchParams.next)} askPhone={!phone} askName={!reset && !user.user_metadata?.full_name} />
      </div>
    </AuthShell>
  );
}
