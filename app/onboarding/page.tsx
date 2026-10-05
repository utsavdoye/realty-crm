import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { createCompany } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { AuthShell } from '@/components/AuthShell';
import { SignOutButtons } from '@/components/SignOutButtons';

export const metadata = { title: 'Create company' };

export default async function Onboarding() {
  const { user, memberships } = await getContext();
  if (!user) redirect('/login');
  if (memberships.some((m) => m.active)) redirect('/dashboard');
  return (
    <AuthShell>
      <div className="auth-card">
        <p className="label">Step 1 of 2</p>
        <h1>Create your company account</h1>
        <p className="muted">You will be the admin. You get 14 days free. Then you add your team.</p>
        <ActionForm action={createCompany} className="stack">
          <label className="field"><span className="label">Your name</span><input name="full_name" required placeholder="Rajesh Doye" /></label>
          <label className="field"><span className="label">Company name</span><input name="company" required placeholder="Doye Realty" /></label>
          <div className="grid2f">
            <label className="field"><span className="label">City</span><input name="city" placeholder="Bengaluru" /></label>
            <label className="field"><span className="label">RERA number (optional)</span><input name="rera" placeholder="PRM/KA/RERA/…" /></label>
          </div>
          <Submit className="btn primary block">Create company</Submit>
        </ActionForm>
        <div className="divider" />
        <p className="hint">Joining someone else&apos;s team? You don&apos;t need this page. Open the invite link they sent you on WhatsApp.</p>
        <p className="hint">Logged in as {user.phone ? '+' + user.phone : user.email}.</p>
        <SignOutButtons compact />
      </div>
    </AuthShell>
  );
}
