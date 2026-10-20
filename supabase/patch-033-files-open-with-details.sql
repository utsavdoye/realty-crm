-- patch-033:
--  1. Brochure and floor plans open as soon as the client leaves their name and mobile number (or is signed in on
--     the website). No more waiting for the first call. The request still goes into the CRM as a lead / on the
--     existing lead, with a fresh alert.
--  2. A brand-new lead that nobody is handling yet now alerts the admins and managers too.
-- Run after patch-032. Safe to run more than once.

-- Files open for any real mobile number (the website saves the lead first).
create or replace function public.first_call_done(p_org uuid, p_phone text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(length(regexp_replace(coalesce(public.normalize_phone(p_phone), ''), '\D', '', 'g')) >= 8, false)
$$;
revoke all on function public.first_call_done(uuid, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.first_call_done(uuid, text) to service_role; end if;
end $$;

-- CRM shortlist page (/s/...) and project page (/p/...): files open too.
create or replace function public.shortlist_unlock(p_token text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shortlists%rowtype; p public.projects%rowtype;
begin
  select * into s from public.shortlists where token = p_token;
  if not found or s.created_at < now() - interval '180 days' or not public.org_ok(s.org_id) or not (p_project = any(s.project_ids)) then return null; end if;
  select * into p from public.projects where id = p_project and org_id = s.org_id;
  if not found then return null; end if;
  return jsonb_build_object('photos', to_jsonb(coalesce(p.photos, '{}')), 'price_to', p.price_to,
    'link', nullif(trim(p.link), ''), 'floor_plans', coalesce(p.floor_plans, '[]'::jsonb), 'files_locked', false);
end $$;
revoke all on function public.shortlist_unlock(text, uuid) from public;
grant execute on function public.shortlist_unlock(text, uuid) to anon, authenticated;

-- New lead nobody is handling → admins and managers get an alert (assigned leads already alert the agent).
create or replace function public.new_lead_unassigned_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is null then
    perform public.notify_managers(new.org_id, 'lead_assigned', 'New lead: ' || new.name,
      concat_ws(' · ', new.phone, nullif(new.source, '')) || ' · not given to anyone yet', '/leads/' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists leads_new_unassigned on public.leads;
create trigger leads_new_unassigned after insert on public.leads for each row execute function public.new_lead_unassigned_notify();

select 'patch-033 done';
