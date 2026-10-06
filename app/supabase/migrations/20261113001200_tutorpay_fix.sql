-- Elite Education — security: tutors' pay, email and phone are no longer readable by everyone signed in.
--
-- Until now the "read tutors" policy let every signed-in login (parents, students, tutors and the accountant) select
-- every column of public.tutors, including hourly_pay, email and phone.
--
--  1. public.tutors: admins keep full access; a tutor reads only their own row (in full); nobody else reads any row.
--  2. public.tutor_directory: the columns every signed-in login may read about every tutor — id, full name,
--     subjects, curricula, phases, calendar colour and the closed-account date — for names on lessons, calendars,
--     opportunities, handovers and the books. It never carries pay, email, phone or onboarding dates. The view runs
--     as its owner (as the round 5 SECURITY DEFINER functions do), so it lists every tutor whatever the RLS on
--     public.tutors; it is read-only and anonymous visitors cannot read it.
--     Per-student tutor pay (public.enrolment_tutor_pay) is unchanged: admins and the enrolment's own tutor only.
--     The accountant reads tutor names here and tutor invoice totals as before, but never a pay rate.
--  3. The migrations ledger records this file.

-- ---------------------------------------------------------------------------
-- 1. public.tutors: admins, and a tutor's own row
-- ---------------------------------------------------------------------------

drop policy if exists "read tutors" on public.tutors;
create policy "read tutors" on public.tutors for select to authenticated
  using (public.is_admin() or id = public.my_tutor_id());

-- ---------------------------------------------------------------------------
-- 2. public.tutor_directory
-- ---------------------------------------------------------------------------

create or replace view public.tutor_directory with (security_barrier = true) as
  select t.id, t.full_name, t.subjects, t.curricula, t.phases, t.color, t.deleted_at
  from public.tutors t;

comment on view public.tutor_directory is
  'Every tutor''s name, subjects and calendar colour, for everyone signed in. Pay, email and phone stay in public.tutors (admins and the tutor themself).';

-- Supabase's default privileges grant every new view in public to anon and authenticated in full, and a simple
-- view is updatable (as its owner, past RLS), so take everything away and give back only select.
revoke all on public.tutor_directory from public, anon, authenticated;
grant select on public.tutor_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Migrations ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261113001200', 'tutorpay_fix');
