-- Elite Education — round 5 follow-ups that arrived after the merge migration.
--
--  1. Admissions: when an advisory update is sent, the family's timeline reads 'Advisory update sent: October 2026'
--     (the month of a monthly update) or 'Advisory update sent: <title>' for any other update, instead of
--     'Advisory update: October 2026 advisory update'. Mirrors advisoryUpdateSentTitle() in src/domain/admissions.ts.
--  2. The migrations ledger records this file.

-- Each function keeps its body and grants; only the quoted text changes. A function that already holds the new text
-- (a database that ran an early copy of the merge migration, which briefly carried this change) is left alone; one
-- that holds neither text stops the migration.
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
-- 1. Admissions timeline wording
-- ---------------------------------------------------------------------------

select pg_temp.swap_literal_once('public.set_advisory_update_status(uuid, text)',
  '''Advisory update: '' || u.title',
  '''Advisory update sent: '' || case when u.kind = ''monthly'' and nullif(trim(u.period), '''') is not null
                                          then trim(u.period) else trim(u.title) end');

-- ---------------------------------------------------------------------------
-- 2. Migrations ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261112000000', 'round5_followups');
