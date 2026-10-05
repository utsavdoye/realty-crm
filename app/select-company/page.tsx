import { redirect } from 'next/navigation';
import { getContext, orgUsable } from '@/lib/context';
import { switchOrg } from '@/app/actions';
import { AuthShell } from '@/components/AuthShell';
import { ROLE_LABEL } from '@/lib/roles';

export const metadata = { title: 'Choose company' };

export default async function SelectCompany() {
  const { user, memberships } = await getContext();
  if (!user) redirect('/login');
  const active = memberships.filter((m) => m.active && m.organizations);
  if (!active.length) redirect('/onboarding');
  return (
    <AuthShell>
      <div className="auth-card">
        <h1>Choose a company</h1>
        <p className="muted">You work with more than one team. Pick where you want to go.</p>
        <div className="stack">
          {active.map((m) => (
            <form key={m.org_id} action={switchOrg}>
              <input type="hidden" name="org_id" value={m.org_id} />
              <button className="org-pick">
                <span className="org-initial">{m.organizations!.name.slice(0, 1).toUpperCase()}</span>
                <span className="org-text"><b>{m.organizations!.name}</b><span className="hint">{ROLE_LABEL[m.role]}{m.organizations!.city ? ' · ' + m.organizations!.city : ''}{!orgUsable(m.organizations) ? ' · plan ended' : ''}</span></span>
              </button>
            </form>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}
