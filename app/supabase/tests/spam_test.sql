-- Spam and abuse protection for the public enquiry and application forms. Run after the migrations on an empty database.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', id, false)
$$;
/** Runs a statement and checks it fails with exactly this message. */
create function pg_temp.raises(stmt text, expected text, label text) returns void language plpgsql as $$
declare got text;
begin
  begin
    execute stmt;
  exception when others then
    got := sqlerrm;
  end;
  if got is distinct from expected then raise exception 'FAILED: % (got: %)', label, coalesce(got, 'no error'); end if;
  raise notice 'ok - %', label;
end $$;
/** Runs a statement and checks it is stopped by the rate limit (HTTP 429). */
create function pg_temp.limited(stmt text, label text) returns void language plpgsql as $$
declare got text; hint text;
begin
  begin
    execute stmt;
  exception when sqlstate 'PT429' then
    got := sqlerrm;
    get stacked diagnostics hint = pg_exception_hint;
  end;
  if got is distinct from 'Thank you. We have received several messages from you in a short time, so we have paused further '
      || 'submissions for now. We will be in touch shortly; if your enquiry is urgent, please email craig@craigobrieneducation.com.'
     or hint is distinct from 'rate_limited' then
    raise exception 'FAILED: % (got: %)', label, coalesce(got, 'no error');
  end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.enquire(p_email text, p_message text, p_elapsed integer default 8000, p_name text default 'Amira Haddad',
  p_student text default 'Layla', p_source text default 'website', p_pass uuid default null) returns uuid language sql as $$
  select public.submit_enquiry(p_name, p_email, null, p_student, 'IB', 'Year 9', p_message, 'Weekday evenings', p_source,
    p_elapsed_ms => p_elapsed, p_captcha_pass => p_pass)
$$;
create function pg_temp.apply(p_email text, p_curricula text[] default '{IB}', p_phases text[] default '{Primary}',
  p_experience text default 'Five years teaching IB Mathematics', p_elapsed integer default 8000, p_cv text default null,
  p_source text default 'website', p_name text default 'Nora Khalil') returns uuid language sql as $$
  select public.submit_tutor_application(p_name, p_email, null, p_curricula, 'Mathematics', p_experience, 'PGCE', 'Evenings', p_cv,
    p_phases, p_elapsed_ms => p_elapsed, p_source => p_source)
$$;
create temp table ids (k text primary key, id uuid);
grant all on ids to anon, authenticated;
create temp table counts (k text primary key, n bigint);
grant all on counts to anon, authenticated;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'boss@x'),
  ('a0000000-0000-0000-0000-00000000000c', 'mum@x');
insert into public.families (id, name, parent_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Boss', 'boss@x', null, null),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001');

-- Helpers ----------------------------------------------------------------------
select pg_temp.check(public.normalise_message('  Hello,  WORLD!!  مرحبا ') = 'hello world مرحبا', 'messages are normalised and Arabic survives');
select pg_temp.check(public.message_similarity('a b c', 'a b d') = 0.5, 'similarity is the share of shared words');
select pg_temp.check(public.message_similarity('', 'anything') = 1, 'an empty message matches anything');
select pg_temp.check(public.count_links('HTTP://a.example, https://b.example and WWW.c.example') = 3, 'links are counted case-insensitively');

-- Private tables and functions --------------------------------------------------
set role anon;
select pg_temp.as_user('');
do $$ begin
  perform count(*) from public.submission_log;
  raise exception 'anon read the submission log';
exception when insufficient_privilege then raise notice 'ok - the public cannot read the submission log';
end $$;
do $$ begin
  perform count(*) from public.captcha_passes;
  raise exception 'anon read captcha passes';
exception when insufficient_privilege then raise notice 'ok - the public cannot read security-check passes';
end $$;
do $$ begin
  perform public.request_ip_hash();
  raise exception 'anon called request_ip_hash';
exception when insufficient_privilege then raise notice 'ok - the public cannot call request_ip_hash';
end $$;
do $$ begin
  perform public.consume_captcha_pass(gen_random_uuid(), 'enquiry');
  raise exception 'anon called consume_captcha_pass';
exception when insufficient_privilege then raise notice 'ok - the public cannot use up passes directly';
end $$;
reset role;

-- A clean enquiry ----------------------------------------------------------------
set role anon;
insert into ids select 'clean', pg_temp.enquire('Amira@X', 'We would like help with IB Maths revision before the exams');
reset role;
select pg_temp.check((select spam_status = 'clean' and spam_reasons = '{}' and last_submitted_at is not null
  from public.enquiries where id = (select id from ids where k = 'clean')), 'a normal website enquiry is stored clean');
select pg_temp.check(exists (select 1 from public.notification_outbox where subject = 'New enquiry: Amira Haddad'), 'the office is told');
select pg_temp.check(exists (select 1 from public.notification_outbox where email = 'amira@x' and subject = 'Thank you for contacting Elite Education'),
  'the enquirer is thanked');
select pg_temp.check((select count(*) from public.submission_log where email = 'amira@x' and outcome = 'accepted' and kind = 'enquiry') = 1,
  'the submission is logged with a lower-case email');
insert into counts select 'outbox', count(*) from public.notification_outbox;

-- The same enquiry again is folded into the first ----------------------------------
set role anon;
insert into ids select 'dup', pg_temp.enquire('amira@x', 'we would like help with IB maths revision, before the exams!!');
reset role;
select pg_temp.check((select id from ids where k = 'dup') = (select id from ids where k = 'clean'), 'a near-identical re-send returns the same enquiry');
select pg_temp.check((select repeat_count from public.enquiries where id = (select id from ids where k = 'clean')) = 1, 'the repeat is counted');
select pg_temp.check((select count(*) from public.enquiries where email = 'amira@x') = 1, 'still one enquiry');
select pg_temp.check((select count(*) from public.notification_outbox) = (select n from counts where k = 'outbox'), 'a merged re-send sends nothing');
select pg_temp.check(exists (select 1 from public.submission_log where email = 'amira@x' and outcome = 'merged'), 'the merge is logged');

-- A different message from the same person is a new enquiry
set role anon;
insert into ids select 'different', pg_temp.enquire('amira@x', 'Could you recommend a tutor for Arabic speaking practice at weekends');
reset role;
select pg_temp.check((select count(*) from public.enquiries where email = 'amira@x') = 2, 'a clearly different message is a new enquiry');

-- A fourth in the hour is paused
set role anon;
select pg_temp.limited($q$select pg_temp.enquire('amira@x', 'Another completely separate question about chemistry')$q$,
  'a fourth enquiry from one email within the hour is paused with HTTP 429');
reset role;
select pg_temp.check((select count(*) from public.submission_log where email = 'amira@x') = 3, 'the paused attempt is not logged');

-- An hour later the limit has lifted
update public.submission_log set created_at = now() - interval '2 hours' where email = 'amira@x';
set role anon;
select pg_temp.check(pg_temp.enquire('amira@x', 'Another completely separate question about chemistry') is not null,
  'the hourly limit lifts after an hour');
reset role;

-- Per connection -------------------------------------------------------------------
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}', false);
set role anon;
select pg_temp.enquire('ip' || i || '@x', 'Question number ' || i || ' about ' || repeat('topic' || i || ' ', 3)) from generate_series(1, 5) i;
select pg_temp.limited($q$select pg_temp.enquire('ip6@x', 'A sixth question entirely')$q$, 'a sixth enquiry from one connection within the hour is paused');
reset role;
select pg_temp.check((select count(*) from public.submission_log
  where ip_hash = encode(sha256(convert_to('elite-education:203.0.113.9', 'UTF8')), 'hex')) = 5,
  'the first forwarded address is fingerprinted');
select pg_temp.check(not exists (select 1 from public.submission_log where ip_hash like '%203.0.113%'), 'raw addresses are never stored');
select set_config('request.headers', '{"cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9"}', false);
set role anon;
select pg_temp.check(pg_temp.enquire('ip7@x', 'A question from another connection') is not null, 'a different connection is still accepted');
reset role;
select pg_temp.check(exists (select 1 from public.submission_log
  where email = 'ip7@x' and ip_hash = encode(sha256(convert_to('elite-education:198.51.100.7', 'UTF8')), 'hex')),
  'the Cloudflare address header comes first');
select set_config('request.headers', 'not json', false);
select pg_temp.check(public.request_ip_hash() is null, 'unreadable headers give no fingerprint');
select set_config('request.headers', '', false);

-- Flags ------------------------------------------------------------------------------
set role anon;
insert into ids select 'links', pg_temp.enquire('links@x', 'See http://a.example and https://b.example and www.c.example');
insert into ids select 'namelink', pg_temp.enquire('nl@x', 'Hello there', p_name => 'Visit www.spam.example');
insert into ids select 'fast', pg_temp.enquire('fast@x', 'Hello there', 900);
insert into ids select 'combo', pg_temp.enquire('combo@x', 'http://a http://b http://c', 100, 'http://x.example');
insert into ids select 'slow', pg_temp.enquire('slow@x', 'Hello there', null);
reset role;
select pg_temp.check((select id from ids where k = 'links') is not null, 'a flagged enquiry still returns an id');
select pg_temp.check((select spam_status = 'suspected' and spam_reasons = '{links}' from public.enquiries where id = (select id from ids where k = 'links')),
  'three links mark an enquiry as suspected');
select pg_temp.check(not exists (select 1 from public.notification_outbox where email = 'links@x' or subject like 'New enquiry: Link%'
  or body like '%links@x%'), 'a suspected enquiry neither alerts the office nor emails the address');
select pg_temp.check((select spam_reasons from public.enquiries where id = (select id from ids where k = 'namelink')) = '{link-in-name}',
  'a link in a name is flagged');
select pg_temp.check((select spam_reasons from public.enquiries where id = (select id from ids where k = 'fast')) = '{too-fast}',
  'a form completed in under three seconds is flagged');
select pg_temp.check((select spam_reasons from public.enquiries where id = (select id from ids where k = 'combo')) = '{link-in-name,links,too-fast}',
  'reasons are listed in a fixed order');
select pg_temp.check((select spam_status from public.enquiries where id = (select id from ids where k = 'slow')) = 'clean',
  'an unknown completion time is never flagged');
select pg_temp.check((select count(*) from public.submission_log where outcome = 'flagged') = 4, 'flagged submissions are logged');

-- Security check (Cloudflare Turnstile) ----------------------------------------------------
update public.settings set captcha_required = true;
insert into public.captcha_passes (id, form) values ('90000000-0000-0000-0000-000000000001', 'enquiry');
insert into public.captcha_passes (id, form) values ('90000000-0000-0000-0000-000000000002', 'application');
insert into public.captcha_passes (id, form, created_at) values ('90000000-0000-0000-0000-000000000003', 'enquiry', now() - interval '20 minutes');
set role anon;
insert into ids select 'cap1', pg_temp.enquire('cap1@x', 'Hello there');
insert into ids select 'cap2', pg_temp.enquire('cap2@x', 'Hello there', p_pass => '90000000-0000-0000-0000-000000000001');
insert into ids select 'cap3', pg_temp.enquire('cap3@x', 'Hello there', p_pass => '90000000-0000-0000-0000-000000000001');
insert into ids select 'cap4', pg_temp.enquire('cap4@x', 'Hello there', p_source => 'app');
insert into ids select 'cap5', pg_temp.enquire('cap5@x', 'Hello there', p_pass => '90000000-0000-0000-0000-000000000002');
insert into ids select 'cap6', pg_temp.enquire('cap6@x', 'Hello there', p_pass => '90000000-0000-0000-0000-000000000003');
reset role;
select pg_temp.check((select spam_reasons from public.enquiries where id = (select id from ids where k = 'cap1')) = '{captcha}',
  'a website enquiry without the security check is flagged when it is required');
select pg_temp.check((select spam_status from public.enquiries where id = (select id from ids where k = 'cap2')) = 'clean',
  'a valid pass keeps the enquiry clean');
select pg_temp.check((select used_at is not null from public.captcha_passes where id = '90000000-0000-0000-0000-000000000001'), 'the pass is used up');
select pg_temp.check((select spam_reasons from public.enquiries where id = (select id from ids where k = 'cap3')) = '{captcha}',
  'a pass cannot be used twice');
select pg_temp.check((select spam_status from public.enquiries where id = (select id from ids where k = 'cap4')) = 'clean',
  'the app is not asked for the security check');
select pg_temp.check((select spam_reasons from public.enquiries where id = (select id from ids where k = 'cap5')) = '{captcha}',
  'a pass only works for its own form');
select pg_temp.check((select spam_reasons from public.enquiries where id = (select id from ids where k = 'cap6')) = '{captcha}',
  'a pass expires after ten minutes');
update public.settings set captcha_required = false;

-- Size limits ------------------------------------------------------------------------------
set role anon;
select pg_temp.raises($q$select pg_temp.enquire('big@x', 'Hi', p_name => repeat('a', 201))$q$,
  'Please shorten the name to 200 characters or fewer', 'a very long name is refused politely');
select pg_temp.raises($q$select pg_temp.enquire('big@x', 'Hi', p_student => repeat('a', 201))$q$,
  'Please shorten the name to 200 characters or fewer', 'a very long student name is refused politely');
select pg_temp.raises($q$select pg_temp.enquire(repeat('a', 199) || '@x', 'Hi')$q$,
  'Please check the email address or telephone number', 'a very long email is refused politely');
select pg_temp.raises($q$select public.submit_enquiry('Big', null, repeat('1', 51), null, null, null, null, null, 'website')$q$,
  'Please check the email address or telephone number', 'a very long telephone number is refused politely');
select pg_temp.raises($q$select pg_temp.enquire('big@x', repeat('a', 4001))$q$,
  'Please shorten your message to 4,000 characters or fewer', 'a very long message is refused politely');
select pg_temp.raises($q$select public.submit_enquiry('Big', 'big@x', null, null, null, null, null, repeat('a', 1001), 'website')$q$,
  'Please shorten your answers a little', 'very long preferred times are refused politely');
select pg_temp.raises($q$select public.submit_enquiry('Big', 'big@x', null, null, null, repeat('a', 101), null, null, 'website')$q$,
  'Please shorten your answers a little', 'a very long year group is refused politely');
select pg_temp.raises($q$select pg_temp.enquire('big@x', repeat('a', 4000))$q$, null, 'a 4,000-character message is accepted');
reset role;

-- The office is never limited or flagged ------------------------------------------------------
insert into counts select 'log', count(*) from public.submission_log;
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into ids select 'admin' || i, pg_temp.enquire('amira@x', 'Same text http://a http://b http://c', 10, 'Amira www.x', 'Layla', 'website')
  from generate_series(1, 7) i;
reset role;
select pg_temp.check((select count(*) from public.enquiries e join ids on ids.id = e.id and ids.k like 'admin%'
  where e.spam_status = 'clean' and e.spam_reasons = '{}') = 7, 'an admin can enter enquiries beyond the limits, never flagged or merged');
select pg_temp.check((select count(*) from public.submission_log) = (select n from counts where k = 'log'), 'admin entries are not logged');

-- Marking spam ------------------------------------------------------------------------------------
set role anon;
do $$ begin
  perform public.set_submission_spam('enquiry', (select id from ids where k = 'links'), true);
  raise exception 'anon marked spam';
exception when sqlstate '42501' then raise notice 'ok - the public cannot mark spam';
end $$;
reset role;
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000c');
do $$ begin
  perform public.set_submission_spam('enquiry', (select id from ids where k = 'links'), true);
  raise exception 'parent marked spam';
exception when sqlstate '42501' then
  if sqlerrm <> 'Only an administrator can do this' then raise; end if;
  raise notice 'ok - a parent cannot mark spam';
end $$;
do $$ begin
  perform count(*) from public.submission_log;
  if (select count(*) from public.submission_log) > 0 then raise exception 'FAILED: a parent read the submission log'; end if;
  raise notice 'ok - a parent sees nothing in the submission log';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.submission_log) > 0, 'an admin can read the submission log');
select public.set_submission_spam('enquiry', (select id from ids where k = 'links'), true);
reset role;
select pg_temp.check((select spam_status from public.enquiries where id = (select id from ids where k = 'links')) = 'spam', 'an admin marks spam');
set role anon;
select pg_temp.as_user('');
insert into ids select 'links2', pg_temp.enquire('links@x', 'See http://a.example and https://b.example and www.c.example');
reset role;
select pg_temp.check((select id from ids where k = 'links2') <> (select id from ids where k = 'links'), 'nothing is merged into spam');
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select public.set_submission_spam('enquiry', (select id from ids where k = 'links'), false);
reset role;
select pg_temp.check((select spam_status = 'clean' and spam_reasons = '{links}' from public.enquiries where id = (select id from ids where k = 'links')),
  'not spam returns it to clean and keeps the reasons on record');

-- Tutor applications ----------------------------------------------------------------------------------
set role anon;
select pg_temp.as_user('');
insert into ids select 'app', pg_temp.apply('nora@x');
reset role;
select pg_temp.check((select spam_status from public.tutor_applications where id = (select id from ids where k = 'app')) = 'clean',
  'a normal application is clean');
select pg_temp.check(exists (select 1 from public.notification_outbox where subject = 'Tutor application: Nora Khalil')
  and exists (select 1 from public.notification_outbox where email = 'nora@x' and subject = 'Thank you for applying to Elite Education'),
  'the office is told and the applicant is thanked');
delete from counts where k = 'outbox';
insert into counts select 'outbox', count(*) from public.notification_outbox;
set role anon;
insert into ids select 'app2', pg_temp.apply('NORA@x', '{IGCSE,IB}', '{Lower Secondary}',
  'Five years teaching IB Mathematics and three years of IGCSE Physics', p_cv => 'cv/nora.pdf');
reset role;
select pg_temp.check((select id from ids where k = 'app2') = (select id from ids where k = 'app'), 'a second application within a day is merged');
select pg_temp.check((select curricula::text || phases::text || repeat_count || cv_path || experience from public.tutor_applications
  where email = 'nora@x') = '{IB,IGCSE}{Primary,"Lower Secondary"}1cv/nora.pdfFive years teaching IB Mathematics and three years of IGCSE Physics',
  'curricula and phases are combined, the longer experience and the CV are kept');
select pg_temp.check((select count(*) from public.notification_outbox) = (select n from counts where k = 'outbox'), 'a merged application sends nothing');
set role anon;
select pg_temp.limited($q$select pg_temp.apply('nora@x')$q$, 'a third application from one email within the hour is paused');
insert into ids select 'appfast', pg_temp.apply('fastapp@x', p_elapsed => 500);
reset role;
select pg_temp.check((select spam_reasons from public.tutor_applications where id = (select id from ids where k = 'appfast')) = '{too-fast}',
  'a rushed application is flagged');
select pg_temp.check(not exists (select 1 from public.notification_outbox where email = 'fastapp@x'), 'a flagged application sends nothing');

-- The 30-day rule still applies to fresh applications
insert into public.tutor_applications (full_name, email, created_at) values
  ('Olga Old', 'old@x', now() - interval '5 days'), ('Olga Old', 'old@x', now() - interval '4 days');
set role anon;
select pg_temp.raises($q$select pg_temp.apply('old@x')$q$, 'We already have your application — we''ll be in touch soon',
  'two applications in 30 days are still enough');

-- Per connection, and the security check
select set_config('request.headers', '{"x-real-ip": "192.0.2.50"}', false);
select pg_temp.apply('a' || i || '@x') from generate_series(1, 3) i;
select pg_temp.limited($q$select pg_temp.apply('a4@x')$q$, 'a fourth application from one connection within the hour is paused');
select set_config('request.headers', '', false);
reset role;
update public.settings set captcha_required = true;
set role anon;
insert into ids select 'appcap', pg_temp.apply('cap@x');
insert into ids select 'appcapapp', pg_temp.apply('capapp@x', p_source => 'app');
reset role;
select pg_temp.check((select spam_reasons from public.tutor_applications where id = (select id from ids where k = 'appcap')) = '{captcha}',
  'a website application without the security check is flagged when required');
select pg_temp.check((select spam_status from public.tutor_applications where id = (select id from ids where k = 'appcapapp')) = 'clean',
  'an application from the app is not asked for the security check');
update public.settings set captcha_required = false;

-- Application size limits
set role anon;
select pg_temp.raises($q$select pg_temp.apply('big@x', p_name => repeat('a', 201))$q$,
  'Please shorten the name to 200 characters or fewer', 'a very long applicant name is refused politely');
select pg_temp.raises($q$select pg_temp.apply('big@x', p_experience => repeat('a', 4001))$q$,
  'Please shorten your message to 4,000 characters or fewer', 'a very long experience is refused politely');
select pg_temp.raises($q$select pg_temp.apply('big@x', array(select 'c' || i from generate_series(1, 21) i))$q$,
  'Please shorten your answers a little', 'too many curricula are refused politely');
select pg_temp.raises($q$select pg_temp.apply('big@x', p_phases => array(select 'p' || i from generate_series(1, 11) i))$q$,
  'Please choose up to ten phases', 'the ten-phase rule still applies');
reset role;

-- The office can enter applications without limits
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select pg_temp.check(pg_temp.apply('nora@x', p_elapsed => 1) is not null, 'an admin can enter an application beyond the limits');
reset role;
select pg_temp.check((select count(*) from public.tutor_applications where email = 'nora@x' and spam_status = 'clean') = 2,
  'the admin entry is a separate, clean application');
\echo 'All spam tests passed'
