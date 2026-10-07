import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/roles';
import LoginForm from './LoginForm';
import { AuthShell } from '@/components/AuthShell';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  const next = safeNext(searchParams.next);
  const { data: { user } } = await createClient().auth.getUser();
  if (user) redirect(next);
  const hint = next.startsWith('/join/team/') ? 'Log in, or choose "Create account" if you are new. After that you ask to join your team.' : next.startsWith('/join/') ? 'Use the email or mobile number your invite was sent to. New? Choose "Create account".' : undefined;
  return (
    <AuthShell>
      <LoginForm next={next} inviteHint={hint} linkError={searchParams.error === 'link'} />
      
    </AuthShell>
  );
}
