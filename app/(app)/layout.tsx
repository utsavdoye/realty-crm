import type { ReactNode } from 'react';
import { requireOrg } from '@/lib/context';
import { Logo } from '@/components/AuthShell';
import { NavLinks } from '@/components/NavLinks';
import { SignOutButtons } from '@/components/SignOutButtons';
import { switchOrg } from '@/app/actions';
import { ROLE_LABEL } from '@/lib/roles';
import { Bell } from '@/components/Bell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, org, role, me, memberships, user } = await requireOrg();
  const { count: unread } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null);
  const daysLeft = org.plan_status === 'trial' ? Math.ceil((new Date(org.trial_ends_at).getTime() - Date.now()) / 86400000) : null;
  return (
    <div className="app">
      <aside className="side">
        <Logo />
        <div className="org-box">
          <div className="org-name">{org.name}</div>
          <div className="hint">{me.full_name} · {ROLE_LABEL[role]}</div>
          {memberships.length > 1 && (
            <form action={switchOrg} className="org-switch">
              <select name="org_id" defaultValue={org.id} aria-label="Switch company">
                {memberships.map((m) => <option key={m.org_id} value={m.org_id}>{m.organizations?.name}</option>)}
              </select>
              <button className="btn sm">Switch</button>
            </form>
          )}
        </div>
        <Bell userId={user.id} initial={unread ?? 0} />
        <NavLinks role={role} />
        <div className="side-foot">
          {daysLeft !== null && <div className="trial">{daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in free trial` : 'Trial ends today'}</div>}
          <SignOutButtons compact />
        </div>
      </aside>
      <Bell userId={user.id} initial={unread ?? 0} floating />
      <main className="main">{children}</main>
      <NavLinks role={role} mobile />
    </div>
  );
}
