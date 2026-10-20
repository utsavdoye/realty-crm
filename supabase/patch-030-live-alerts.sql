-- patch-030: new alerts show on the Alerts page by themselves (no refresh). Each person still only gets their own alerts.
-- Also speeds up the Alerts page when there are many alerts. Safe to run more than once.
create index if not exists notifications_user_unread on public.notifications(user_id) where read_at is null;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
select 'patch-030 done';
