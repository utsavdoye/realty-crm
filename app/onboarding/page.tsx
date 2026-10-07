import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { createClient } from '@/lib/supabase/server';
import { createCompany } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { AuthShell } from '@/components/AuthShell';
import { SignOutButtons } from '@/components/SignOutButtons';

export const metadata = { title: 'Create company' };

export default async function Onboarding() {
  const { user, memberships } = await getContext();
  if (!user) redirect('/login');
  if (memberships.some((m) => m.active)) redirect('/dashboard');
  const supabase = createClient();
  const [{ data: reqs }, { data: canCreate }] = await Promise.all([
    supabase.from('join_requests').select('org_name, status, wants, created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
    supabase.rpc('can_create_company'),
  ]);
  const pending = (reqs ?? []).find((r) => r.status === 'pending');
  const rejected = (reqs ?? []).find((r) => r.status === 'rejected');
  const who = user.phone ? '+' + user.phone : user.email;
  if (pending || !canCreate) {
    return (
      <AuthShell>
        <div className="auth-card">
          {pending ? (
            <>
              <p className="label">Almost there</p>
              <h1>Waiting for approval</h1>
              <p className="muted">You asked to join <b>{pending.org_name}</b> as {pending.wants === 'manager' ? 'a Manager' : pending.wants === 'intern' ? 'an Intern' : 'an Employee'}. {pending.wants === 'manager' ? 'The admin' : 'Your admin or manager'} has been told. Once they approve you, this page opens your account.</p>
              <a className="btn primary block" href="/onboarding">Check again</a>
            </>
          ) : rejected ? (
            <>
              <h1>Request not accepted</h1>
              <p className="muted">{rejected.org_name} did not approve your request. If this is a mistake, talk to your admin.</p>
            </>
          ) : (
            <>
              <h1>Ask for your team link</h1>
              <p className="muted">You are logged in, but you are not part of a company yet. Ask your admin for the team join link (it is on their Team page) and open it.</p>
            </>
          )}
          <p className="hint">Logged in as {who}.</p>
          <SignOutButtons compact />
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <div className="auth-card">
        <p className="label">Step 1 of 2</p>
        <h1>Create your company account</h1>
        <p className="muted">You will be the admin. Then you add your team.</p>
        <ActionForm action={createCompany} className="stack">
          <label className="field"><span className="label">Your name</span><input name="full_name" required placeholder="Rajesh Doye" /></label>
          <label className="field"><span className="label">Company name</span><input name="company" required placeholder="Doye Realty" /></label>
          <div className="grid2f">
            <label className="field"><span className="label">City</span><input name="city" placeholder="Raipur" /></label>
            <label className="field"><span className="label">RERA number (optional)</span><input name="rera" placeholder="PRM/KA/RERA/…" /></label>
          </div>
          <Submit className="btn primary block">Create company</Submit>
        </ActionForm>
        <div className="divider" />
        <p className="hint">Joining someone else&apos;s team? You don&apos;t need this page. Open the invite link they sent you on WhatsApp.</p>
        <p className="hint">Logged in as {who}.</p>
        <SignOutButtons compact />
      </div>
    </AuthShell>
  );
}
