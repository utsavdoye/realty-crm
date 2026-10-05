-- ============================================================
-- Patch 004 — full CRM screens (stages, call log, follow-ups, visits)
-- Run once in Supabase → SQL Editor (after patch-003).
-- ============================================================

alter table public.leads add column if not exists call_attempts int not null default 0;
alter table public.leads add column if not exists last_activity_at timestamptz;
alter table public.visits add column if not exists interest text check (interest in ('hot','warm','cold'));

-- Only check the assigned person when the assignment changes (old booked leads may belong to people who left).
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
    if auth.uid() is not null and coalesce(r, '') not in ('owner','manager') then
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


create or replace function public.stage_index(s text) returns int
language sql immutable as $$
  select array_position(array['new','contacted','qualified','visit','visited','negotiation','token','booked'], s) - 1
$$;

-- Keeps stage rules in the database: lost needs a reason, furthest stage is remembered, booking date is saved.
create or replace function public.leads_stage_rules() returns trigger
language plpgsql as $$
begin
  if new.stage = 'lost' then
    if coalesce(trim(new.lost_reason), '') = '' then
      raise exception 'Pick a reason before marking the lead as lost';
    end if;
    new.next_follow_up := null;
  else
    new.lost_reason := null;
    new.max_stage := greatest(coalesce(new.max_stage, 0), coalesce(public.stage_index(new.stage), 0));
  end if;
  if new.stage = 'booked' and new.booked_at is null then new.booked_at := now(); end if;
  return new;
end $$;

drop trigger if exists leads_stage_rules_trg on public.leads;
create trigger leads_stage_rules_trg before insert or update on public.leads
for each row execute function public.leads_stage_rules();

-- Remember when anyone last did something on a lead.
create or replace function public.touch_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.leads set last_activity_at = new.created_at where id = new.lead_id;
  return new;
end $$;
drop trigger if exists activities_touch_trg on public.activities;
create trigger activities_touch_trg after insert on public.activities
for each row execute function public.touch_lead();

-- Agents may also edit visits they lead; nobody but managers deletes them (already set in schema).
create index if not exists visits_org_at_idx on public.visits(org_id, at);
create index if not exists leads_org_stage_idx on public.leads(org_id, stage);

-- Owner/manager: who should get the next lead (fewest open leads).
create or replace function public.pick_assignee(p_org uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager(p_org) then return null; end if;
  return public.next_assignee(p_org);
end $$;
revoke all on function public.pick_assignee(uuid) from public, anon;
grant execute on function public.pick_assignee(uuid) to authenticated;
