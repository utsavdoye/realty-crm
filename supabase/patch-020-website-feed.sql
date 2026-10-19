-- patch-020: your client website (e.g. Surestone) shows the CRM's projects automatically.
-- Every project is on the website unless a manager hides it. Sold-out projects are left out.
-- Only safe fields go out: no flat list, no rate card, no brochure, no leads, no phone numbers.
-- Safe to run more than once.

alter table public.projects add column if not exists on_website boolean not null default true;
alter table public.projects add column if not exists updated_at timestamptz not null default now();

create or replace function public.projects_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects for each row execute function public.projects_touch();

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
      'photos', coalesce(p.photos[1:8], '{}'), 'updated_at', p.updated_at
    ) order by p.created_at desc), '[]'::jsonb) into v
  from public.projects p
  where p.org_id = p_org and p.on_website and coalesce(p.status, '') <> 'Sold out';
  return v;
end $$;
revoke all on function public.site_projects(uuid) from public;
grant execute on function public.site_projects(uuid) to anon, authenticated;

-- Website forms: a visitor who sends an enquiry and then books a visit a minute later is no longer dropped
-- (only the exact same message twice in 2 minutes is ignored), and a wrong number always gets the error back.
create or replace function public.ingest_lead(
  p_key text, p_name text, p_phone text, p_email text, p_city text, p_location text,
  p_budget_min numeric, p_budget_max numeric, p_bhk text, p_project text, p_message text, p_raw jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; v_phone text := public.normalize_phone(p_phone);
begin
  if not public.is_service() then
    if not public.hit_ok('src:' || left(coalesce(p_key, ''), 64), interval '1 hour', 300) then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
    if length(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g')) >= 10 then
      if not public.hit_ok('srcp2:' || left(coalesce(p_key, ''), 64) || ':' || v_phone, interval '10 minutes', 6) then return jsonb_build_object('ok', true); end if;
      if not public.hit_ok('srcp:' || left(coalesce(p_key, ''), 64) || ':' || v_phone || ':' || md5(coalesce(p_project, '') || '|' || coalesce(p_message, '')), interval '2 minutes', 1) then
        return jsonb_build_object('ok', true);
      end if;
    end if;
  end if;
  r := public.ingest_lead_core(p_key, left(p_name, 120), p_phone, left(p_email, 200), left(p_city, 120), left(p_location, 200),
         p_budget_min, p_budget_max, left(p_bhk, 30), left(p_project, 200), left(p_message, 2000), p_raw);
  if public.is_service() or not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  return jsonb_build_object('ok', true);  -- anon/browser callers get no names or numbers back
end $$;
revoke all on function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) from public;
grant execute on function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) to service_role;
  end if;
end $$;

select 'patch-020 done';
