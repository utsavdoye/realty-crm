-- ============================================================
-- Patch 005 — in-app alerts, auto-reassign, second chance for lost leads, Excel import
-- Run once in Supabase → SQL Editor (after patch-004). Safe to run again.
-- For auto-reassign, first switch on "pg_cron":
--   Supabase → Database → Extensions → search "pg_cron" → enable.
-- ============================================================

-- ---------- Settings and tracking columns ----------
alter table public.organizations add column if not exists reassign_minutes int check (reassign_minutes is null or reassign_minutes between 5 and 240);
alter table public.leads add column if not exists assigned_at timestamptz;
alter table public.leads add column if not exists reassign_count int not null default 0;
alter table public.leads add column if not exists recycle_at timestamptz;
alter table public.leads add column if not exists recycle_step int not null default 0;

-- ---------- Lead rules: let the system's own jobs move leads ----------
create or replace function public.leads_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(new.org_id);
begin
  new.phone := public.normalize_phone(new.phone);
  if length(new.phone) < 10 then
    raise exception 'Enter a valid 10-digit mobile number';
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
    if auth.uid() is not null and coalesce(current_setting('estatedesk.system', true), '') <> 'on'
       and coalesce(r, '') not in ('owner','manager') then
      if new.assigned_to is distinct from old.assigned_to
         or new.partner_id is distinct from old.partner_id
         or new.org_id <> old.org_id then
        raise exception 'Only the owner or a manager can reassign leads';
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

-- ---------- In-app alerts ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, update on public.notifications to authenticated;

create or replace function public.notify(p_org uuid, p_user uuid, p_type text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (org_id, user_id, type, title, body, link)
  select p_org, p_user, p_type, p_title, p_body, p_link
  where p_user is not null and exists (select 1 from public.members where org_id = p_org and user_id = p_user and active)
$$;
revoke all on function public.notify(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- Remember when a lead was given to someone, and tell them (unless they did it themselves).
create or replace function public.leads_assign_track() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is distinct from (case when tg_op = 'INSERT' then null else old.assigned_to end) then
    new.assigned_at := case when new.assigned_to is null then null else now() end;
  end if;
  -- Lost leads come back for a second call after 30 days (not for wrong numbers or people who bought elsewhere).
  if new.stage = 'lost' and (tg_op = 'INSERT' or old.stage <> 'lost') then
    if coalesce(new.lost_reason, '') in ('Wrong number', 'Bought elsewhere') then
      new.recycle_at := null;
    else
      new.recycle_at := now() + interval '30 days';
      new.recycle_step := 1;
    end if;
  elsif new.stage <> 'lost' then
    new.recycle_at := null;
    new.recycle_step := 0;
  end if;
  return new;
end $$;
drop trigger if exists leads_assign_track_trg on public.leads;
create trigger leads_assign_track_trg before insert or update on public.leads
for each row execute function public.leads_assign_track();

create or replace function public.leads_assign_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
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
drop trigger if exists leads_assign_notify_trg on public.leads;
create trigger leads_assign_notify_trg after insert or update of assigned_to on public.leads
for each row execute function public.leads_assign_notify();

-- Existing assigned leads: start the clock now so nothing is reassigned by surprise.
update public.leads set assigned_at = coalesce(assigned_at, now()) where assigned_to is not null and assigned_at is null;

-- ---------- Auto-reassign: new leads not called within X minutes ----------
create or replace function public.next_assignee_except(p_org uuid, p_except uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.user_id from public.members m
  left join public.leads l on l.org_id = p_org and l.assigned_to = m.user_id and l.stage not in ('booked','lost')
  where m.org_id = p_org and m.active and m.role = 'agent' and m.user_id is distinct from p_except
  group by m.user_id
  order by count(l.id), min(m.user_id::text)
  limit 1
$$;
revoke all on function public.next_assignee_except(uuid, uuid) from public, anon, authenticated;

-- Runs every minute. Only between 9 AM and 8 PM India time. A lead moves at most twice.
create or replace function public.reassign_stale_leads() returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_to uuid; v_from_name text; n int := 0;
  v_hour int := extract(hour from (now() at time zone 'Asia/Kolkata'));
begin
  if v_hour < 9 or v_hour >= 20 then return 0; end if;
  perform set_config('estatedesk.system', 'on', true);
  for r in
    select l.id, l.org_id, l.assigned_to, l.name, o.reassign_minutes
    from public.leads l join public.organizations o on o.id = l.org_id
    where o.reassign_minutes is not null
      and (o.plan_status = 'active' or (o.plan_status = 'trial' and o.trial_ends_at > now()))
      and l.stage = 'new' and l.call_attempts = 0 and l.reassign_count < 2
      and l.assigned_to is not null
      and l.assigned_at < now() - make_interval(mins => o.reassign_minutes)
      and not exists (select 1 from public.activities a where a.lead_id = l.id and a.type in ('call','note','whatsapp') and a.created_at > l.assigned_at)
    limit 200
  loop
    v_to := public.next_assignee_except(r.org_id, r.assigned_to);
    continue when v_to is null;
    select full_name into v_from_name from public.members where org_id = r.org_id and user_id = r.assigned_to;
    update public.leads set reassign_count = reassign_count + 1, assigned_to = v_to where id = r.id;
    insert into public.activities (org_id, lead_id, type, body, by_user)
      values (r.org_id, r.id, 'assign', 'Moved automatically from ' || coalesce(v_from_name, 'previous agent') || ': not called within ' || r.reassign_minutes || ' minutes', null);
    perform public.notify(r.org_id, r.assigned_to, 'lead_taken', 'Lead moved: ' || r.name, 'It was not called within ' || r.reassign_minutes || ' minutes, so it went to the next agent.', null);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.reassign_stale_leads() from public, anon, authenticated;

create or replace function public.set_reassign_minutes(p_org uuid, p_minutes int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only the owner can change this'; end if;
  update public.organizations set reassign_minutes = p_minutes where id = p_org;
end $$;
revoke all on function public.set_reassign_minutes(uuid, int) from public, anon;
grant execute on function public.set_reassign_minutes(uuid, int) to authenticated;

-- Schedule it every minute, if pg_cron is switched on.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'estatedesk-reassign';
    perform cron.schedule('estatedesk-reassign', '* * * * *', 'select public.reassign_stale_leads()');
  else
    raise notice 'pg_cron is not enabled. Auto-reassign will not run until you enable it and run this file again.';
  end if;
end $$;

-- ---------- Second chance for lost leads ----------
-- Agent says "not now": try again in 30 days, up to 3 times.
create or replace function public.snooze_recycle(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  select * into l from public.leads where id = p_lead;
  if not found or not (public.is_manager(l.org_id) or l.assigned_to = auth.uid()) then raise exception 'Lead not found'; end if;
  update public.leads set
    recycle_step = recycle_step + 1,
    recycle_at = case when recycle_step >= 3 then null else now() + interval '30 days' end
  where id = p_lead;
end $$;
revoke all on function public.snooze_recycle(uuid) from public, anon;
grant execute on function public.snooze_recycle(uuid) to authenticated;

-- ---------- Excel / CSV import ----------
-- p_rows: [{name, phone, email, location, budget_min, budget_max, bhk, source, note}]
-- p_assign: '' = not assigned, 'auto' = share evenly, or a person's id
create or replace function public.import_leads(p_org uuid, p_rows jsonb, p_source text, p_assign text, p_project uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_phone text; v_id uuid; v_to uuid; added int := 0; updated int := 0; skipped int := 0;
begin
  if not public.is_manager(p_org) then raise exception 'Only the owner or a manager can import leads'; end if;
  if not public.org_ok(p_org) then raise exception 'Your plan has ended'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'Send at most 1000 rows at a time'; end if;
  if p_project is not null and not exists (select 1 from public.projects where id = p_project and org_id = p_org) then p_project := null; end if;
  if p_assign not in ('', 'auto') and not exists (
    select 1 from public.members where org_id = p_org and user_id = p_assign::uuid and active and role <> 'partner') then
    raise exception 'Pick an active team member';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_phone := public.normalize_phone(r->>'phone');
    if v_phone is null or length(v_phone) <> 10 or coalesce(trim(r->>'name'), '') = '' then skipped := skipped + 1; continue; end if;
    select id into v_id from public.leads where org_id = p_org and phone = v_phone;
    if found then
      insert into public.activities (org_id, lead_id, type, body, by_user)
        values (p_org, v_id, 'enquiry', 'Came again in an imported list' || coalesce(' (' || nullif(coalesce(r->>'source', p_source), '') || ')', '') || coalesce(': ' || nullif(r->>'note', ''), ''), auth.uid());
      updated := updated + 1;
      continue;
    end if;
    v_to := case when p_assign = 'auto' then public.next_assignee(p_org) when p_assign = '' then null else p_assign::uuid end;
    insert into public.leads (org_id, name, phone, email, location, budget_min, budget_max, bhk, source, project_id, assigned_to, next_follow_up)
      values (p_org, left(trim(r->>'name'), 120), v_phone, nullif(trim(r->>'email'), ''), nullif(trim(r->>'location'), ''),
              nullif(r->>'budget_min', '')::numeric, nullif(r->>'budget_max', '')::numeric, nullif(trim(r->>'bhk'), ''),
              coalesce(nullif(trim(r->>'source'), ''), nullif(p_source, ''), 'Other'), p_project, v_to, now())
      returning id into v_id;
    insert into public.activities (org_id, lead_id, type, body, by_user)
      values (p_org, v_id, 'created', 'Imported from a list' || coalesce(E'\n' || nullif(r->>'note', ''), ''), auth.uid());
    added := added + 1;
  end loop;
  return jsonb_build_object('added', added, 'updated', updated, 'skipped', skipped);
end $$;
revoke all on function public.import_leads(uuid, jsonb, text, text, uuid) from public, anon;
grant execute on function public.import_leads(uuid, jsonb, text, text, uuid) to authenticated;

create index if not exists leads_recycle_idx on public.leads(org_id, recycle_at) where recycle_at is not null;
