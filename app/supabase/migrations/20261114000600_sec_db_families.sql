-- Elite Education — tutors read a family's name, never its contact details.
--
--  1. The "see families" policy (20261002000000_init.sql) returned the whole families row to every tutor who teaches one
--     of the family's children, so a tutor could read the main contact's email address and telephone number straight
--     from the REST API, although the app shows tutors the family's name only (list_family_contacts blanks email and
--     telephone for tutors, and the student page hides them). The policy now covers the office, the family itself and
--     the family's children (who see their own family, as before); tutors no longer read public.families at all.
--     The accountant keeps "accountant reads families" (20261105000000_tax.sql).
--  2. public.family_directory gives every signed-in person the families they could see before, with the columns a tutor
--     genuinely needs and nothing else: id, the family name, the main contact's name (the conversation list, the
--     student page and an admissions update's "Dear ..." line address the parent by name), the status (archived
--     families drop out of pickers) and the created and closed dates. Email and telephone stay in public.families.
--     Server-side code that needs a family's contact details (invoices, checkout, notifications, calendar sync titles,
--     handover packs, reports and PDFs) runs as security definer or with the service role and is unaffected; it never
--     hands a tutor the email or telephone number.
--  3. The migrations ledger records this file.

-- ---------------------------------------------------------------------------
-- 1. Who reads the whole families row
-- ---------------------------------------------------------------------------

drop policy if exists "see families" on public.families;
create policy "see families" on public.families for select to authenticated
  using (public.is_admin() or id = public.my_family_id()
         or (public.my_role() = 'student'
             and id in (select family_id from public.students where id = any (public.visible_student_ids()))));

-- ---------------------------------------------------------------------------
-- 2. public.family_directory
-- ---------------------------------------------------------------------------

-- The view runs as its owner (past row-level security on families), so it filters the rows itself: the same families
-- a person could see before this migration (the office, the accountant, the family, its children and the tutors who
-- currently teach one of its children; see visible_student_ids in 20261114000200_sec_db.sql).
create or replace view public.family_directory with (security_barrier = true) as
  select f.id, f.name, f.parent_name, f.status, f.created_at, f.deleted_at
  from public.families f
  where public.is_admin() or public.is_accountant() or f.id = public.my_family_id()
     or f.id in (select s.family_id from public.students s where s.id = any (public.visible_student_ids()));

comment on view public.family_directory is
  'The families a person can see, by name only (no email or telephone). Tutors read families through this view; the full row stays in public.families (the office, the accountant and the family itself).';

-- Supabase's default privileges grant every new view in public to anon and authenticated in full, and a simple view is
-- updatable (as its owner, past RLS), so take everything away and give back only select.
revoke all on public.family_directory from public, anon, authenticated;
grant select on public.family_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Migrations ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261114000600', 'sec_db_families');
