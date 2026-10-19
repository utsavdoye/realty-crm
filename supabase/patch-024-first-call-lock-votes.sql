-- patch-024:
--  1. Brochure and floor plans open for a client ONLY after the team marks "First call" done on that client's lead
--     (Client journey → First call). Before that the client can ask (it becomes a lead), but the files stay locked.
--     This applies everywhere: the client website, shortlist links and the CRM's own /p and /s pages.
--  2. Visitors on the website can upvote a project (one vote per browser), and the count shows on the website and in the CRM.
-- Safe to run more than once.

-- ---------- 1. First call done = files open ----------
create or replace function public.first_call_done(p_org uuid, p_phone text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(length(public.normalize_phone(p_phone)) >= 8, false) and exists (
    select 1 from public.leads l
    join public.lead_steps st on st.lead_id = l.id and st.step = 'call'
    where l.org_id = p_org and public.normalize_phone(l.phone) = public.normalize_phone(p_phone))
$$;
revoke all on function public.first_call_done(uuid, text) from public, anon, authenticated;

create or replace function public.site_project_files(p_key text, p_project uuid, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.lead_sources%rowtype; p public.projects%rowtype;
begin
  if p_key is null or p_project is null then return null; end if;
  select * into s from public.lead_sources where key = p_key and active;
  if not found or not public.org_ok(s.org_id) then return null; end if;
  select * into p from public.projects where id = p_project and org_id = s.org_id and on_website and coalesce(status, '') <> 'Sold out';
  if not found then return null; end if;
  if not public.first_call_done(s.org_id, p_phone) then return jsonb_build_object('locked', true, 'name', p.name); end if;
  return jsonb_build_object('name', p.name, 'link', nullif(trim(p.link), ''), 'floor_plans', coalesce(p.floor_plans, '[]'::jsonb));
end $$;
revoke all on function public.site_project_files(text, uuid, text) from public;
grant execute on function public.site_project_files(text, uuid, text) to anon, authenticated;

create or replace function public.site_shortlist_files(p_token text, p_project uuid, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.shortlists%rowtype; p public.projects%rowtype;
begin
  if p_token is null or p_project is null then return null; end if;
  select * into s from public.shortlists where token = p_token;
  if not found or s.created_at < now() - interval '180 days' or not public.org_ok(s.org_id) or not (p_project = any(s.project_ids)) then return null; end if;
  select * into p from public.projects where id = p_project and org_id = s.org_id;
  if not found then return null; end if;
  if not public.first_call_done(s.org_id, p_phone) then return jsonb_build_object('locked', true, 'name', p.name); end if;
  return jsonb_build_object('name', p.name, 'link', nullif(trim(p.link), ''), 'floor_plans', coalesce(p.floor_plans, '[]'::jsonb));
end $$;
revoke all on function public.site_shortlist_files(text, uuid, text) from public;
grant execute on function public.site_shortlist_files(text, uuid, text) to anon, authenticated;

-- CRM shortlist page (/s/...): the page data no longer carries brochure / floor plan links.
create or replace function public.get_shortlist(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.shortlists%rowtype; l public.leads%rowtype; a record; v_projects jsonb;
begin
  select * into s from public.shortlists where token = p_token;
  if not found or s.created_at < now() - interval '180 days' then return null; end if;
  if not public.org_ok(s.org_id) then return null; end if;
  select * into l from public.leads where id = s.lead_id;
  select m.full_name, m.phone into a from public.members m where m.org_id = s.org_id and m.user_id = coalesce(l.assigned_to, s.created_by) and m.active;
  if a.full_name is null then
    select m.full_name, m.phone into a from public.members m where m.org_id = s.org_id and m.active and m.role = 'owner' order by joined_at limit 1;
  end if;
  select coalesce(jsonb_agg(public.public_project_json(p) - 'link' - 'floor_plans'
           || jsonb_build_object('has_brochure', nullif(trim(coalesce(p.link, '')), '') is not null,
                                 'plan_count', jsonb_array_length(coalesce(p.floor_plans, '[]'::jsonb)))
           order by array_position(s.project_ids, p.id)), '[]'::jsonb) into v_projects
    from public.projects p where p.id = any(s.project_ids) and p.org_id = s.org_id;
  return jsonb_build_object('client', split_part(l.name, ' ', 1), 'note', s.note, 'reactions', s.reactions,
    'agent_name', a.full_name, 'agent_phone', a.phone, 'company', (select name from public.organizations where id = s.org_id), 'projects', v_projects);
end $$;
revoke all on function public.get_shortlist(text) from public;
grant execute on function public.get_shortlist(text) to anon, authenticated;

-- CRM shortlist page "Show me the full details": photos and price always; files only after that client's first call.
create or replace function public.shortlist_unlock(p_token text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shortlists%rowtype; p public.projects%rowtype; l public.leads%rowtype; v_open boolean;
begin
  select * into s from public.shortlists where token = p_token;
  if not found or s.created_at < now() - interval '180 days' or not public.org_ok(s.org_id) or not (p_project = any(s.project_ids)) then return null; end if;
  select * into p from public.projects where id = p_project and org_id = s.org_id;
  if not found then return null; end if;
  select * into l from public.leads where id = s.lead_id;
  v_open := exists (select 1 from public.lead_steps where lead_id = s.lead_id and step = 'call');
  return jsonb_build_object('photos', to_jsonb(coalesce(p.photos, '{}')), 'price_to', p.price_to,
    'link', case when v_open then nullif(trim(p.link), '') end,
    'floor_plans', case when v_open then coalesce(p.floor_plans, '[]'::jsonb) else '[]'::jsonb end,
    'files_locked', not v_open and (nullif(trim(coalesce(p.link, '')), '') is not null or jsonb_array_length(coalesce(p.floor_plans, '[]'::jsonb)) > 0));
end $$;
revoke all on function public.shortlist_unlock(text, uuid) from public;
grant execute on function public.shortlist_unlock(text, uuid) to anon, authenticated;

-- CRM project page (/p/...): name + number saves the enquiry; photos and price open; files only after the first call.
create or replace function public.unlock_public_project(p_token text, p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.projects%rowtype; v_open boolean;
begin
  if not public.public_enquiry(p_token, p_name, p_phone, 'Asked for the price list, floor plans and all photos', null) then return null; end if;
  select * into p from public.projects where share_token = p_token and is_public;
  if not found then return null; end if;
  v_open := public.first_call_done(p.org_id, p_phone);
  return jsonb_build_object('photos', to_jsonb(coalesce(p.photos, '{}')), 'price_to', p.price_to,
    'link', case when v_open then p.link end,
    'floor_plans', case when v_open then coalesce(p.floor_plans, '[]'::jsonb) else '[]'::jsonb end,
    'files_locked', not v_open and (nullif(trim(coalesce(p.link, '')), '') is not null or jsonb_array_length(coalesce(p.floor_plans, '[]'::jsonb)) > 0));
end $$;
revoke all on function public.unlock_public_project(text, text, text) from public;
grant execute on function public.unlock_public_project(text, text, text) to anon, authenticated;

-- ---------- 2. Upvotes ----------
create table if not exists public.project_votes (
  project_id uuid not null references public.projects(id) on delete cascade,
  voter text not null check (voter ~ '^[a-f0-9]{32,64}$'),
  created_at timestamptz not null default now(),
  primary key (project_id, voter)
);
alter table public.project_votes enable row level security;
revoke all on public.project_votes from anon, authenticated;
drop policy if exists pv_select on public.project_votes;
create policy pv_select on public.project_votes for select using (exists (select 1 from public.projects p where p.id = project_id and public.can_use(p.org_id)));
grant select on public.project_votes to authenticated;

-- Vote on / take back a vote from the website. p_voter is a random id kept in the visitor's browser.
create or replace function public.site_vote(p_org uuid, p_project uuid, p_voter text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_voter is null or p_voter !~ '^[a-f0-9]{32,64}$' then return null; end if;
  if not exists (select 1 from public.projects where id = p_project and org_id = p_org and on_website) or not public.org_ok(p_org) then return null; end if;
  if not public.hit_ok('vote:' || p_voter, interval '1 hour', 60) or not public.hit_ok('votep:' || p_project, interval '1 hour', 500) then
    return jsonb_build_object('ok', false, 'votes', (select count(*) from public.project_votes where project_id = p_project));
  end if;
  if p_on then insert into public.project_votes (project_id, voter) values (p_project, p_voter) on conflict do nothing;
  else delete from public.project_votes where project_id = p_project and voter = p_voter; end if;
  return jsonb_build_object('ok', true, 'votes', (select count(*) from public.project_votes where project_id = p_project));
end $$;
revoke all on function public.site_vote(uuid, uuid, text, boolean) from public;
grant execute on function public.site_vote(uuid, uuid, text, boolean) to anon, authenticated;

create or replace function public.site_project_json(p public.projects) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'developer', p.developer, 'location', p.location, 'rera_no', p.rera_no,
    'type', p.type, 'configs', p.configs, 'price_from', p.price_from, 'status', p.status, 'possession', p.possession,
    'highlights', p.highlights, 'amenities', p.amenities, 'banks', p.banks,
    'size_from', p.size_from, 'size_to', p.size_to, 'lat', p.lat, 'lng', p.lng,
    'photos', coalesce(p.photos[1:8], '{}'), 'updated_at', p.updated_at, 'deal', p.deal,
    'has_brochure', nullif(trim(coalesce(p.link, '')), '') is not null,
    'plan_count', jsonb_array_length(coalesce(p.floor_plans, '[]'::jsonb)),
    'votes', (select count(*) from public.project_votes v where v.project_id = p.id))
$$;
revoke all on function public.site_project_json(public.projects) from public, anon, authenticated;

select 'patch-024 done';
