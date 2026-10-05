import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { SignOutButtons } from '@/components/SignOutButtons';
import { getContext } from '@/lib/context';
import { APP_NAME } from '@/lib/brand';

export const metadata = { title: 'No access' };

const COPY: Record<string, { t: string; b: string }> = {
  removed: { t: 'Your access was removed', b: 'An admin or manager has switched off your account. If you think this is a mistake, contact them.' },
  trial: { t: 'Free trial has ended', b: 'Your company’s 14-day trial is over. Your data is safe. An admin needs to renew the plan to continue.' },
  suspended: { t: 'Account paused', b: `This company account is paused. An admin needs to contact ${APP_NAME} support to switch it back on.` },
};

export default async function Blocked({ searchParams }: { searchParams: { r?: string } }) {
  const c = COPY[searchParams.r ?? ''] ?? COPY.removed;
  const { user, memberships } = await getContext();
  const others = memberships.filter((m) => m.active).length > 1;
  return (
    <AuthShell>
      <div className="auth-card">
        <h1>{c.t}</h1>
        <p className="muted">{c.b}</p>
        {others && <Link className="btn" href="/select-company">Switch to another company</Link>}
        {user && <SignOutButtons compact />}
      </div>
    </AuthShell>
  );
}
