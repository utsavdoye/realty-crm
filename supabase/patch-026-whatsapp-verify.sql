-- patch-026: clients prove their mobile number by sending one WhatsApp message (free, cannot be faked).
--   The website shows a code (e.g. TA4F2C9B) → the client sends "Verify TA4F2C9B" to the company WhatsApp →
--   Meta tells the CRM which number sent it → that number is verified. Turn it on in Lead sources (admins).
-- Safe to run more than once.

alter table public.organizations add column if not exists verify_whatsapp boolean not null default false;

create table if not exists public.phone_checks (
  token text primary key default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  code text not null unique,
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text,
  phone text,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index if not exists phone_checks_org on public.phone_checks(org_id, created_at desc);
alter table public.phone_checks enable row level security;
revoke all on public.phone_checks from anon, authenticated;

-- Admin switch
create or replace function public.set_verify_whatsapp(p_org uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can change this.'; end if;
  update public.organizations set verify_whatsapp = coalesce(p_on, false) where id = p_org;
end $$;
revoke all on function public.set_verify_whatsapp(uuid, boolean) from public, anon;
grant execute on function public.set_verify_whatsapp(uuid, boolean) to authenticated;

-- Is WhatsApp verification switched on for the company behind this website key?
create or replace function public.site_verify_needed(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select o.verify_whatsapp from public.lead_sources s join public.organizations o on o.id = s.org_id
                   where s.key = p_key and s.active), false)
$$;
revoke all on function public.site_verify_needed(text) from public;
grant execute on function public.site_verify_needed(text) to anon, authenticated;

-- Website asks for a new code. Returns a secret token (kept in that browser) and the short code to send on WhatsApp.
create or replace function public.site_verify_start(p_key text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.lead_sources%rowtype; v_code text; v_token text; i int := 0;
begin
  select * into s from public.lead_sources where key = p_key and active;
  if not found or not public.org_ok(s.org_id) then return null; end if;
  if not public.hit_ok('vstart:' || p_key, interval '1 hour', 400) then return jsonb_build_object('error', 'too_many'); end if;
  loop
    v_code := 'TA' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.phone_checks where code = v_code);
    i := i + 1; if i > 5 then return null; end if;
  end loop;
  insert into public.phone_checks (code, org_id, name) values (v_code, s.org_id, left(nullif(trim(p_name), ''), 120))
  returning token into v_token;
  return jsonb_build_object('token', v_token, 'code', v_code);
end $$;
revoke all on function public.site_verify_start(text, text) from public;
grant execute on function public.site_verify_start(text, text) to anon, authenticated;

-- Called only by the CRM server when a WhatsApp message arrives (never by browsers).
create or replace function public.verify_inbound(p_from text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text; c public.phone_checks%rowtype;
begin
  v_code := substring(upper(coalesce(p_body, '')) from '(TA[0-9A-F]{6})');
  if v_code is null then return jsonb_build_object('ok', false, 'reason', 'no_code'); end if;
  select * into c from public.phone_checks where code = v_code for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown_code'); end if;
  if c.verified_at is not null then return jsonb_build_object('ok', true, 'again', true); end if;
  if c.created_at < now() - interval '30 minutes' then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  update public.phone_checks set phone = public.normalize_phone(p_from), verified_at = now() where code = v_code;
  return jsonb_build_object('ok', true, 'name', c.name);
end $$;
revoke all on function public.verify_inbound(text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.verify_inbound(text, text) to service_role;
  end if;
end $$;

-- Website checks its own token: verified yet? (the number goes back only to the browser holding the secret token)
create or replace function public.site_verify_status(p_token text, p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.phone_checks%rowtype; v_org uuid;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null; end if;
  select org_id into v_org from public.lead_sources where key = p_key and active;
  select * into c from public.phone_checks where token = p_token and org_id = v_org;
  if not found then return null; end if;
  if c.verified_at is null then
    return jsonb_build_object('verified', false, 'expired', c.created_at < now() - interval '30 minutes');
  end if;
  if c.verified_at < now() - interval '180 days' then return jsonb_build_object('verified', false, 'expired', true); end if;
  return jsonb_build_object('verified', true, 'phone', c.phone, 'name', c.name);
end $$;
revoke all on function public.site_verify_status(text, text) from public;
grant execute on function public.site_verify_status(text, text) to anon, authenticated;

-- The website also learns whether to ask for WhatsApp verification.
create or replace function public.site_contact(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('phone', o.website_phone, 'verify_whatsapp', o.verify_whatsapp) from public.organizations o where o.id = p_org and public.org_ok(o.id)
$$;
revoke all on function public.site_contact(uuid) from public;
grant execute on function public.site_contact(uuid) to anon, authenticated;

select 'patch-026 done';
