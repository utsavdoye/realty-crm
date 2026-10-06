import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireOrg } from '@/lib/context';
import { Logo } from '@/components/AuthShell';
import { NavLinks } from '@/components/NavLinks';
import { SignOutButtons } from '@/components/SignOutButtons';
import { switchOrg } from '@/app/actions';
import { PICK_LABEL, memberRole } from '@/lib/roles';
import { Bell } from '@/components/Bell';
import { SideToggle } from '@/components/SideToggle';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, org, role, me, memberships, user } = await requireOrg();
  const { count: unread } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null);
  const mini = cookies().get('ed_side')?.value === 'mini';
  const daysLeft = org.plan_status === 'trial' ? Math.ceil((new Date(org.trial_ends_at).getTime() - Date.now()) / 86400000) : null;
  return (
    <div className={`app ${mini ? 'mini' : ''}`}>
      <aside className="side">
        <div className="side-top"><Logo /><SideToggle initial={mini} /></div>
        <div className="org-box">
          <div className="org-name">{org.name}</div>
          <div className="hint">{me.full_name} · {PICK_LABEL[memberRole(me)]}</div>
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
          {role !== 'partner' && (
            <Link href="/profile#form" className="side-promo">
              <b>Get more leads</b>
              <span>Send your client form. Buyers pick budget and area in 1 minute.</span>
              <span className="side-promo-btn">Share my form →</span>
            </Link>
          )}
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
