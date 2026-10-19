-- patch-023: projects can be for sale, for lease, or both; the website shows a call button with the company number.
-- Safe to run more than once.

alter table public.projects add column if not exists deal text not null default 'sale';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projects_deal_ok') then
    alter table public.projects add constraint projects_deal_ok check (deal in ('sale','lease','both'));
  end if;
end $$;

alter table public.organizations add column if not exists website_phone text;

-- The number clients call from the website (admin only). Empty removes it.
create or replace function public.set_website_phone(p_org uuid, p_phone text) returns text
language plpgsql security definer set search_path = public as $$
declare v text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can change the website phone number.'; end if;
  if v is not null then
    if v ~ '^\+' then v := '+' || regexp_replace(v, '\D', '', 'g'); else v := regexp_replace(v, '\D', '', 'g'); end if;
    if v ~ '^0?[6-9][0-9]{9}$' then v := '+91' || right(v, 10);
    elsif v ~ '^91[6-9][0-9]{9}$' then v := '+' || v;
    end if;
    if v !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Enter a valid phone number, e.g. 98765 43210 or +91 98765 43210.'; end if;
  end if;
  update public.organizations set website_phone = v where id = p_org;
  return v;
end $$;
revoke all on function public.set_website_phone(uuid, text) from public, anon;
grant execute on function public.set_website_phone(uuid, text) to authenticated;

-- What the website may show about the company: just the call number.
create or replace function public.site_contact(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('phone', o.website_phone) from public.organizations o where o.id = p_org and public.org_ok(o.id)
$$;
revoke all on function public.site_contact(uuid) from public;
grant execute on function public.site_contact(uuid) to anon, authenticated;

create or replace function public.site_project_json(p public.projects) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'developer', p.developer, 'location', p.location, 'rera_no', p.rera_no,
    'type', p.type, 'configs', p.configs, 'price_from', p.price_from, 'status', p.status, 'possession', p.possession,
    'highlights', p.highlights, 'amenities', p.amenities, 'banks', p.banks,
    'size_from', p.size_from, 'size_to', p.size_to, 'lat', p.lat, 'lng', p.lng,
    'photos', coalesce(p.photos[1:8], '{}'), 'updated_at', p.updated_at, 'deal', p.deal,
    'has_brochure', nullif(trim(coalesce(p.link, '')), '') is not null,
    'plan_count', jsonb_array_length(coalesce(p.floor_plans, '[]'::jsonb)))
$$;
revoke all on function public.site_project_json(public.projects) from public, anon, authenticated;

select 'patch-023 done';
