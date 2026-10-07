-- ============================================================
-- Patch 012: tell the admins when a manager gives a lead to someone else.
-- Run once in Supabase → SQL Editor (after patch-011). Safe to run again.
-- ============================================================

create or replace function public.notify_admin_reassign() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_role text; v_by text; v_to text; v_from text; a record;
begin
  if v_actor is null or new.assigned_to is not distinct from old.assigned_to then return null; end if;
  if coalesce(current_setting('estatedesk.bulk', true), '') = 'on' then return null; end if;  -- bulk moves send one summary instead
  select role, full_name into v_role, v_by from public.members where org_id = new.org_id and user_id = v_actor and active;
  if v_role is distinct from 'manager' then return null; end if;
  select full_name into v_to from public.members where org_id = new.org_id and user_id = new.assigned_to;
  select full_name into v_from from public.members where org_id = new.org_id and user_id = old.assigned_to;
  for a in select user_id from public.members where org_id = new.org_id and active and role = 'owner' loop
    perform public.notify(new.org_id, a.user_id, 'reassign',
      coalesce(v_by, 'A manager') || ' gave ' || new.name || ' to ' || coalesce(v_to, 'nobody'),
      'Before: ' || coalesce(v_from, 'not assigned') || '.', '/leads/' || new.id);
  end loop;
  return null;
end $$;

drop trigger if exists leads_reassign_notify on public.leads;
create trigger leads_reassign_notify after update of assigned_to on public.leads
for each row execute function public.notify_admin_reassign();

-- Removing a person moves all their leads at once: send the admins ONE alert, not one per lead.
create or replace function public.deactivate_member(p_org uuid, p_user uuid, p_reassign_to uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(p_org); t text; n int := 0; v_by text; v_who text; v_to text; a record;
begin
  if r is null or r not in ('owner','manager') then raise exception 'Only an admin or a manager can remove people'; end if;
  if p_user = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  select role, full_name into t, v_who from public.members where org_id = p_org and user_id = p_user;
  if t is null then raise exception 'Person not found'; end if;
  if r = 'manager' and t in ('owner','manager') then raise exception 'Only an admin can remove an admin or a manager'; end if;
  if p_reassign_to is not null and not exists (
    select 1 from public.members where org_id = p_org and user_id = p_reassign_to and active and user_id <> p_user and role in ('owner','manager','agent')
  ) then raise exception 'Pick an active team member to take over the leads'; end if;
  update public.members set active = false, deactivated_at = now() where org_id = p_org and user_id = p_user;
  perform set_config('estatedesk.bulk', 'on', true);
  update public.leads set assigned_to = p_reassign_to
    where org_id = p_org and assigned_to = p_user and stage not in ('booked','lost');
  get diagnostics n = row_count;
  perform set_config('estatedesk.bulk', 'off', true);
  if r = 'manager' and n > 0 then
    select full_name into v_by from public.members where org_id = p_org and user_id = auth.uid();
    select full_name into v_to from public.members where org_id = p_org and user_id = p_reassign_to;
    for a in select user_id from public.members where org_id = p_org and active and role = 'owner' loop
      perform public.notify(p_org, a.user_id, 'reassign', coalesce(v_by, 'A manager') || ' removed ' || coalesce(v_who, 'a person') || ' and moved ' || n || ' leads',
        'All their open leads now go to ' || coalesce(v_to, 'nobody') || '.', '/team');
    end loop;
  end if;
  return n;
end $$;

select 'patch-012 done' as result;
