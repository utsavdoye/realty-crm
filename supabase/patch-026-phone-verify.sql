-- patch-026: clients verify their mobile number with an SMS code (Firebase) before asking for the brochure.
--   The website sends a Firebase SMS code; after the client types it, Firebase gives the website a signed token
--   that says which number was verified. The CRM checks that token, so nobody can type someone else's number.
--   Turn it on in Lead sources (admins). (An earlier WhatsApp version of this patch is cleaned up below.)
-- Safe to run more than once.

-- Clean up the earlier WhatsApp version, if it was run
drop function if exists public.verify_inbound(text, text);
drop function if exists public.site_verify_start(text, text);
drop function if exists public.site_verify_status(text, text);
drop function if exists public.set_verify_whatsapp(uuid, boolean);
drop table if exists public.phone_checks;
alter table public.organizations drop column if exists verify_whatsapp;

alter table public.organizations add column if not exists verify_phone boolean not null default false;

-- Admin switch
create or replace function public.set_verify_phone(p_org uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can change this.'; end if;
  update public.organizations set verify_phone = coalesce(p_on, false) where id = p_org;
end $$;
revoke all on function public.set_verify_phone(uuid, boolean) from public, anon;
grant execute on function public.set_verify_phone(uuid, boolean) to authenticated;

-- Is SMS verification switched on for the company behind this website key?
create or replace function public.site_verify_needed(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select o.verify_phone from public.lead_sources s join public.organizations o on o.id = s.org_id
                   where s.key = p_key and s.active), false)
$$;
revoke all on function public.site_verify_needed(text) from public;
grant execute on function public.site_verify_needed(text) to anon, authenticated;

-- The website also learns whether to ask for the SMS code.
create or replace function public.site_contact(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('phone', o.website_phone, 'verify_phone', o.verify_phone) from public.organizations o where o.id = p_org and public.org_ok(o.id)
$$;
revoke all on function public.site_contact(uuid) from public;
grant execute on function public.site_contact(uuid) to anon, authenticated;

select 'patch-026 done';
