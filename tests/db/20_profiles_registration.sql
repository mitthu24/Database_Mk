-- Profiles, company registration, 30-day trial, atomicity.

-- ---- Profile creation -------------------------------------------------------
select test.ok(
  (select full_name from public.profiles where id = test.id('adminA')) = 'Alice Admin'
  and (select email from public.profiles where id = test.id('adminA')) = 'admin.a@test.local',
  'trigger created a profile with email + full_name for a new auth user');

select test.ok(
  not exists (select 1 from public.founders where user_id = test.id('adminA'))
  and not exists (select 1 from public.company_members
                  where user_id = test.id('adminA') and company_id <> test.id('companyA')),
  'hostile signup metadata (role/is_founder/company_id) granted nothing');

select test.ok(
  (select count(*) from public.profiles) = (select count(*) from auth.users),
  'every auth user has exactly one profile');

-- ---- Profile access ---------------------------------------------------------
select test.login(test.id('editorA'));
select test.ok(test.count('select 1 from public.profiles') = 1, 'employee sees only their own profile');
select test.ok(test.affected($$update public.profiles set full_name = 'Edie E.' where id = auth.uid()$$) = 1,
  'user can update own full_name');
select test.throws($$update public.profiles set email = 'x@evil.test' where id = auth.uid()$$, '42501',
  'user cannot edit profile email (column privilege)');
select test.ok(test.affected($$update public.profiles set full_name = 'Hacked' where id = test.id('adminA')$$) = 0,
  'user cannot update another user''s profile');
select test.throws($$insert into public.profiles (id, email) values (gen_random_uuid(), 'x@y.z')$$, '42501',
  'clients cannot insert profiles');
select test.logout();

select test.login(test.id('adminA'));
select test.ok(test.count($$select 1 from public.profiles where id in (test.id('adminB'), test.id('empB'))$$) = 0,
  'company A admin cannot read company B profiles');
select test.ok(test.count($$select 1 from public.profiles where id in
  (test.id('editorA'), test.id('viewerA'), test.id('nograntA'), test.id('exporterA'), test.id('adminA'))$$) = 5,
  'company A admin can read profiles of own members');
select test.logout();

select test.anon();
select test.throws('select 1 from public.profiles', '42501', 'anon cannot read profiles');
select test.logout();

-- ---- Registration: result of the fixture registration ----------------------
select test.ok(
  (select count(*) from public.companies where id = test.id('companyA')) = 1
  and (select role from public.company_members where user_id = test.id('adminA')) = 'admin'
  and (select status from public.subscriptions where company_id = test.id('companyA')) = 'trialing',
  'register_company created company + admin membership + trialing subscription');

select test.ok(
  (select trial_ends_at - trial_started_at from public.subscriptions where company_id = test.id('companyA'))
    = interval '30 days',
  'trial lasts exactly 30 days (computed by the database defaults)');

select test.ok(
  abs(extract(epoch from (now() - (select trial_started_at from public.subscriptions where company_id = test.id('companyA'))))) < 600,
  'trial starts at the server clock, not at a client-supplied time');

select test.ok(
  exists (select 1 from public.audit_logs
          where company_id = test.id('companyA') and action = 'company.registered'
            and actor_id = test.id('adminA')),
  'registration wrote an audit log entry');

-- ---- Registration: abuse / validation ---------------------------------------
select test.login(test.id('adminA'));
select test.throws($$select public.register_company('Second Company')$$, '23505',
  'a user cannot register a second company');
select test.logout();

select test.login(test.id('plain'));
select test.throws($$select public.register_company('x')$$, '22023', 'too-short company name rejected');
select test.throws($$select public.register_company('   ')$$, '22023', 'blank company name rejected');
select test.logout();

select test.login(test.id('unconfirmed'));
select test.throws($$select public.register_company('Unconfirmed Inc')$$, '42501',
  'unconfirmed email cannot register a company');
select test.logout();

select test.anon();
select test.throws($$select public.register_company('Anon Co')$$, '42501', 'anon cannot call register_company');
select test.logout();

-- ---- Direct table writes are impossible for clients -------------------------
select test.login(test.id('plain'));
select test.throws($$insert into public.companies (name) values ('Sneaky')$$, '42501',
  'clients cannot insert companies directly');
select test.throws($$insert into public.company_members (company_id, user_id, role)
                     values (test.id('companyA'), auth.uid(), 'admin')$$, '42501',
  'clients cannot insert company_members (cannot join a company or self-promote)');
select test.throws($$insert into public.subscriptions (company_id, trial_ends_at)
                     values (test.id('companyA'), now() + interval '999 days')$$, '42501',
  'clients cannot insert subscriptions (cannot choose trial dates)');
select test.logout();

-- ---- Atomicity: a failure at the LAST step leaves nothing behind -------------
create function test.fail_subscription_insert() returns trigger language plpgsql as $$
begin raise exception 'simulated failure' using errcode = 'P0001'; end $$;
create trigger test_fail before insert on public.subscriptions
  for each row execute function test.fail_subscription_insert();

select test.login(test.id('plain'));
select test.throws($$select public.register_company('Doomed Co')$$, 'P0001',
  'registration fails when the final step fails');
select test.logout();

select test.ok(
  not exists (select 1 from public.companies where name = 'Doomed Co')
  and not exists (select 1 from public.company_members where user_id = test.id('plain'))
  and not exists (select 1 from public.audit_logs where action = 'company.registered'
                  and metadata ->> 'name' = 'Doomed Co'),
  'atomicity: no orphaned company, membership or audit row after a mid-registration failure');

drop trigger test_fail on public.subscriptions;
drop function test.fail_subscription_insert();

select test.login(test.id('plain'));
select test.ok((select public.register_company('Plain Works Ltd')) is not null,
  'after the failure is removed, the same user can register successfully');
select test.logout();

-- Put "plain" back to a user with no company so later files can reuse it.
delete from public.companies where name = 'Plain Works Ltd';
select test.ok(not exists (select 1 from public.company_members where user_id = test.id('plain')),
  'fixture reset: deleting a company cascades its membership and subscription');
