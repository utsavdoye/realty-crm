-- patch-022: links your team sends to clients open on your own website (e.g. Surestone), not on the CRM.
--   * The company saves its website address once (Lead sources → Your client website).
--   * A shortlist link becomes  <website>/shortlist.html?t=...  and a project link  <website>/property.html?p=...
--   * On the website, the brochure and floor plans of a shortlisted project open only after name + mobile.
-- Old CRM links (/s/..., /p/...) keep working. Safe to run more than once.

alter table public.organizations add column if not exists website_url text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_website_url_ok') then
    alter table public.organizations add constraint organizations_website_url_ok
      check (website_url is null or website_url ~ '^https://[a-z0-9.-]+\.[a-z]{2,}(/[A-Za-z0-9._~/-]*)?$');
  end if;
end $$;

create or replace function public.set_website_url(p_org uuid, p_url text) returns text
language plpgsql security definer set search_path = public as $$
declare v text := nullif(regexp_replace(lower(trim(coalesce(p_url, ''))), '/+$', ''), '');
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can change the website address.'; end if;
  if v is not null and v !~ '^https?://' then v := 'https://' || v; end if;
  if v is not null and v ~ '^http://' then v := 'https://' || substr(v, 8); end if;
  if v is not null and v !~ '^https://[a-z0-9.-]+\.[a-z]{2,}(/[a-z0-9._~/-]*)?$' then
    raise exception 'That does not look like a website address. Example: https://surestonev1.vercel.app';
  end if;
  update public.organizations set website_url = v where id = p_org;
  return v;
end $$;
revoke all on function public.set_website_url(uuid, text) from public, anon;
grant execute on function public.set_website_url(uuid, text) to authenticated;

-- One project as the website shows it: safe fields only, the brochure / floor plans only as yes/no and a count.
create or replace function public.site_project_json(p public.projects) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'developer', p.developer, 'location', p.location, 'rera_no', p.rera_no,
    'type', p.type, 'configs', p.configs, 'price_from', p.price_from, 'status', p.status, 'possession', p.possession,
    'highlights', p.highlights, 'amenities', p.amenities, 'banks', p.banks,
    'size_from', p.size_from, 'size_to', p.size_to, 'lat', p.lat, 'lng', p.lng,
    'photos', coalesce(p.photos[1:8], '{}'), 'updated_at', p.updated_at,
    'has_brochure', nullif(trim(coalesce(p.link, '')), '') is not null,
    'plan_count', jsonb_array_length(coalesce(p.floor_plans, '[]'::jsonb)))
$$;
revoke all on function public.site_project_json(public.projects) from public, anon, authenticated;

create or replace function public.site_projects(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if p_org is null or not exists (select 1 from public.organizations where id = p_org) or not public.org_ok(p_org) then return null; end if;
  select coalesce(jsonb_agg(public.site_project_json(p) order by p.created_at desc), '[]'::jsonb) into v
  from public.projects p
  where p.org_id = p_org and p.on_website and coalesce(p.status, '') <> 'Sold out';
  return v;
end $$;
revoke all on function public.site_projects(uuid) from public;
grant execute on function public.site_projects(uuid) to anon, authenticated;

-- A shortlist as the website shows it (no brochure / floor plan links, no client phone).
create or replace function public.site_shortlist(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.shortlists%rowtype; l public.leads%rowtype; a record; v_projects jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{24,64}$' then return null; end if;
  select * into s from public.shortlists where token = p_token;
  if not found or s.created_at < now() - interval '180 days' then return null; end if;
  if not public.org_ok(s.org_id) then return null; end if;
  select * into l from public.leads where id = s.lead_id;
  select m.full_name, m.phone into a from public.members m where m.org_id = s.org_id and m.user_id = coalesce(l.assigned_to, s.created_by) and m.active;
  if a.full_name is null then
    select m.full_name, m.phone into a from public.members m where m.org_id = s.org_id and m.active and m.role = 'owner' order by joined_at limit 1;
  end if;
  select coalesce(jsonb_agg(public.site_project_json(p) order by array_position(s.project_ids, p.id)), '[]'::jsonb) into v_projects
    from public.projects p where p.id = any(s.project_ids) and p.org_id = s.org_id;
  return jsonb_build_object('client', split_part(l.name, ' ', 1), 'note', s.note, 'reactions', s.reactions,
    'agent_name', a.full_name, 'agent_phone', a.phone, 'company', (select name from public.organizations where id = s.org_id),
    'org', s.org_id, 'projects', v_projects);
end $$;
revoke all on function public.site_shortlist(text) from public;
grant execute on function public.site_shortlist(text) to anon, authenticated;

-- Brochure + floor plans of one shortlisted project, only for a number that just left its details on the website.
create or replace function public.site_shortlist_files(p_token text, p_project uuid, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.shortlists%rowtype; p public.projects%rowtype; v_phone text := public.normalize_phone(p_phone);
begin
  if p_token is null or p_project is null or length(coalesce(v_phone, '')) < 8 then return null; end if;
  select * into s from public.shortlists where token = p_token;
  if not found or s.created_at < now() - interval '180 days' or not public.org_ok(s.org_id) or not (p_project = any(s.project_ids)) then return null; end if;
  select * into p from public.projects where id = p_project and org_id = s.org_id;
  if not found then return null; end if;
  if not exists (
    select 1 from public.leads l
    where l.org_id = s.org_id and public.normalize_phone(l.phone) = v_phone
      and (l.created_at > now() - interval '15 minutes'
           or exists (select 1 from public.activities a where a.lead_id = l.id and a.created_at > now() - interval '15 minutes'))
  ) then return null; end if;
  return jsonb_build_object('name', p.name, 'link', nullif(trim(p.link), ''), 'floor_plans', coalesce(p.floor_plans, '[]'::jsonb));
end $$;
revoke all on function public.site_shortlist_files(text, uuid, text) from public;
grant execute on function public.site_shortlist_files(text, uuid, text) to anon, authenticated;

select 'patch-022 done';
