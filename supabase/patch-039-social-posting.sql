-- patch-039: one-click social posting (Facebook Page, Instagram, YouTube) + Meta lead ads.
-- Run after patch-038. Safe to run more than once.

-- 1. Connected accounts (what the team sees) and their keys (only the server can read them).
create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram', 'youtube')),
  account_id text not null,          -- Page id / Instagram user id / YouTube channel id
  name text,                         -- shown in the CRM
  picture text,
  page_id text,                      -- Instagram: the Facebook Page it is linked to
  active boolean not null default true,
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, platform, account_id)
);
alter table public.social_accounts enable row level security;
drop policy if exists sa_select on public.social_accounts;
create policy sa_select on public.social_accounts for select using (public.can_use(org_id) and public.my_role(org_id) in ('owner', 'manager'));
drop policy if exists sa_update on public.social_accounts;
create policy sa_update on public.social_accounts for update using (public.can_use(org_id) and public.my_role(org_id) in ('owner', 'manager'));
drop policy if exists sa_delete on public.social_accounts;
create policy sa_delete on public.social_accounts for delete using (public.can_use(org_id) and public.my_role(org_id) = 'owner');
revoke all on public.social_accounts from anon;
grant select, update, delete on public.social_accounts to authenticated;

create table if not exists public.social_secrets (
  account_id uuid primary key references public.social_accounts(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz
);
alter table public.social_secrets enable row level security;   -- no policies: only the server key can read it
revoke all on public.social_secrets from anon, authenticated;

-- 2. Posts
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 2200),
  title text check (char_length(title) <= 100),      -- YouTube title
  media jsonb not null default '[]'::jsonb,          -- [{ "url", "type": "image"|"video", "size" }]
  targets uuid[] not null default '{}',              -- social_accounts.id
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'publishing', 'done', 'partial', 'failed')),
  scheduled_at timestamptz,
  results jsonb not null default '{}'::jsonb,        -- { account_id: { ok, url, id, error, at, step } }
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  locked_at timestamptz
);
create index if not exists social_posts_org on public.social_posts(org_id, created_at desc);
create index if not exists social_posts_due on public.social_posts(status, scheduled_at) where status in ('scheduled', 'publishing');
alter table public.social_posts enable row level security;
drop policy if exists sp_select on public.social_posts;
create policy sp_select on public.social_posts for select using (public.can_use(org_id) and public.my_role(org_id) in ('owner', 'manager'));
drop policy if exists sp_insert on public.social_posts;
create policy sp_insert on public.social_posts for insert with check (public.can_use(org_id) and public.my_role(org_id) in ('owner', 'manager'));
drop policy if exists sp_update on public.social_posts;
create policy sp_update on public.social_posts for update using (public.can_use(org_id) and public.my_role(org_id) in ('owner', 'manager'));
drop policy if exists sp_delete on public.social_posts;
create policy sp_delete on public.social_posts for delete using (public.can_use(org_id) and public.my_role(org_id) in ('owner', 'manager'));
revoke all on public.social_posts from anon;
grant select, insert, update, delete on public.social_posts to authenticated;

-- 3. Meta lead ads: which lead source the Facebook / Instagram lead forms go into.
alter table public.organizations add column if not exists meta_lead_source text;   -- a lead_sources.key
create or replace function public.set_meta_lead_source(p_org uuid, p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can change this.'; end if;
  if p_key is not null and not exists (select 1 from public.lead_sources where org_id = p_org and key = p_key) then raise exception 'Lead source not found.'; end if;
  update public.organizations set meta_lead_source = p_key where id = p_org;
end $$;
revoke all on function public.set_meta_lead_source(uuid, text) from public, anon;
grant execute on function public.set_meta_lead_source(uuid, text) to authenticated;

-- 4. Bigger uploads for reels and videos (Supabase free plan allows up to 50 MB per file).
update storage.buckets set file_size_limit = 52428800 where id = 'project-photos';

select 'patch-039 done';
