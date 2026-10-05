-- Removes ALL demo data and demo logins. Your real company and real logins are not touched.
delete from public.organizations where id in ('de000000-0000-4000-8000-000000000101', 'de000000-0000-4000-8000-000000000102');
delete from auth.identities where user_id::text like 'de000000-0000-4000-8000-0000000000%';
delete from auth.users where id::text like 'de000000-0000-4000-8000-0000000000%';
