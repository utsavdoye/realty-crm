import type { ReactNode } from 'react';
import { requireOrg } from '@/lib/context';
import { Logo } from '@/components/AuthShell';
import { NavLinks } from '@/components/NavLinks';
import { SignOutButtons } from '@/components/SignOutButtons';
import { switchOrg } from '@/app/actions';
import { PICK_LABEL, memberRole, siteUrl } from '@/lib/roles';
import { SharePop } from '@/components/SharePop';
import { CallReturn } from '@/components/CallButton';
import { Bell } from '@/components/Bell';
import { SideToggle } from '@/components/SideToggle';
import { AskHelper } from '@/components/AskHelper';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, org, role, me, memberships, user } = await requireOrg();
  const [{ count: unread }, { data: o }] = await Promise.all([
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null),
    supabase.from('organizations').select('form_token').eq('id', org.id).maybeSingle(),
  ]);
  const mini = cookies().get('ed_side')?.value === 'mini';
  const formLink = o?.form_token ? `${siteUrl()}/r/${o.form_token}?by=${user.id}` : '';
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
          {role !== 'partner' && formLink && (
            <div className="side-promo">
              <b>Get more leads</b>
              <span>Send your client form. Buyers pick budget and area in 1 minute.</span>
              <SharePop url={formLink} className="side-promo-btn" title="Your client form" text="Tell me what home you are looking for. It takes 1 minute, and I will send you options that fit your budget:">Share my form →</SharePop>
            </div>
          )}
          <SignOutButtons compact />
        </div>
      </aside>
      <Bell userId={user.id} initial={unread ?? 0} floating />
      <main className="main">{children}</main>
      <NavLinks role={role} mobile />
      {role !== 'partner' && <AskHelper />}
      {role !== 'partner' && <CallReturn voice={Boolean(process.env.GEMINI_API_KEY)} />}
    </div>
  );
}
