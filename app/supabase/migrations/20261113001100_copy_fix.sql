-- Elite Education — round 6 copy fixes.
--
--  1. Spam protection: the polite message shown when a sender is over the rate limit gives the public contact
--     address, hello@eliteeducation.me, instead of a personal address. Mirrors RATE_LIMITED_MESSAGE in
--     src/domain/spam.ts and the website's message in index.html.
--  2. The polite size-limit messages on the enquiry and tutor application forms end with a full stop, as in
--     PAYLOAD_MESSAGES in src/domain/spam.ts.
--  3. The migrations ledger records this file.

-- Each function keeps its body and grants; only the quoted text changes. A function that already holds the new text
-- is left alone; one that holds neither text stops the migration.
create or replace function pg_temp.swap_literal_once(p_fn regprocedure, p_from text, p_to text) returns void
language plpgsql as $$
declare def text := pg_get_functiondef(p_fn);
begin
  if position(p_to in def) > 0 then
    return;
  end if;
  if position(p_from in def) = 0 then
    raise exception 'Expected % in %', p_from, p_fn;
  end if;
  execute replace(def, p_from, p_to);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Rate-limit message contact address
-- ---------------------------------------------------------------------------

select pg_temp.swap_literal_once('public.enforce_submission_rate_limit(text, text, text)',
  'please email craig@craigobrieneducation.com.',
  'please email hello@eliteeducation.me.');

-- ---------------------------------------------------------------------------
-- 2. Size-limit messages end with a full stop
-- ---------------------------------------------------------------------------

select pg_temp.swap_literal_once('public.submit_enquiry(text, text, text, text, text, text, text, text, text, text, text, integer, uuid)',
  '''Please shorten the name to 200 characters or fewer''', '''Please shorten the name to 200 characters or fewer.''');
select pg_temp.swap_literal_once('public.submit_enquiry(text, text, text, text, text, text, text, text, text, text, text, integer, uuid)',
  '''Please check the email address or telephone number''', '''Please check the email address or telephone number.''');
select pg_temp.swap_literal_once('public.submit_enquiry(text, text, text, text, text, text, text, text, text, text, text, integer, uuid)',
  '''Please shorten your message to 4,000 characters or fewer''', '''Please shorten your message to 4,000 characters or fewer.''');
select pg_temp.swap_literal_once('public.submit_enquiry(text, text, text, text, text, text, text, text, text, text, text, integer, uuid)',
  '''Please shorten your answers a little''', '''Please shorten your answers a little.''');
select pg_temp.swap_literal_once('public.submit_tutor_application(text, text, text, text[], text, text, text, text, text, text[], integer, uuid, text)',
  '''Please shorten the name to 200 characters or fewer''', '''Please shorten the name to 200 characters or fewer.''');
select pg_temp.swap_literal_once('public.submit_tutor_application(text, text, text, text[], text, text, text, text, text, text[], integer, uuid, text)',
  '''Please check the email address or telephone number''', '''Please check the email address or telephone number.''');
select pg_temp.swap_literal_once('public.submit_tutor_application(text, text, text, text[], text, text, text, text, text, text[], integer, uuid, text)',
  '''Please shorten your message to 4,000 characters or fewer''', '''Please shorten your message to 4,000 characters or fewer.''');
select pg_temp.swap_literal_once('public.submit_tutor_application(text, text, text, text[], text, text, text, text, text, text[], integer, uuid, text)',
  '''Please shorten your answers a little''', '''Please shorten your answers a little.''');

-- ---------------------------------------------------------------------------
-- 3. Migrations ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261113001100', 'copy_fix');
