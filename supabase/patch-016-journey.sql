-- patch-016: the client journey.
-- Each step (first call → project presentation → site visit → follow-up → payment) is done by the person the admin chose,
-- the lead moves to the next person by itself, and every client gets a checklist and a full history of who said what.
-- Managers see only their own team's clients. Only the admin hands leads to people. Payment details stay admin-only.
-- Safe to run more than once.

-- ---------- 1. Teams: who reports to which manager ----------
alter table public.members add column if not exists manager_id uuid references auth.users(id) on delete set null;

create or replace function public.set_reports_to(p_org uuid, p_user uuid, p_manager uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can set teams'; end if;
  if p_manager is not null and not exists (select 1 from public.members where org_id = p_org and user_id = p_manager and role = 'manager' and active) then
    raise exception 'Pick an active manager';
  end if;
  if p_manager = p_user then raise exception 'A person cannot report to themselves'; end if;
  update public.members set manager_id = p_manager where org_id = p_org and user_id = p_user;
  if not found then raise exception 'Person not found'; end if;
end $$;
revoke all on function public.set_reports_to(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_reports_to(uuid, uuid, uuid) to authenticated;

-- Everyone who has ever handled a lead (so a manager still sees a client their team worked on after it moved on).
create table if not exists public.lead_people (
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  first_at timestamptz not null default now(),
  primary key (lead_id, user_id)
);
create index if not exists lead_people_user on public.lead_people(user_id);
alter table public.lead_people enable row level security;
revoke all on public.lead_people from anon, authenticated;

create or replace function public.lead_people_track() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null then
    insert into public.lead_people (lead_id, user_id) values (new.id, new.assigned_to) on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists lead_people_track on public.leads;
create trigger lead_people_track after insert or update of assigned_to on public.leads
for each row execute function public.lead_people_track();

insert into public.lead_people (lead_id, user_id)
  select id, assigned_to from public.leads where assigned_to is not null on conflict do nothing;
insert into public.lead_people (lead_id, user_id, first_at)
  select a.lead_id, a.by_user, min(a.created_at) from public.activities a
  join public.leads l on l.id = a.lead_id
  join public.members m on m.org_id = l.org_id and m.user_id = a.by_user
  where a.by_user is not null group by a.lead_id, a.by_user
  on conflict do nothing;

-- Who can see a client:
--   admin: everyone · manager: own + their team's clients (until a manager has a team, they still see all, like before)
--   employee / intern: the clients given to them · outside partner: the clients they brought
create or replace function public.lead_visible(p_org uuid, p_assigned uuid, p_partner uuid, p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case public.my_role(p_org)
    when 'owner' then true
    when 'manager' then
      not exists (select 1 from public.members t where t.org_id = p_org and t.manager_id = auth.uid() and t.active)
      or p_assigned = auth.uid()
      or exists (select 1 from public.members t where t.org_id = p_org and t.manager_id = auth.uid() and t.user_id = p_assigned)
      or exists (select 1 from public.lead_people lp join public.members t on t.org_id = p_org and t.user_id = lp.user_id
                 where lp.lead_id = p_lead and (lp.user_id = auth.uid() or t.manager_id = auth.uid()))
    when 'agent' then p_assigned = auth.uid()
    when 'partner' then p_partner = auth.uid()
    else false end, false)
$$;
revoke all on function public.lead_visible(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.lead_visible(uuid, uuid, uuid, uuid) to authenticated;

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select using (
  public.can_use(org_id) and public.lead_visible(org_id, assigned_to, partner_id, id));
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update
  using (public.can_use(org_id) and coalesce(public.my_role(org_id), '') <> 'partner' and public.lead_visible(org_id, assigned_to, partner_id, id))
  with check (public.can_use(org_id) and (public.is_manager(org_id) or assigned_to = auth.uid()));
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete using (
  public.can_use(org_id) and public.is_manager(org_id) and public.lead_visible(org_id, assigned_to, partner_id, id));

-- ---------- 2. Only the admin hands leads to people ----------
create or replace function public.leads_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(new.org_id);
        v_system boolean := coalesce(current_setting('estatedesk.system', true), '') = 'on';
        v_bulk boolean := coalesce(current_setting('estatedesk.bulk', true), '') = 'on';
begin
  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    new.phone := public.normalize_phone(new.phone);
    if not public.valid_phone(new.phone) then
      raise exception 'Enter a valid mobile number: 10 digits for India, or + and country code for other countries (e.g. +971 50 123 4567)';
    end if;
  end if;
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) and not exists (
    select 1 from public.members m where m.org_id = new.org_id and m.user_id = new.assigned_to and m.active and m.role in ('owner','manager','agent')
  ) then
    raise exception 'That person is not an active member of this company';
  end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    if r = 'agent' then
      new.assigned_to := coalesce(new.assigned_to, auth.uid());
      if new.assigned_to <> auth.uid() then
        raise exception 'Agents can only add leads for themselves';
      end if;
      new.partner_id := null;
    elsif r = 'partner' then
      new.partner_id := auth.uid();
      new.assigned_to := null;
    end if;
  else
    if auth.uid() is not null and not v_system then
      if coalesce(r, '') not in ('owner','manager') then
        if new.assigned_to is distinct from old.assigned_to
           or new.partner_id is distinct from old.partner_id
           or new.org_id <> old.org_id
           or new.created_by is distinct from old.created_by then
          raise exception 'Only the admin can hand leads to people';
        end if;
      elsif r = 'manager' and not v_bulk and new.assigned_to is distinct from old.assigned_to then
        raise exception 'Only the admin can hand leads to people';
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

-- ---------- 3. Steps and who does each step ----------
alter table public.activities drop constraint if exists activities_type_check;
alter table public.activities add constraint activities_type_check
  check (type in ('created','note','call','whatsapp','stage','visit','enquiry','assign','step'));

create or replace function public.step_label(s text) returns text language sql immutable as $$
  select case s when 'received' then 'Lead received' when 'call' then 'First call' when 'presentation' then 'Project presentation'
    when 'visit' then 'Site visit' when 'followup' then 'Follow-up' when 'payment' then 'Payment' else s end
$$;

create table if not exists public.step_teams (
  org_id uuid not null references public.organizations(id) on delete cascade,
  step text not null check (step in ('call','presentation','visit','followup')),
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (org_id, step, user_id)
);
alter table public.step_teams enable row level security;
drop policy if exists st_select on public.step_teams;
create policy st_select on public.step_teams for select using (public.is_member(org_id));
revoke insert, update, delete on public.step_teams from anon, authenticated;
grant select on public.step_teams to authenticated;

-- Admin picks who does a step (replaces the list for that step).
create or replace function public.set_step_team(p_org uuid, p_step text, p_users uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can choose who does each step'; end if;
  if p_step not in ('call','presentation','visit','followup') then raise exception 'Unknown step'; end if;
  delete from public.step_teams where org_id = p_org and step = p_step;
  insert into public.step_teams (org_id, step, user_id)
    select p_org, p_step, m.user_id from public.members m
    where m.org_id = p_org and m.active and m.role in ('owner','manager','agent') and m.user_id = any(coalesce(p_users, '{}'))
    on conflict do nothing;
end $$;
revoke all on function public.set_step_team(uuid, text, uuid[]) from public, anon;
grant execute on function public.set_step_team(uuid, text, uuid[]) to authenticated;

create table if not exists public.lead_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  step text not null check (step in ('received','call','presentation','visit','followup','payment')),
  done_at timestamptz not null default now(),
  done_by uuid references auth.users(id) on delete set null,
  summary text,
  details jsonb not null default '{}'::jsonb,
  unique (lead_id, step)
);
create index if not exists lead_steps_lead on public.lead_steps(lead_id);
alter table public.lead_steps enable row level security;
drop policy if exists ls_select on public.lead_steps;
-- follows the lead; the payment step is for the admin only
create policy ls_select on public.lead_steps for select using (
  exists (select 1 from public.leads l where l.id = lead_id)
  and (step <> 'payment' or public.my_role(org_id) = 'owner'));
revoke insert, update, delete on public.lead_steps from anon, authenticated;
grant select on public.lead_steps to authenticated;

-- New leads go to the "first call" people when the admin has chosen them.
create or replace function public.next_assignee(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  with callers as (
    select st.user_id, m.role from public.step_teams st
    join public.members m on m.org_id = st.org_id and m.user_id = st.user_id and m.active
    where st.org_id = p_org and st.step = 'call'
  ), pool as (
    select user_id, role from callers
    union all
    select m.user_id, m.role from public.members m
    where m.org_id = p_org and m.active and m.role in ('agent','manager','owner') and not exists (select 1 from callers)
  ), pick as (
    select * from pool where role = 'agent' or exists (select 1 from callers)
    union all
    select * from pool where not exists (select 1 from callers) and not exists (select 1 from pool where role = 'agent')
  )
  select p.user_id from pick p
  left join public.leads l on l.org_id = p_org and l.assigned_to = p.user_id and l.stage not in ('booked','lost')
  group by p.user_id
  order by count(l.id), min(p.user_id::text)
  limit 1
$$;
revoke all on function public.next_assignee(uuid) from public, anon, authenticated;

-- Marks a step done (once). Moves the stage forward, never back. Internal.
create or replace function public.mark_step(p_lead uuid, p_step text, p_by uuid, p_summary text, p_details jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype; v_stage text;
begin
  select * into l from public.leads where id = p_lead;
  if not found then return false; end if;
  if exists (select 1 from public.lead_steps where lead_id = p_lead and step = p_step) then
    if coalesce(trim(p_summary), '') <> '' then
      update public.lead_steps set summary = concat_ws(E'\n', summary, left(trim(p_summary), 2000)), details = details || coalesce(p_details, '{}'::jsonb)
      where lead_id = p_lead and step = p_step;
    end if;
    return false;
  end if;
  insert into public.lead_steps (org_id, lead_id, step, done_by, summary, details)
    values (l.org_id, p_lead, p_step, p_by, nullif(left(trim(coalesce(p_summary, '')), 2000), ''), coalesce(p_details, '{}'::jsonb));
  if p_step <> 'received' then
    insert into public.activities (org_id, lead_id, type, body, by_user)
      values (l.org_id, p_lead, 'step', '✓ ' || public.step_label(p_step) || ' done' || coalesce(': ' || nullif(left(trim(coalesce(p_summary, '')), 600), ''), ''), p_by);
  end if;
  v_stage := case p_step when 'call' then 'contacted' when 'presentation' then 'qualified' when 'visit' then 'visited'
                         when 'followup' then 'negotiation' when 'payment' then 'token' end;
  if v_stage is not null and l.stage <> 'lost' and coalesce(public.stage_index(l.stage), 0) < public.stage_index(v_stage) then
    perform set_config('estatedesk.system', 'on', true);
    update public.leads set stage = v_stage where id = p_lead;
    perform set_config('estatedesk.system', 'off', true);
  end if;
  return true;
end $$;
revoke all on function public.mark_step(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

-- Gives the lead to the person for the next step (fewest open clients first). Internal.
create or replace function public.journey_handoff(p_lead uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype; v_next text; v_to uuid; v_name text; v_by text; a record;
begin
  select * into l from public.leads where id = p_lead;
  if not found or l.stage in ('booked', 'lost') then return null; end if;
  select t.s into v_next from unnest(array['call','presentation','visit','followup']) with ordinality as t(s, i)
    where not exists (select 1 from public.lead_steps x where x.lead_id = p_lead and x.step = t.s) order by t.i limit 1;
  if v_next is null then return null; end if;
  if not exists (select 1 from public.step_teams where org_id = l.org_id and step = v_next) then
    -- the admin has not chosen anyone for this step: tell them once, keep the lead where it is
    if exists (select 1 from public.step_teams where org_id = l.org_id) then
      for a in select user_id from public.members where org_id = l.org_id and active and role = 'owner' loop
        perform public.notify(l.org_id, a.user_id, 'handoff', l.name || ' is ready for ' || public.step_label(v_next),
          'Nobody is chosen for this step yet (Team → Who does each step). Hand it over yourself.', '/leads/' || l.id);
      end loop;
    end if;
    return null;
  end if;
  if exists (select 1 from public.step_teams st join public.members m on m.org_id = st.org_id and m.user_id = st.user_id and m.active
             where st.org_id = l.org_id and st.step = v_next and st.user_id = l.assigned_to) then
    return l.assigned_to;  -- the same person also does the next step
  end if;
  select st.user_id into v_to from public.step_teams st
    join public.members m on m.org_id = st.org_id and m.user_id = st.user_id and m.active
    left join public.leads x on x.org_id = st.org_id and x.assigned_to = st.user_id and x.stage not in ('booked','lost')
    where st.org_id = l.org_id and st.step = v_next
    group by st.user_id order by count(x.id), min(st.user_id::text) limit 1;
  if v_to is null then return null; end if;
  perform set_config('estatedesk.system', 'on', true);
  perform set_config('estatedesk.handoff', 'on', true);
  perform set_config('estatedesk.bulk', 'on', true);
  update public.leads set assigned_to = v_to, next_follow_up = least(coalesce(next_follow_up, now() + interval '2 hours'), now() + interval '2 hours') where id = p_lead;
  perform set_config('estatedesk.system', 'off', true);
  perform set_config('estatedesk.handoff', 'off', true);
  perform set_config('estatedesk.bulk', 'off', true);
  select full_name into v_name from public.members where org_id = l.org_id and user_id = v_to;
  select full_name into v_by from public.members where org_id = l.org_id and user_id = auth.uid();
  insert into public.activities (org_id, lead_id, type, body, by_user)
    values (l.org_id, p_lead, 'assign', 'Handed to ' || coalesce(v_name, 'next person') || ' for ' || public.step_label(v_next), auth.uid());
  perform public.notify(l.org_id, v_to, 'handoff', l.name || ' is yours for ' || public.step_label(v_next),
    coalesce(v_by, 'The team') || coalesce(': ' || nullif(left(trim(coalesce(p_note, '')), 180), ''), ' finished the last step.') , '/leads/' || l.id);
  return v_to;
end $$;
revoke all on function public.journey_handoff(uuid, text) from public, anon, authenticated;

-- The usual "new lead given to you" alert is skipped during a hand-over (it sends its own, with the last notes).
create or replace function public.leads_assign_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('estatedesk.handoff', true), '') = 'on' then return new; end if;
  if new.assigned_to is not null
     and new.assigned_to is distinct from (case when tg_op = 'INSERT' then null else old.assigned_to end)
     and new.assigned_to is distinct from auth.uid() then
    perform public.notify(new.org_id, new.assigned_to, 'lead_assigned',
      'New lead: ' || new.name,
      concat_ws(' · ', new.phone, new.source, case when new.reassign_count > 0 then 'moved to you because it was not called in time' end),
      '/leads/' || new.id);
  end if;
  return new;
end $$;

-- The person handling the client finishes their step. The admin (or the team's manager) can do it for them.
create or replace function public.complete_step(p_lead uuid, p_step text, p_summary text, p_details jsonb, p_interest text, p_project uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype; r text; v_new boolean; v_to uuid;
begin
  select * into l from public.leads where id = p_lead;
  if not found then raise exception 'Lead not found'; end if;
  r := public.my_role(l.org_id);
  if r is null or not public.can_use(l.org_id) or not public.lead_visible(l.org_id, l.assigned_to, l.partner_id, l.id) then raise exception 'Lead not found'; end if;
  if r = 'partner' then raise exception 'Only the team can do this'; end if;
  if r = 'agent' and l.assigned_to is distinct from auth.uid() then raise exception 'This client is with someone else now'; end if;
  if p_step not in ('call','presentation','visit','followup','payment') then raise exception 'Unknown step'; end if;
  if p_step = 'payment' and r <> 'owner' then raise exception 'Only the admin handles payments'; end if;
  if char_length(trim(coalesce(p_summary, ''))) < 3 then raise exception 'Write what was discussed (a few words is fine)'; end if;
  if p_interest is not null and p_interest not in ('hot','warm','cold') then raise exception 'Pick how interested they are'; end if;
  if p_project is not null and not exists (select 1 from public.projects where id = p_project and org_id = l.org_id) then raise exception 'Project not found'; end if;

  if p_interest is not null or p_project is not null then
    update public.leads set score = coalesce(p_interest, score), project_id = coalesce(p_project, project_id) where id = p_lead;
  end if;
  v_new := public.mark_step(p_lead, p_step, auth.uid(), p_summary, p_details);
  if v_new and p_step <> 'payment' then v_to := public.journey_handoff(p_lead, p_summary); end if;
  return jsonb_build_object('ok', true, 'handed_to', (select full_name from public.members where org_id = l.org_id and user_id = v_to and v_to is distinct from auth.uid()));
end $$;
revoke all on function public.complete_step(uuid, text, text, jsonb, text, uuid) from public, anon;
grant execute on function public.complete_step(uuid, text, text, jsonb, text, uuid) to authenticated;

-- Admin can undo a wrong tick (not "lead received").
create or replace function public.undo_step(p_lead uuid, p_step text)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  select * into l from public.leads where id = p_lead;
  if not found or public.my_role(l.org_id) is distinct from 'owner' then raise exception 'Only an admin can undo a step'; end if;
  if p_step = 'received' then raise exception 'This one cannot be undone'; end if;
  delete from public.lead_steps where lead_id = p_lead and step = p_step;
  insert into public.activities (org_id, lead_id, type, body, by_user) values (l.org_id, p_lead, 'step', '↺ ' || public.step_label(p_step) || ' marked as not done', auth.uid());
end $$;
revoke all on function public.undo_step(uuid, text) from public, anon;
grant execute on function public.undo_step(uuid, text) to authenticated;

-- ---------- 4. Ticks that happen by themselves ----------
-- Lead received
create or replace function public.lead_received_step() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.lead_steps (org_id, lead_id, step, done_at, done_by, summary)
    values (new.org_id, new.id, 'received', new.created_at, new.created_by, 'From ' || coalesce(new.source, 'unknown source'))
    on conflict do nothing;
  return null;
end $$;
drop trigger if exists lead_received_step on public.leads;
create trigger lead_received_step after insert on public.leads for each row execute function public.lead_received_step();

-- Site visit marked "came and saw the site" → visit step done, then on to follow-up.
create or replace function public.visit_step() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_proj text; v_note text;
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    select name into v_proj from public.projects where id = new.project_id;
    v_note := concat_ws(' · ', 'Saw ' || v_proj, nullif(trim(coalesce(new.feedback, '')), ''));
    if public.mark_step(new.lead_id, 'visit', coalesce(new.agent_id, auth.uid()), nullif(v_note, ''), jsonb_build_object('project', v_proj)) then
      perform public.journey_handoff(new.lead_id, v_note);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists visit_step on public.visits;
create trigger visit_step after insert or update of status on public.visits for each row execute function public.visit_step();

-- Money received against a client's deal → payment step done (admin-only).
create or replace function public.payment_step() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  if new.direction = 'in' and new.deal_id is not null then
    select lead_id into v_lead from public.deals where id = new.deal_id;
    if v_lead is not null then
      perform public.mark_step(v_lead, 'payment', coalesce(new.created_by, auth.uid()), 'Received ₹' || to_char(new.amount, 'FM99,99,99,99,990'), '{}'::jsonb);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists payment_step on public.money_entries;
create trigger payment_step after insert on public.money_entries for each row execute function public.payment_step();

-- Buyer instalment marked paid → also counts as payment.
create or replace function public.instalment_step() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  if coalesce(new.paid_amount, 0) > 0 and (tg_op = 'INSERT' or coalesce(old.paid_amount, 0) = 0) then
    select lead_id into v_lead from public.deals where id = new.deal_id;
    if v_lead is not null then
      perform public.mark_step(v_lead, 'payment', auth.uid(), new.label || ': ₹' || to_char(new.paid_amount, 'FM99,99,99,99,990') || ' paid by the buyer', '{}'::jsonb);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists instalment_step on public.deal_installments;
create trigger instalment_step after insert or update of paid_amount on public.deal_installments for each row execute function public.instalment_step();

-- ---------- 5. Fill in what already happened ----------
insert into public.lead_steps (org_id, lead_id, step, done_at, done_by, summary)
  select org_id, id, 'received', created_at, created_by, 'From ' || coalesce(source, 'unknown source') from public.leads
  on conflict do nothing;
insert into public.lead_steps (org_id, lead_id, step, done_at, done_by, summary)
  select distinct on (v.lead_id) v.org_id, v.lead_id, 'visit', v.at, v.agent_id, nullif(trim(coalesce(v.feedback, '')), '')
  from public.visits v where v.status = 'done' order by v.lead_id, v.at
  on conflict do nothing;
insert into public.lead_steps (org_id, lead_id, step, done_at, done_by, summary)
  select distinct on (d.lead_id) d.org_id, d.lead_id, 'payment', e.created_at, e.created_by, 'Received ₹' || to_char(e.amount, 'FM99,99,99,99,990')
  from public.money_entries e join public.deals d on d.id = e.deal_id
  where e.direction = 'in' and d.lead_id is not null order by d.lead_id, e.created_at
  on conflict do nothing;

select 'patch-016 done';
