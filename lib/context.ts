import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/roles';

export const ORG_COOKIE = 'ed_org';

export type Org = {
  id: string;
  name: string;
  city: string | null;
  rera_no: string | null;
  plan_status: 'trial' | 'active' | 'suspended';
  trial_ends_at: string;
};

export type Membership = {
  org_id: string;
  role: Role;
  active: boolean;
  full_name: string;
  is_intern?: boolean | null;
  organizations: Org | null;
};

export const getContext = cache(async () => {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, memberships: [] as Membership[] };
  const { data } = await supabase
    .from('members')
    .select('*, organizations(id, name, city, rera_no, plan_status, trial_ends_at)')
    .eq('user_id', user.id);
  return { supabase, user, memberships: (data ?? []) as unknown as Membership[] };
});

export function orgUsable(o: Org | null) {
  if (!o) return false;
  if (o.plan_status === 'active') return true;
  return o.plan_status === 'trial' && new Date(o.trial_ends_at).getTime() > Date.now();
}

/**
 * Use at the top of every signed-in page. Sends people to the right screen
 * when they have no company, were removed, or the plan ended.
 */
export async function requireOrg(allowed?: Role[]) {
  const ctx = await getContext();
  if (!ctx.user) redirect('/login');
  const all = ctx.memberships;
  const active = all.filter((m) => m.active);
  if (!all.length) redirect('/onboarding');
  if (!active.length) redirect('/blocked?r=removed');

  const wanted = cookies().get(ORG_COOKIE)?.value;
  let current = active.find((m) => m.org_id === wanted);
  if (!current) {
    const removedHere = all.find((m) => m.org_id === wanted && !m.active);
    if (removedHere && active.length === 0) redirect('/blocked?r=removed');
    if (active.length > 1) redirect('/select-company');
    current = active[0];
  }
  const org = current.organizations!;
  if (!orgUsable(org)) redirect(`/blocked?r=${org.plan_status === 'suspended' ? 'suspended' : 'trial'}`);
  if (allowed && !allowed.includes(current.role)) redirect('/dashboard?denied=1');

  return {
    supabase: ctx.supabase,
    user: ctx.user,
    org,
    role: current.role,
    me: current,
    memberships: active,
  };
}
