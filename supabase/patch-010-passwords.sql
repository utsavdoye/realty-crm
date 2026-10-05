-- ============================================================
-- Patch 010 — sign in with email or mobile + password
-- Run once in Supabase → SQL Editor (after patch-009). Safe to run again.
-- ============================================================

-- Finds the email of the account that owns a mobile number (used to sign in with "mobile + password"
-- and for "forgot password"). Only the website's server can call it — never the browser.
create or replace function public.login_email_for_phone(p_phone text) returns text
language sql stable security definer set search_path = public, auth as $$
  with v as (select public.normalize_phone(p_phone) as p)
  select u.email from auth.users u, v
  where v.p <> '' and u.email is not null and (
        public.normalize_phone(u.raw_user_meta_data ->> 'phone') = v.p
     or public.normalize_phone('+' || nullif(u.phone, '')) = v.p
     or exists (select 1 from public.members m where m.user_id = u.id and m.phone = v.p))
  order by u.last_sign_in_at desc nulls last
  limit 1
$$;
revoke all on function public.login_email_for_phone(text) from public, anon, authenticated;

-- Saves my mobile number on my account (one number = one person).
create or replace function public.set_my_phone(p_phone text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare v text := public.normalize_phone(p_phone);
begin
  if auth.uid() is null then raise exception 'Please log in again'; end if;
  if not public.valid_phone(v) then raise exception 'Enter a valid mobile number: 10 digits for India, or + and country code'; end if;
  if exists (select 1 from auth.users u where u.id <> auth.uid() and (
               public.normalize_phone(u.raw_user_meta_data ->> 'phone') = v or public.normalize_phone('+' || nullif(u.phone, '')) = v))
     or exists (select 1 from public.members m where m.user_id <> auth.uid() and m.phone = v) then
    raise exception 'This mobile number is already used by another account';
  end if;
  update public.members set phone = v where user_id = auth.uid();
  return v;
end $$;
revoke all on function public.set_my_phone(text) from public, anon;
grant execute on function public.set_my_phone(text) to authenticated;
