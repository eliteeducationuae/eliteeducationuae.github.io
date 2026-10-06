-- Elite Education — awarding a role always names the subject, and the accountant sees estimated tutor costs.
--
--  1. award_opportunity (latest body: 20261102000000_rates.sql; no later migration redefined it) now takes the subject
--     as an optional second argument. A role for a named student with no subject used to move no enrolment when the
--     student had more than one active enrolment, yet the handover trigger still told the winning tutor that their
--     handover pack was ready; the pack then opened closed (handover_is_current, 20261113001300_handoverac_fix.sql,
--     needs a current enrolment or lesson). Now:
--       * a role with no subject, for a student with more than one active enrolment, is refused unless the admin
--         chooses the subject (p_subject), which must be one of the student's active subjects;
--       * the chosen subject is saved on the role before it is awarded, so the enrolment in that subject moves to the
--         winning tutor and the handover pack names that subject and opens;
--       * a subject given for a role that already has a different one is refused.
--     The admin's role screen asks which subject when it is needed. Mirrored by ops.awardOpportunity in
--     src/data/demo/operations.ts.
--  2. tutor_cost_estimates(from, to): for admins and the accountant, the estimated tutor cost of each month in the
--     range, totalled across tutors who have not yet submitted that month's invoice (lessons they were paid for, at
--     lesson_tutor_rate, as create_tutor_invoice would bill them). It returns monthly totals only: no lesson, student
--     or tutor detail. The accountant cannot read lessons, so the Money screen used to show those months' tutor costs
--     as 0. Mirrored by tax.tutorCostEstimates in src/data/demo/tax.ts. View as may call it (it only reads).
--  3. The migrations ledger records this file.

-- ---------------------------------------------------------------------------
-- 1. award_opportunity(bid, subject)
-- ---------------------------------------------------------------------------

drop function if exists public.award_opportunity(uuid);

create function public.award_opportunity(p_bid_id uuid, p_subject text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.opportunity_bids; o public.opportunities; other record; e public.enrolments;
  v_subject text := nullif(trim(p_subject), ''); chosen text; active_count int; st_name text;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into b from public.opportunity_bids where id = p_bid_id;
  if b is null or b.status <> 'pending' then raise exception 'That bid is no longer available'; end if;
  select * into o from public.opportunities where id = b.opportunity_id for update;
  if o.status <> 'open' then raise exception 'This opportunity has already been awarded or closed'; end if;

  -- The role's subject: its own, or the one the admin chose from the student's active subjects.
  if nullif(trim(o.subject), '') is not null then
    if v_subject is not null and lower(v_subject) <> lower(trim(o.subject)) then
      raise exception 'This role is already for %.', trim(o.subject) using errcode = '22023';
    end if;
  elsif o.student_id is not null then
    select count(*) into active_count from public.enrolments x where x.student_id = o.student_id and x.active;
    if v_subject is not null then
      select x.subject into chosen from public.enrolments x
      where x.student_id = o.student_id and x.active and lower(trim(x.subject)) = lower(v_subject)
      order by x.created_at limit 1;
      if chosen is null then
        raise exception 'Please choose one of the student''s current subjects.' using errcode = '22023';
      end if;
      -- Saved before the role is awarded, so the handover trigger sees it.
      update public.opportunities set subject = left(trim(chosen), 80) where id = o.id returning * into o;
    elsif active_count > 1 then
      select full_name into st_name from public.students where id = o.student_id;
      raise exception 'Please choose which subject this role is for: % has more than one subject.',
        coalesce(split_part(st_name, ' ', 1), 'the student') using errcode = '22023';
    end if;
  end if;

  update public.opportunities set status = 'awarded', awarded_tutor_id = b.tutor_id, awarded_at = now() where id = o.id;
  update public.opportunity_bids set status = 'awarded' where id = b.id;
  perform public.notify_tutor(b.tutor_id, 'You''ve been chosen: ' || o.title,
    'Great news — you''ve been chosen for ' || o.title || '. Elite Education will schedule the first lesson with you shortly.',
    'You got it!', o.title, '/opportunities/' || o.id);
  for other in update public.opportunity_bids set status = 'declined'
               where opportunity_id = o.id and id <> b.id and status = 'pending' returning tutor_id loop
    perform public.notify_tutor(other.tutor_id, 'Update on ' || o.title,
      'Thanks for your interest in ' || o.title || '. On this occasion it has gone to another tutor — keep an eye out for new opportunities.',
      'Opportunity update', o.title || ' has been filled', '/opportunities', false);
  end loop;

  -- The winning tutor teaches the student's enrolment in this subject, at the role's pay.
  if o.student_id is not null then
    if nullif(trim(o.subject), '') is not null then
      select * into e from public.enrolments x
      where x.student_id = o.student_id and x.active and lower(trim(x.subject)) = lower(trim(o.subject))
      order by x.subject, public.enrolment_title(x.subject, x.curriculum, x.level)
      limit 1;
      if e.id is null then
        insert into public.enrolments (student_id, subject, curriculum, tutor_id)
        values (o.student_id, left(trim(o.subject), 80), left(nullif(trim(o.curriculum), ''), 80), b.tutor_id)
        returning * into e;
      end if;
    elsif (select count(*) from public.enrolments x where x.student_id = o.student_id and x.active) = 1 then
      select * into e from public.enrolments x where x.student_id = o.student_id and x.active;
    end if;
    if e.id is not null then
      -- Change the tutor first: the tutor-change trigger clears any earlier tutor's pay.
      update public.enrolments set tutor_id = b.tutor_id where id = e.id;
      if o.pay_rate < 100000 then
        insert into public.enrolment_tutor_pay (enrolment_id, hourly_pay, source, opportunity_id, updated_at)
        values (e.id, o.pay_rate, 'opportunity', o.id, now())
        on conflict (enrolment_id) do update set
          hourly_pay = excluded.hourly_pay, source = 'opportunity', opportunity_id = excluded.opportunity_id, updated_at = now();
      end if;
    end if;
  end if;
end $$;
comment on function public.award_opportunity(uuid, text) is
  'Awards a role to a bid. When the role names a student, the student''s enrolment in the role''s subject (created if missing) '
  'is given the winning tutor and the role''s pay as custom pay (source opportunity). A role with no subject for a student '
  'with more than one active enrolment needs p_subject, one of the student''s active subjects, which is saved on the role.';
revoke all on function public.award_opportunity(uuid, text) from public, anon;
grant execute on function public.award_opportunity(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. tutor_cost_estimates
-- ---------------------------------------------------------------------------

/**
 * Estimated tutor cost per month (first day of the month, Dubai time) from p_from's month to p_to's month, at most 36
 * months: the pay for lessons taught by tutors with no submitted, approved or paid invoice for that month, rounded per
 * tutor as the app does. Totals only. Admins and the accountant.
 */
create function public.tutor_cost_estimates(p_from date, p_to date) returns table (month date, amount numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  first date := date_trunc('month', p_from)::date;
  last date := date_trunc('month', p_to)::date;
  late_paid boolean;
begin
  if not public.is_finance_reader() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_from is null or p_to is null or last < first then raise exception 'Please choose a valid range of months.' using errcode = '22023'; end if;
  if last > (first + interval '35 months')::date then raise exception 'Please choose at most 36 months.' using errcode = '22023'; end if;
  select coalesce(s.pay_tutor_for_late_cancel, false) into late_paid from public.settings s where s.id = 1;
  return query
  with months as (
    select generate_series(first, last, interval '1 month')::date as m
  ), taught as (
    select date_trunc('month', l.start_at at time zone 'Asia/Dubai')::date as m, l.tutor_id,
           extract(epoch from (l.end_at - l.start_at)) / 3600 * r.rate as pay
    from public.lessons l
    cross join lateral public.lesson_tutor_rate(l.id) r
    where l.tutor_id is not null
      and (l.start_at at time zone 'Asia/Dubai')::date >= first
      and (l.start_at at time zone 'Asia/Dubai')::date < (last + interval '1 month')::date
      and (l.status in ('completed', 'no-show') or (l.status = 'late-cancel' and coalesce(late_paid, false)))
  ), per_tutor as (
    select t.m, t.tutor_id, round(sum(coalesce(t.pay, 0)), 2) as pay
    from taught t
    where not exists (select 1 from public.tutor_invoices i
                      where i.tutor_id = t.tutor_id and i.period_start = t.m and i.status not in ('draft', 'rejected'))
    group by t.m, t.tutor_id
  )
  select months.m, coalesce((select sum(p.pay) from per_tutor p where p.m = months.m), 0)::numeric
  from months order by months.m;
end $$;
comment on function public.tutor_cost_estimates(date, date) is
  'Monthly estimated tutor cost totals for months without the tutor''s submitted invoice. Totals only, for admins and the accountant. '
  'Mirrors monthFigures in src/domain/finance.ts.';
revoke all on function public.tutor_cost_estimates(date, date) from public, anon;
grant execute on function public.tutor_cost_estimates(date, date) to authenticated;

-- View as: the estimates only read (a viewed parent, student or tutor is refused by the function itself).
create or replace function public.view_as_read_rpcs() returns text[]
language sql immutable as $$
  select array['my_threads', 'list_resources', 'login_emails', 'open_slots', 'is_view_as_session', 'current_view_as',
               -- Round 5 reads a parent, student or tutor makes: family contacts, tutor checks, lesson plans and packs.
               'list_family_contacts', 'tutor_compliance', 'visible_lesson_plans', 'handover_pack',
               -- Monthly estimated tutor costs (totals only).
               'tutor_cost_estimates']
$$;

-- ---------------------------------------------------------------------------
-- 3. Migrations ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261114000100', 'qa_award');
