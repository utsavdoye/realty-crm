-- patch-042: many follow-ups per lead (tasks), and the last call result on each lead.
-- Run after patch-041. Safe to run more than once.

-- 1. Last call result, shown as a column in the leads table
alter table public.leads add column if not exists last_outcome text;      -- interested, callback, noanswer, busy, off, notint, wrong
alter table public.leads add column if not exists last_outcome_at timestamptz;

-- 2. Follow-up tasks
create table if not exists public.followups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null default 'call' check (kind in ('call', 'meeting', 'visit', 'whatsapp', 'documents', 'payment', 'other')),
  title text not null default '' check (char_length(title) <= 200),
  note text check (char_length(note) <= 2000),
  due_at timestamptz not null,
  done_at timestamptz,
  done_note text check (char_length(done_note) <= 1000),
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists followups_org_due on public.followups(org_id, due_at) where done_at is null;
create index if not exists followups_lead on public.followups(lead_id, due_at);
create index if not exists followups_agent_due on public.followups(org_id, assigned_to, due_at) where done_at is null;

alter table public.followups enable row level security;
-- Whoever can see the lead can see and work on its follow-ups (same rule as notes and visits).
drop policy if exists fu_select on public.followups;
create policy fu_select on public.followups for select using (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id));
drop policy if exists fu_insert on public.followups;
create policy fu_insert on public.followups for insert with check (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id and l.org_id = followups.org_id));
drop policy if exists fu_update on public.followups;
create policy fu_update on public.followups for update using (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id)) with check (public.can_use(org_id));
drop policy if exists fu_delete on public.followups;
create policy fu_delete on public.followups for delete using (public.can_use(org_id) and (public.is_manager(org_id) or created_by = auth.uid()));
revoke all on public.followups from anon;
grant select, insert, update, delete on public.followups to authenticated;

-- 3. The lead's "next follow-up" always shows the earliest open task (or its own call reminder, whichever is first).
create or replace function public.followup_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lead uuid := coalesce(new.lead_id, old.lead_id); v_next timestamptz;
begin
  select min(due_at) into v_next from public.followups where lead_id = v_lead and done_at is null;
  if v_next is not null then
    update public.leads set next_follow_up = v_next
      where id = v_lead and (next_follow_up is null or next_follow_up > v_next
        or (tg_op <> 'INSERT' and (next_follow_up = old.due_at or next_follow_up < now() - interval '1 minute')));
  elsif tg_op <> 'INSERT' then
    -- the last open task was finished: keep the lead's own call reminder only if it is still ahead
    update public.leads set next_follow_up = null where id = v_lead and next_follow_up is not null
      and (tg_op = 'DELETE' and next_follow_up = old.due_at or tg_op = 'UPDATE' and next_follow_up = old.due_at);
  end if;
  return null;
end $$;
drop trigger if exists followup_sync on public.followups;
create trigger followup_sync after insert or update or delete on public.followups for each row execute function public.followup_sync();

select 'patch-042 done';
