-- Free 5-minute timer so scheduled posts go out even when nobody has the CRM open.
-- 1. Supabase → Database → Extensions: turn on pg_cron and pg_net.
-- 2. Replace PASTE_CRON_SECRET with the same value you put in Vercel as CRON_SECRET.
-- 3. Run this in SQL Editor. To stop it later: select cron.unschedule('social-posts');

select cron.unschedule('social-posts') where exists (select 1 from cron.job where jobname = 'social-posts');
select cron.schedule('social-posts', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://realty-crm-navy.vercel.app/api/cron/social',
    headers := jsonb_build_object('Authorization', 'Bearer PASTE_CRON_SECRET'),
    timeout_milliseconds := 60000
  );
$$);

-- WhatsApp site-visit reminders (same timer idea, every 5 minutes).
select cron.unschedule('wa-reminders') where exists (select 1 from cron.job where jobname = 'wa-reminders');
select cron.schedule('wa-reminders', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://realty-crm-navy.vercel.app/api/cron/whatsapp',
    headers := jsonb_build_object('Authorization', 'Bearer PASTE_CRON_SECRET'),
    timeout_milliseconds := 60000
  );
$$);
