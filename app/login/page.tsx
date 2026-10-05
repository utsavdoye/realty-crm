import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/roles';
import LoginForm from './LoginForm';
import { AuthShell } from '@/components/AuthShell';

export const metadata = { title: 'Log in' };

export default async function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  const next = safeNext(searchParams.next);
  const { data: { user } } = await createClient().auth.getUser();
  if (user) redirect(next);
  const hint = next.startsWith('/join/') ? 'Log in with the mobile number or email your invite was sent to.' : undefined;
  return (
    <AuthShell>
      <LoginForm next={next} inviteHint={hint} linkError={searchParams.error === 'link'} />
      <p className="hint center">New company? Log in first, then you can create your company account.</p>
    </AuthShell>
  );
}
