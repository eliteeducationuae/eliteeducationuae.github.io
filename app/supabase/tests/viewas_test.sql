-- Admin "View as" (read only): starting and ending views, the PostgREST guard, read-only transactions, storage and
-- auth protection, and privileges.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, false) $$;
-- Runs a statement and returns 'SQLSTATE: message' when it fails, or null when it succeeds.
create function pg_temp.err(q text) returns text language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
-- Sets up a PostgREST-like request for the current user: the session id claim, the method and the path.
create function pg_temp.req(sid text, m text, p text) returns void language sql as $$
  select set_config('request.jwt.claims',
           jsonb_build_object('sub', nullif(current_setting('request.jwt.claim.sub', true), ''), 'session_id', sid)::text, false),
         set_config('request.jwt.claim.session_id', '', false),
         set_config('request.method', m, false),
         set_config('request.path', p, false)
$$;
-- The guard's verdict for a request: null when it passes, otherwise the error.
create function pg_temp.guard(sid text, m text, p text) returns text language plpgsql as $$
begin
  perform pg_temp.req(sid, m, p);
  return pg_temp.err('select public.view_as_guard()');
end $$;

\set view_only '''42501: Viewing only — changes are disabled.'''
\set view_ended '''42501: This view has ended. Please return to your own account.'''

-- Two admins (Boss and Bea), tutor Tia, parent Mona and student Sami.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'boss@x'),
  ('a0000000-0000-0000-0000-000000000002', 'bea@x'),
  ('a0000000-0000-0000-0000-000000000003', 'tutor@x'),
  ('a0000000-0000-0000-0000-000000000004', 'mum@x'),
  ('a0000000-0000-0000-0000-000000000005', 'sami@x');
insert into public.tutors (id, full_name, email) values ('b0000000-0000-0000-0000-000000000001', 'Tia Tutor', 'tutor@x');
insert into public.families (id, name, parent_name, email) values ('c0000000-0000-0000-0000-000000000001', 'Ahmed', 'Mona Ahmed', 'mum@x');
insert into public.students (id, family_id, full_name, phase) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Sami Ahmed', 'Sixth Form and IB Diploma');
insert into public.profiles (id, role, full_name, email, tutor_id, family_id, student_id) values
  ('a0000000-0000-0000-0000-000000000001', 'admin', 'Boss', 'boss@x', null, null, null),
  ('a0000000-0000-0000-0000-000000000002', 'admin', 'Bea', 'bea@x', null, null, null),
  ('a0000000-0000-0000-0000-000000000003', 'tutor', 'Tia Tutor', 'tutor@x', 'b0000000-0000-0000-0000-000000000001', null, null),
  ('a0000000-0000-0000-0000-000000000004', 'parent', 'Mona Ahmed', 'mum@x', null, 'c0000000-0000-0000-0000-000000000001', null),
  ('a0000000-0000-0000-0000-000000000005', 'student', 'Sami Ahmed', 'sami@x', null, null, 'd0000000-0000-0000-0000-000000000001');

-- (a) Only the service role can start a view ---------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select pg_temp.check(pg_temp.err($q$select public.begin_view_as('a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001')$q$) like '42501:%',
  'a signed-in admin cannot call begin_view_as directly');
reset role;
set role anon;
select pg_temp.check(pg_temp.err($q$select public.begin_view_as('a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001')$q$) like '42501:%',
  'the public cannot call begin_view_as');
reset role;

-- (b) Who may view whom ------------------------------------------------------------------------------------------
set role service_role;
select pg_temp.check(pg_temp.err($q$select public.begin_view_as('a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000009')$q$) is not null,
  'a tutor cannot start a view');
select pg_temp.check(pg_temp.err($q$select public.begin_view_as('a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000009')$q$) is not null,
  'an admin cannot view another admin');
select pg_temp.check(pg_temp.err($q$select public.begin_view_as('a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000009')$q$) is not null,
  'an admin cannot view themself');
select pg_temp.check(pg_temp.err($q$select public.begin_view_as('a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-0000000000ff', 'e0000000-0000-0000-0000-000000000009')$q$) is not null,
  'a view needs a real person');

-- (c) Starting views: Boss views Mona (view 1) and Tia (view 2, asked for three hours), Bea views Sami (view 3) ----
select pg_temp.check((select r.admin_id = 'a0000000-0000-0000-0000-000000000001' and r.target_id = 'a0000000-0000-0000-0000-000000000004'
    and r.ended_at is null and r.expires_at between now() + interval '59 minutes' and now() + interval '61 minutes'
  from public.begin_view_as('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004',
                            'e0000000-0000-0000-0000-000000000001') r), 'a view of a parent starts and lasts 60 minutes');
select pg_temp.check((select r.expires_at <= now() + interval '60 minutes'
  from public.begin_view_as('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003',
                            'e0000000-0000-0000-0000-000000000002', 180) r), 'a view never lasts longer than 60 minutes');
select pg_temp.check((select r.expires_at between now() and now() + interval '2 minutes'
  from public.begin_view_as('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005',
                            'e0000000-0000-0000-0000-000000000003', 0) r), 'a view lasts at least a minute');
select pg_temp.check(pg_temp.err($q$select public.begin_view_as('a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001')$q$) is not null,
  'a session can belong to only one view');
reset role;
select pg_temp.check((select count(*) = 1 from public.view_as_audit a join public.view_as_sessions v on v.id = a.view_id
  where v.session_id = 'e0000000-0000-0000-0000-000000000001' and a.action = 'start'
    and a.admin_id = 'a0000000-0000-0000-0000-000000000001' and a.target_id = 'a0000000-0000-0000-0000-000000000004'),
  'starting a view writes one start audit row');
-- The auth sessions GoTrue created for the three views, each with a refresh token, plus Bea's own session.
insert into auth.sessions (id, user_id) values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004'),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003'),
  ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005'),
  ('e0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-000000000002');
insert into auth.refresh_tokens (token, user_id, session_id) values
  ('t1', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001'),
  ('t2', 'a0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002'),
  ('t3', 'a0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) = 3 from public.view_as_audit where action = 'start'), 'every view start is audited');

-- (d) The guard in a view: reads pass, writes and non-read RPCs are refused -------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'GET', '/lessons') is null, 'a view can read lessons');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'HEAD', '/lessons') is null, 'a view can count lessons');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'POST', '/lessons') = :view_only, 'a view cannot add a lesson');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'PATCH', '/families') = :view_only, 'a view cannot change a family');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'DELETE', '/messages') = :view_only, 'a view cannot delete messages');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'PUT', '/profiles') = :view_only, 'a view cannot upsert');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'POST', '/rpc/send_message') = :view_only, 'a view cannot send a message');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'POST', '/rpc/mark_thread_read') = :view_only,
  'a view does not mark threads as read');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'GET', '/rpc/set_whatsapp') = :view_only,
  'a write RPC is refused even over GET');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'POST', '/rpc/my_threads') is null, 'a view can list message threads');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'GET', '/rpc/list_resources') is null, 'a view can list resources');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'POST', '/rest/v1/rpc/open_slots') is null,
  'the RPC name is found anywhere in the path');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'POST', '/rpc/my_threads_and_more') = :view_only,
  'only exact RPC names are allowed');
-- The older single-claim form is read too.
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.session_id', 'e0000000-0000-0000-0000-000000000001', false),
  set_config('request.method', 'POST', false), set_config('request.path', '/lessons', false);
select pg_temp.check(pg_temp.err('select public.view_as_guard()') = :view_only, 'the request.jwt.claim.session_id form is recognised');
reset role;

-- (e) After the guard passes in a view, the rest of the request cannot write --------------------------------------
begin;
set local role authenticated;
select pg_temp.req('e0000000-0000-0000-0000-000000000001', 'POST', '/rpc/my_threads');
select public.view_as_guard();
select pg_temp.check(current_setting('transaction_read_only') = 'on', 'a view request runs read-only');
select pg_temp.check(pg_temp.err($q$insert into public.view_as_audit (action) values ('start')$q$) like '25006:%',
  'an insert in a view request fails as read-only, even one a definer function could make');
rollback;
reset role;
-- Boss's own view of Tia (view 2) would be ended by end_view_as, but not from inside a view request.
begin;
set local role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select pg_temp.req('e0000000-0000-0000-0000-000000000002', 'POST', '/rpc/my_threads');
select public.view_as_guard();
select pg_temp.check(pg_temp.err(format('select public.end_view_as(%L)',
    (select id from public.view_as_sessions where session_id = 'e0000000-0000-0000-0000-000000000002'))) like '25006:%',
  'a definer function that writes fails as read-only in a view request');
rollback;
reset role;
-- The same check where earlier statements in the transaction have already run (as PostgREST does).
begin;
select count(*) from public.profiles;
set local role authenticated;
select pg_temp.req('e0000000-0000-0000-0000-000000000001', 'GET', '/lessons');
select public.view_as_guard();
select pg_temp.check(current_setting('transaction_read_only') = 'on', 'read-only can be switched on after earlier queries');
rollback;
reset role;

-- (f) Normal sessions are not affected -----------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-0000000000aa', 'POST', '/lessons') is null, 'another session can add a lesson');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-0000000000aa', 'POST', '/rpc/send_message') is null, 'another session can send a message');
select pg_temp.check(pg_temp.guard(null, 'POST', '/lessons') is null, 'a request without a session id passes');
select pg_temp.check(pg_temp.guard('not-a-uuid', 'DELETE', '/messages') is null, 'a malformed session id is not a view');
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.session_id', '', false);
select pg_temp.check(pg_temp.err('select public.view_as_guard()') is null, 'a request without claims passes');
reset role;
begin;
set local role authenticated;
select pg_temp.req('e0000000-0000-0000-0000-0000000000aa', 'POST', '/lessons');
select public.view_as_guard();
select pg_temp.check(current_setting('transaction_read_only') = 'off', 'a normal request stays writable');
rollback;
reset role;

-- (i) Recognising a view session ---------------------------------------------------------------------------------
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
select pg_temp.req('e0000000-0000-0000-0000-000000000001', 'POST', '/rpc/is_view_as_session');
select pg_temp.check(public.is_view_as_session(), 'a view session is recognised');
select pg_temp.check((select id is not null and target_id = 'a0000000-0000-0000-0000-000000000004' from public.current_view_as()),
  'current_view_as returns the view');
select pg_temp.req('e0000000-0000-0000-0000-0000000000aa', 'POST', '/rpc/is_view_as_session');
select pg_temp.check(not public.is_view_as_session(), 'a normal session is not a view');
select pg_temp.check((select id is null from public.current_view_as()), 'current_view_as is null for a normal session');
select pg_temp.req(null, 'POST', '/rpc/is_view_as_session');
select pg_temp.check(not public.is_view_as_session(), 'no session is not a view');

-- (l) Only admins can read views and the audit --------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) = 3 from public.view_as_sessions), 'an admin can see every view');
select pg_temp.check((select count(*) = 3 from public.view_as_audit), 'an admin can read the audit');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
select pg_temp.check((select count(*) = 0 from public.view_as_sessions), 'a parent cannot see views, even of their own account');
select pg_temp.check((select count(*) = 0 from public.view_as_audit), 'a parent cannot read the audit');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select pg_temp.check(pg_temp.err($q$insert into public.view_as_sessions (admin_id, target_id, session_id, expires_at)
    values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', gen_random_uuid(), now())$q$) like '42501:%',
  'even an admin cannot add views directly');
select pg_temp.check(pg_temp.err($q$update public.view_as_sessions set expires_at = now() + interval '1 day'$q$) like '42501:%',
  'even an admin cannot extend a view directly');
select pg_temp.check(pg_temp.err($q$delete from public.view_as_audit$q$) like '42501:%', 'nobody can delete the audit');
reset role;

-- (k) The person's sign-in details are protected during an active view --------------------------------------------
select pg_temp.check(pg_temp.err($q$update auth.users set email = 'new@x' where id = 'a0000000-0000-0000-0000-000000000004'$q$)
  = '42501: Account details cannot be changed while the office is viewing this account.', 'the email cannot change during a view');
select pg_temp.check(pg_temp.err($q$update auth.users set encrypted_password = 'x' where id = 'a0000000-0000-0000-0000-000000000004'$q$)
  is not null, 'the password cannot change during a view');
select pg_temp.check(pg_temp.err($q$update auth.users set phone = '+971500000000' where id = 'a0000000-0000-0000-0000-000000000004'$q$)
  is not null, 'the phone cannot change during a view');
select pg_temp.check(pg_temp.err($q$update auth.users set raw_user_meta_data = '{"a":1}' where id = 'a0000000-0000-0000-0000-000000000004'$q$)
  is null, 'other sign-in bookkeeping still updates during a view');
select pg_temp.check(pg_temp.err($q$update auth.users set email = 'new-bea@x' where id = 'a0000000-0000-0000-0000-000000000002'$q$)
  is null, 'people who are not being viewed can change their email');
update auth.users set email = 'bea@x' where id = 'a0000000-0000-0000-0000-000000000002';
select pg_temp.check(pg_temp.err($q$insert into auth.mfa_factors (user_id) values ('a0000000-0000-0000-0000-000000000004')$q$)
  like '42501:%', 'a second factor cannot be added during a view');
select pg_temp.check(pg_temp.err($q$insert into auth.identities (user_id) values ('a0000000-0000-0000-0000-000000000004')$q$)
  like '42501:%', 'another sign-in cannot be linked during a view');
select pg_temp.check(pg_temp.err($q$insert into auth.identities (user_id) values ('a0000000-0000-0000-0000-000000000002')$q$)
  is null, 'people who are not being viewed can link a sign-in');
select pg_temp.check(pg_temp.err($q$insert into auth.refresh_tokens (token, user_id, session_id)
    values ('t1b', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001')$q$) is null,
  'an active view can refresh its session');
select pg_temp.check(pg_temp.err($q$insert into auth.refresh_tokens (token, user_id, session_id)
    values ('tb', 'a0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-0000000000b0')$q$) is null,
  'ordinary sessions refresh as normal');

-- (h) Ending a view --------------------------------------------------------------------------------------------------
\set view1 '(select id from public.view_as_sessions where session_id = ''e0000000-0000-0000-0000-000000000001'')'
select set_config('test.view1', :view1::text, false);
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
select pg_temp.req(null, 'POST', '/rpc/end_view_as');
select pg_temp.check(pg_temp.err(format('select public.end_view_as(%L)', current_setting('test.view1'))) like '42501:%',
  'a parent cannot end a view');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
select pg_temp.check(pg_temp.err(format('select public.end_view_as(%L)', current_setting('test.view1'))) like '42501:%',
  'another admin cannot end the view');
select pg_temp.check(pg_temp.err($q$select public.end_view_as('00000000-0000-0000-0000-000000000000')$q$) like '42501:%',
  'an unknown view cannot be ended');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select public.end_view_as(current_setting('test.view1')::uuid);
select public.end_view_as(current_setting('test.view1')::uuid);
reset role;
select pg_temp.check((select ended_at is not null from public.view_as_sessions where id = current_setting('test.view1')::uuid),
  'the owning admin ends the view');
select pg_temp.check((select count(*) = 1 from public.view_as_audit where view_id = current_setting('test.view1')::uuid and action = 'end'
    and admin_id = 'a0000000-0000-0000-0000-000000000001'), 'ending writes one end audit row, however often it is called');
select pg_temp.check(not exists (select 1 from auth.sessions where id = 'e0000000-0000-0000-0000-000000000001')
  and not exists (select 1 from auth.refresh_tokens where session_id = 'e0000000-0000-0000-0000-000000000001')
  and (select revoked_at is not null from public.view_as_sessions where id = current_setting('test.view1')::uuid),
  'ending a view revokes its auth session and refresh tokens on the server');
select pg_temp.check(exists (select 1 from auth.sessions where id = 'e0000000-0000-0000-0000-000000000002'),
  'ending one view leaves other sessions alone');
select pg_temp.check(pg_temp.err($q$insert into auth.refresh_tokens (token, user_id, session_id)
    values ('t1c', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001')$q$) like '42501:%',
  'an ended view cannot refresh its session');

-- (k, continued) Once the view has ended, the person can change their details again.
select pg_temp.check(pg_temp.err($q$update auth.users set email = 'new@x' where id = 'a0000000-0000-0000-0000-000000000004'$q$) is null,
  'the email can change once the view has ended');

-- (g) Ended and expired views are refused outright -------------------------------------------------------------------
update public.view_as_sessions set expires_at = now() - interval '1 minute' where session_id = 'e0000000-0000-0000-0000-000000000002';
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000002', 'GET', '/lessons') = :view_ended, 'an expired view cannot even read');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000002', 'POST', '/rpc/my_threads') = :view_ended,
  'an expired view cannot call read RPCs');
select pg_temp.req('e0000000-0000-0000-0000-000000000002', 'POST', '/rpc/is_view_as_session');
select pg_temp.check(public.is_view_as_session(), 'an expired view is still recognised as a view');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
select pg_temp.check(pg_temp.guard('e0000000-0000-0000-0000-000000000001', 'GET', '/lessons') = :view_ended, 'an ended view cannot even read');
reset role;
select pg_temp.check(pg_temp.err($q$insert into auth.refresh_tokens (token, user_id, session_id)
    values ('t2b', 'a0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002')$q$) like '42501:%',
  'an expired view cannot refresh its session');
-- An expired view that was never ended (the app was closed) still has a live access token for up to an hour.
select pg_temp.check(pg_temp.err($q$update auth.users set email = 'tutor2@x' where id = 'a0000000-0000-0000-0000-000000000003'$q$)
  like '42501:%', 'an expired view that was not revoked protects the email while its last token can still be used');
update public.view_as_sessions set expires_at = now() - interval '2 hours' where session_id = 'e0000000-0000-0000-0000-000000000002';
select pg_temp.check(pg_temp.err($q$update auth.users set email = 'tutor2@x' where id = 'a0000000-0000-0000-0000-000000000003'$q$) is null,
  'once its last token has run out, an expired view no longer protects the email');
select pg_temp.check(pg_temp.err($q$insert into auth.mfa_factors (user_id) values ('a0000000-0000-0000-0000-000000000003')$q$) is null,
  'and a second factor can be added again');

-- (j) Every allowlisted RPC exists ----------------------------------------------------------------------------------
select pg_temp.check((select bool_and(exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f)) from unnest(public.view_as_read_rpcs()) f), 'every read RPC exists');
select pg_temp.check((select bool_and(p.provolatile in ('s', 'i')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (public.view_as_read_rpcs())), 'every read RPC is declared stable');

-- Privileges -------------------------------------------------------------------------------------------------------
select pg_temp.check(not has_function_privilege('authenticated', 'public.begin_view_as(uuid, uuid, uuid, int)', 'execute')
  and not has_function_privilege('anon', 'public.begin_view_as(uuid, uuid, uuid, int)', 'execute')
  and has_function_privilege('service_role', 'public.begin_view_as(uuid, uuid, uuid, int)', 'execute'),
  'only the service role can start views');
select pg_temp.check(has_function_privilege('anon', 'public.view_as_guard()', 'execute')
  and has_function_privilege('authenticated', 'public.view_as_guard()', 'execute')
  and has_function_privilege('service_role', 'public.view_as_guard()', 'execute'), 'every API role can run the guard');
select pg_temp.check(not has_function_privilege('anon', 'public.end_view_as(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.end_view_as(uuid)', 'execute'), 'only signed-in users can call end_view_as');
select pg_temp.check(not has_function_privilege('authenticated', 'public.view_as_revoke_auth(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.view_as_revoke_auth(uuid)', 'execute'), 'nobody can revoke a session directly');

\echo 'All View as tests passed'
