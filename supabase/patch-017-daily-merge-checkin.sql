-- patch-017: morning message, merging duplicate clients, site-visit check-in with GPS. Safe to run more than once.

-- ---------- 1. Morning message (in-app alert at 8:45 AM India time) ----------
create or replace function public.morning_digest() returns int
language plpgsql security definer set search_path = public as $$
declare m record; v_calls int; v_over int; v_vis int; v_new int; n int := 0;
  v_end timestamptz := ((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata';
  v_start timestamptz := ((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata';
begin
  for m in
    select mm.org_id, mm.user_id, mm.full_name, mm.role from public.members mm
    where mm.active and mm.role <> 'partner' and public.org_ok(mm.org_id)
  loop
    -- my clients; for a manager also the team's; for the admin everyone's
    select count(*) filter (where l.next_follow_up < now()), count(*) filter (where l.next_follow_up < v_end),
           count(*) filter (where l.call_attempts = 0)
      into v_over, v_calls, v_new
    from public.leads l
    where l.org_id = m.org_id and l.stage not in ('booked','lost')
      and (m.role = 'owner' or l.assigned_to = m.user_id
           or (m.role = 'manager' and l.assigned_to in (select t.user_id from public.members t where t.org_id = m.org_id and t.manager_id = m.user_id)));
    select count(*) into v_vis from public.visits v
    where v.org_id = m.org_id and v.status = 'scheduled' and v.at >= v_start and v.at < v_end
      and (m.role = 'owner' or v.agent_id = m.user_id
           or (m.role = 'manager' and v.agent_id in (select t.user_id from public.members t where t.org_id = m.org_id and t.manager_id = m.user_id)));
    if v_calls + v_vis + v_new = 0 then continue; end if;
    -- once a day per person
    if exists (select 1 from public.notifications where user_id = m.user_id and org_id = m.org_id and type = 'morning' and created_at >= v_start) then continue; end if;
    perform public.notify(m.org_id, m.user_id, 'morning',
      'Good morning ' || split_part(coalesce(m.full_name, ''), ' ', 1) || '! Today: ' ||
        v_calls || ' call' || case when v_calls = 1 then '' else 's' end ||
        case when v_over > 0 then ' (' || v_over || ' overdue)' else '' end ||
        case when v_vis > 0 then ', ' || v_vis || ' site visit' || case when v_vis = 1 then '' else 's' end else '' end,
      case when v_new > 0 then v_new || ' new client' || case when v_new = 1 then '' else 's' end || ' not called yet. ' else '' end ||
        case when m.role = 'owner' then 'For the whole company.' when m.role = 'manager' then 'You and your team.' else 'Open "Do now" to start.' end,
      '/dashboard');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.morning_digest() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'estatedesk-morning';
    perform cron.schedule('estatedesk-morning', '15 3 * * *', 'select public.morning_digest()');  -- 03:15 UTC = 8:45 AM India
  else
    raise notice 'pg_cron is not enabled. Turn it on (Database → Extensions → pg_cron) and run this file again for the morning message.';
  end if;
end $$;

-- ---------- 2. Merging duplicate clients ----------
alter table public.leads add column if not exists other_phones text[] not null default '{}';

create table if not exists public.dup_ignored (
  org_id uuid not null references public.organizations(id) on delete cascade,
  a uuid not null, b uuid not null,
  primary key (a, b)
);
alter table public.dup_ignored enable row level security;
revoke all on public.dup_ignored from anon, authenticated;

-- Possible duplicates: same email, or same full name (two words or more). The admin decides.
create or replace function public.find_duplicates(p_org uuid)
returns table (a uuid, b uuid, reason text) language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can merge clients'; end if;
  return query
  with l as (
    select id, created_at, lower(trim(email)) as em,
           regexp_replace(lower(trim(name)), '\s+', ' ', 'g') as nm
    from public.leads where org_id = p_org
  ), pairs as (
    select x.id as a, y.id as b, 'Same email' as reason, greatest(x.created_at, y.created_at) as t from l x join l y on x.em = y.em and x.em <> '' and x.id < y.id
    union all
    select x.id, y.id, 'Same name', greatest(x.created_at, y.created_at) from l x join l y on x.nm = y.nm and x.nm like '% %' and char_length(x.nm) >= 5 and x.id < y.id
  ), one as (
    select distinct on (p.a, p.b) p.a, p.b, p.reason, p.t from pairs p
    where not exists (select 1 from public.dup_ignored d where d.a = p.a and d.b = p.b)
    order by p.a, p.b, p.reason desc
  )
  select one.a, one.b, one.reason from one order by one.t desc limit 200;  -- newest first
end $$;
revoke all on function public.find_duplicates(uuid) from public, anon;
grant execute on function public.find_duplicates(uuid) to authenticated;

create or replace function public.ignore_duplicate(p_a uuid, p_b uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.leads where id = p_a;
  if v_org is null or public.my_role(v_org) is distinct from 'owner' then raise exception 'Only an admin can do this'; end if;
  insert into public.dup_ignored (org_id, a, b) values (v_org, least(p_a, p_b), greatest(p_a, p_b)) on conflict do nothing;
end $$;
revoke all on function public.ignore_duplicate(uuid, uuid) from public, anon;
grant execute on function public.ignore_duplicate(uuid, uuid) to authenticated;

-- Keep one client, move everything from the other into it, then remove the other.
create or replace function public.merge_leads(p_keep uuid, p_drop uuid)
returns void language plpgsql security definer set search_path = public as $$
declare k public.leads%rowtype; d public.leads%rowtype;
begin
  if p_keep = p_drop then raise exception 'Pick two different clients'; end if;
  select * into k from public.leads where id = p_keep for update;
  select * into d from public.leads where id = p_drop for update;
  if k.id is null or d.id is null or k.org_id <> d.org_id then raise exception 'Client not found'; end if;
  if public.my_role(k.org_id) is distinct from 'owner' then raise exception 'Only an admin can merge clients'; end if;

  perform set_config('estatedesk.system', 'on', true);
  update public.leads set
    email = coalesce(email, d.email), dob = coalesce(dob, d.dob),
    budget_min = coalesce(budget_min, d.budget_min), budget_max = coalesce(budget_max, d.budget_max),
    bhk = coalesce(bhk, d.bhk), property_type = coalesce(property_type, d.property_type), location = coalesce(location, d.location),
    purpose = coalesce(purpose, d.purpose), preferred_slot = coalesce(preferred_slot, d.preferred_slot),
    project_id = coalesce(project_id, d.project_id), source = coalesce(source, d.source),
    assigned_to = coalesce(assigned_to, d.assigned_to),
    score = case when 'hot' in (score, d.score) then 'hot' when 'warm' in (score, d.score) then 'warm' else 'cold' end,
    call_attempts = call_attempts + d.call_attempts,
    next_follow_up = least(next_follow_up, d.next_follow_up),
    stage = case when stage = 'lost' and d.stage <> 'lost' then d.stage
                 when d.stage <> 'lost' and coalesce(public.stage_index(d.stage), 0) > coalesce(public.stage_index(stage), 0) then d.stage else stage end,
    other_phones = coalesce((select array_agg(distinct x) from unnest(other_phones || d.other_phones || array[d.phone]) x where x is not null and x <> k.phone), '{}'),
    created_at = least(created_at, d.created_at)
  where id = p_keep;

  update public.activities set lead_id = p_keep where lead_id = p_drop;
  update public.visits set lead_id = p_keep where lead_id = p_drop;
  update public.shortlists set lead_id = p_keep where lead_id = p_drop;
  update public.deals set lead_id = p_keep where lead_id = p_drop;
  insert into public.lead_people (lead_id, user_id, first_at) select p_keep, user_id, first_at from public.lead_people where lead_id = p_drop on conflict do nothing;
  update public.lead_steps s set lead_id = p_keep where s.lead_id = p_drop
    and not exists (select 1 from public.lead_steps x where x.lead_id = p_keep and x.step = s.step);
  update public.project_matches m set lead_id = p_keep where m.lead_id = p_drop
    and not exists (select 1 from public.project_matches x where x.lead_id = p_keep and x.project_id = m.project_id);
  insert into public.activities (org_id, lead_id, type, body, by_user)
    values (k.org_id, p_keep, 'note', 'Merged with a duplicate: ' || d.name || ' · ' || d.phone || coalesce(' · came from ' || d.source, ''), auth.uid());
  delete from public.leads where id = p_drop;
  perform set_config('estatedesk.system', 'off', true);
end $$;
revoke all on function public.merge_leads(uuid, uuid) from public, anon;
grant execute on function public.merge_leads(uuid, uuid) to authenticated;

-- ---------- 3. Site-visit check-in with GPS ----------
alter table public.visits add column if not exists checkin_at timestamptz;
alter table public.visits add column if not exists checkin_lat double precision;
alter table public.visits add column if not exists checkin_lng double precision;
alter table public.visits add column if not exists checkin_accuracy int;
alter table public.visits add column if not exists checkin_address text;
alter table public.visits add column if not exists checkin_distance_m int;
alter table public.visits add column if not exists checkin_by uuid references auth.users(id) on delete set null;

-- "I'm at the site": saves time, place and how far it is from the project's map pin.
create or replace function public.visit_checkin(p_visit uuid, p_lat double precision, p_lng double precision, p_accuracy int, p_address text)
returns int language plpgsql security definer set search_path = public as $$
declare v public.visits%rowtype; l public.leads%rowtype; p public.projects%rowtype; v_dist int; r text;
begin
  select * into v from public.visits where id = p_visit for update;
  if not found then raise exception 'Visit not found'; end if;
  select * into l from public.leads where id = v.lead_id;
  r := public.my_role(v.org_id);
  if r is null or r = 'partner' or not public.can_use(v.org_id) then raise exception 'Visit not found'; end if;
  if r = 'agent' and v.agent_id is distinct from auth.uid() and l.assigned_to is distinct from auth.uid() then raise exception 'This visit is with someone else'; end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then raise exception 'Location not found. Turn on location and try again.'; end if;
  if v.status <> 'scheduled' then raise exception 'This visit is already closed'; end if;
  if v.at > now() + interval '12 hours' or v.at < now() - interval '2 days' then raise exception 'Check in on the day of the visit'; end if;
  select * into p from public.projects where id = v.project_id;
  if p.lat is not null and p.lng is not null then
    v_dist := round(6371000 * 2 * asin(sqrt(power(sin(radians(p_lat - p.lat) / 2), 2) +
                cos(radians(p.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - p.lng) / 2), 2))));
  end if;
  update public.visits set checkin_at = now(), checkin_lat = p_lat, checkin_lng = p_lng, checkin_accuracy = greatest(0, least(p_accuracy, 100000)),
    checkin_address = nullif(left(trim(coalesce(p_address, '')), 300), ''), checkin_distance_m = v_dist, checkin_by = auth.uid()
  where id = p_visit;
  insert into public.activities (org_id, lead_id, type, body, by_user)
    values (v.org_id, v.lead_id, 'visit', 'Checked in at the site' || coalesce(' (' || p.name || ')', '') ||
      coalesce(' · ' || case when v_dist < 1000 then v_dist || ' m from the project pin' else round(v_dist / 1000.0, 1) || ' km from the project pin' end, '') ||
      coalesce(' · ' || nullif(left(trim(coalesce(p_address, '')), 160), ''), ''), auth.uid());
  return v_dist;
end $$;
revoke all on function public.visit_checkin(uuid, double precision, double precision, int, text) from public, anon;
grant execute on function public.visit_checkin(uuid, double precision, double precision, int, text) to authenticated;

select 'patch-017 done';
