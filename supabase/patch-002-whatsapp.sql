-- Run once in Supabase → SQL Editor if you already ran schema.sql before.
-- Saves the invited mobile number on the team member, so WhatsApp lead alerts reach people who log in with email.

-- Logged-in person accepts the invite. It must match the mobile or email it was sent to.
create or replace function public.accept_invite(p_token text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare i public.invites%rowtype; v_phone text; v_email text;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into i from public.invites where token = p_token for update;
  if not found then raise exception 'This invite link is not valid'; end if;
  if i.accepted_at is not null then raise exception 'This invite link was already used'; end if;
  if i.expires_at < now() then raise exception 'This invite link has expired. Ask for a new one.'; end if;
  select public.normalize_phone(u.phone), lower(u.email) into v_phone, v_email from auth.users u where u.id = auth.uid();
  if not ((i.phone is not null and i.phone = v_phone) or (i.email is not null and i.email = v_email)) then
    raise exception 'This invite was sent to a different mobile number or email. Log in with that one.';
  end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Enter your name'; end if;
  insert into public.members (org_id, user_id, role, full_name, phone, email)
    values (i.org_id, auth.uid(), i.role, trim(p_full_name), coalesce(v_phone, i.phone), coalesce(v_email, i.email))
    on conflict (org_id, user_id) do update
      set role = case when public.members.role = 'owner' then 'owner' else excluded.role end,
          active = true, deactivated_at = null, full_name = excluded.full_name;
  update public.invites set accepted_by = auth.uid(), accepted_at = now() where id = i.id;
  return i.org_id;
end $$;

