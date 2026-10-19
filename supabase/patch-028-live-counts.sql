-- patch-028: upvotes and saves from the website show in the CRM within about a second, without refreshing.
-- Turns on Supabase Realtime for the two tables. Each person still only sees their own company's numbers (row level security).
-- Safe to run more than once.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_votes') then
      alter publication supabase_realtime add table public.project_votes;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'website_saves') then
      alter publication supabase_realtime add table public.website_saves;
    end if;
  end if;
end $$;

select 'patch-028 done';
