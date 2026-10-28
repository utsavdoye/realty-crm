-- patch-040: WhatsApp inside the CRM (chat inbox, auto brochure to new leads, visit reminders).
-- Run after patch-039. Safe to run more than once.

-- 1. Company settings
alter table public.organizations add column if not exists wa_phone_id text;            -- WhatsApp phone number ID this company uses
alter table public.organizations add column if not exists wa_lead_source text;         -- lead_sources.key for new people who message first
alter table public.organizations add column if not exists wa_auto_welcome boolean not null default false;
alter table public.organizations add column if not exists wa_visit_reminders boolean not null default false;
create unique index if not exists organizations_wa_phone_idx on public.organizations(wa_phone_id) where wa_phone_id is not null;

-- 2. Chats (one per client number) and messages
create table if not exists public.wa_chats (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone text not null,                        -- 919876543210
  name text,
  lead_id uuid references public.leads(id) on delete set null,
  last_text text,
  last_at timestamptz not null default now(),
  last_in_at timestamptz,                     -- last message FROM the client (24-hour window)
  unread int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, phone)
);
create index if not exists wa_chats_org_last on public.wa_chats(org_id, last_at desc);

create table if not exists public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  chat_id uuid not null references public.wa_chats(id) on delete cascade,
  dir text not null check (dir in ('in', 'out')),
  kind text not null default 'text',          -- text, image, document, audio, video, template, location, other
  body text not null default '',
  media_id text,
  media_mime text,
  file_name text,
  wa_id text unique,
  status text not null default 'sent',        -- received, sent, delivered, read, failed
  error text,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wa_messages_chat on public.wa_messages(chat_id, created_at);

-- Admins and managers see every chat; an agent sees chats of the clients assigned to them.
create or replace function public.can_see_wa_chat(p_chat uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.wa_chats c left join public.leads l on l.id = c.lead_id
    where c.id = p_chat and public.can_use(c.org_id)
      and (public.is_manager(c.org_id) or l.assigned_to = auth.uid() or l.partner_id = auth.uid())
  );
$$;
revoke all on function public.can_see_wa_chat(uuid) from public, anon;
grant execute on function public.can_see_wa_chat(uuid) to authenticated;

alter table public.wa_chats enable row level security;
drop policy if exists wac_select on public.wa_chats;
create policy wac_select on public.wa_chats for select using (public.can_see_wa_chat(id));
alter table public.wa_messages enable row level security;
drop policy if exists wam_select on public.wa_messages;
create policy wam_select on public.wa_messages for select using (public.can_see_wa_chat(chat_id));
-- Writes happen only on the server (webhook and send actions check permission first).
revoke all on public.wa_chats, public.wa_messages from anon;
revoke insert, update, delete on public.wa_chats, public.wa_messages from authenticated;
grant select on public.wa_chats, public.wa_messages to authenticated;

-- 3. Visit reminders sent (so nobody gets the same reminder twice)
alter table public.visits add column if not exists wa_reminded_at timestamptz;

select 'patch-040 done';
