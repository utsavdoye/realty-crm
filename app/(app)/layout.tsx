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
import { LangSwitch } from '@/components/Translator';
import { HindiAutoFill, InventoryAutoSync } from '@/components/InventorySheet';
import { WorkClock } from '@/components/WorkClock';
import { SideTips } from '@/components/SideTips';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // inventory sheet sync can take a few seconds

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, org, role, me, memberships, user } = await requireOrg();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [{ count: unread }, { data: o }, { data: wd }] = await Promise.all([
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null),
    supabase.from('organizations').select('form_token, website_url').eq('id', org.id).maybeSingle(),
    role !== 'partner' ? supabase.from('work_days').select('id, login_at, logout_at, work_breaks(end_at)').eq('org_id', org.id).eq('user_id', user.id).eq('day', today).maybeSingle() : Promise.resolve({ data: null }), // patch-045
  ]);
  const work = wd as { login_at: string; logout_at: string | null; work_breaks: { end_at: string | null }[] } | null;
  const mini = cookies().get('ed_side')?.value === 'mini';
  // With a client website, the form opens there (same look as the website); otherwise on the CRM.
  const web = /^https:\/\//.test(o?.website_url ?? '') ? o!.website_url!.replace(/\/+$/, '') : '';
  const formLink = o?.form_token ? (web ? `${web}/find-home.html?f=${o.form_token}&by=${user.id}` : `${siteUrl()}/r/${o.form_token}?by=${user.id}`) : '';
  return (
    <div className={`app ${mini ? 'mini' : ''}`}>
      <aside className="side">
        <SideTips />
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
      <main className="main"><div className="langbar">{role !== 'partner' && <WorkClock since={work?.login_at ?? null} ended={Boolean(work?.logout_at)} onBreak={Boolean(work?.work_breaks?.some((b) => !b.end_at))} />}<LangSwitch /></div>{children}</main>
      <NavLinks role={role} mobile />
      {role !== 'partner' && <InventoryAutoSync />}
      {(role === 'owner' || role === 'manager') && <HindiAutoFill />}
      {role !== 'partner' && <AskHelper />}
      {role !== 'partner' && <CallReturn voice={Boolean(process.env.GEMINI_API_KEY)} />}
    </div>
  );
}
