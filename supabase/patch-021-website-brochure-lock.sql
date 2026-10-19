-- patch-021: on the client website, the brochure and floor plans open only after the visitor leaves a name and mobile number.
-- The website list says only whether a brochure / floor plans exist; the links come out after the lead is saved.
-- Safe to run more than once.

create or replace function public.site_projects(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if p_org is null or not exists (select 1 from public.organizations where id = p_org) or not public.org_ok(p_org) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'developer', p.developer, 'location', p.location, 'rera_no', p.rera_no,
      'type', p.type, 'configs', p.configs, 'price_from', p.price_from, 'status', p.status, 'possession', p.possession,
      'highlights', p.highlights, 'amenities', p.amenities, 'banks', p.banks,
      'size_from', p.size_from, 'size_to', p.size_to, 'lat', p.lat, 'lng', p.lng,
      'photos', coalesce(p.photos[1:8], '{}'), 'updated_at', p.updated_at,
      'has_brochure', coalesce(nullif(trim(p.link), ''), null) is not null,
      'plan_count', jsonb_array_length(coalesce(p.floor_plans, '[]'::jsonb))
    ) order by p.created_at desc), '[]'::jsonb) into v
  from public.projects p
  where p.org_id = p_org and p.on_website and coalesce(p.status, '') <> 'Sold out';
  return v;
end $$;
revoke all on function public.site_projects(uuid) from public;
grant execute on function public.site_projects(uuid) to anon, authenticated;

-- Gives the brochure and floor plans of one website project, only to a number that just enquired through this website link
-- (the website first saves the name and number as a lead, then calls this).
create or replace function public.site_project_files(p_key text, p_project uuid, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.lead_sources%rowtype; p public.projects%rowtype; v_phone text := public.normalize_phone(p_phone);
begin
  if p_key is null or p_project is null or length(coalesce(v_phone, '')) < 8 then return null; end if;
  select * into s from public.lead_sources where key = p_key and active;
  if not found or not public.org_ok(s.org_id) then return null; end if;
  select * into p from public.projects where id = p_project and org_id = s.org_id and on_website and coalesce(status, '') <> 'Sold out';
  if not found then return null; end if;
  -- the number must have enquired in the last 15 minutes
  if not exists (
    select 1 from public.leads l
    where l.org_id = s.org_id and public.normalize_phone(l.phone) = v_phone
      and (l.created_at > now() - interval '15 minutes'
           or exists (select 1 from public.activities a where a.lead_id = l.id and a.created_at > now() - interval '15 minutes'))
  ) then return null; end if;
  return jsonb_build_object('name', p.name, 'link', nullif(trim(p.link), ''), 'floor_plans', coalesce(p.floor_plans, '[]'::jsonb));
end $$;
revoke all on function public.site_project_files(text, uuid, text) from public;
grant execute on function public.site_project_files(text, uuid, text) to anon, authenticated;

select 'patch-021 done';
