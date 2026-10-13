-- Emulates the LEGACY Supabase behaviour: every new object in public is granted
-- to the API roles. Loaded only in the 'legacy' test mode.

alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

