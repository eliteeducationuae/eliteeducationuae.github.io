-- Elite Education — handover packs close when the tutor no longer teaches the student.
--
-- handover_pack used to check only that the caller was the handover's incoming tutor, and handovers never close. A
-- tutor who once received a pack (a reassignment later undone, or a single covered lesson) could reopen it for ever
-- and read the student's newest lesson notes, the office's tutor-only notes, lesson addresses, homework, ratings and
-- reports, long after losing every other way to see the student.
--
--  1. handover_pack: admins always get the full pack. The incoming tutor gets it only while they are currently the
--     student's tutor for the handover's subject: an active enrolment for the student in that subject (any subject
--     when the handover has none) taught by them, or a lesson with the student in that subject assigned to them that
--     is still to come, or ended within the last 7 days (a cover tutor keeps the pack for a week after the lesson).
--     Otherwise the pack is closed: only the handover itself (with the outgoing tutor's note) and the student's name
--     come back, with "closed": true. No lessons, notes, staff notes, addresses, homework, plans, ratings, resources,
--     enrolment or report.
--  2. The student's tutor-only notes (student_notes) are included only when the caller can read them through the
--     "staff student notes" policy: an admin, or a tutor for whom the student is in visible_student_ids().
--  3. The migrations ledger records this file.
--
-- The rest of the pack is the body from 20261110000000_handover.sql (no later migration redefined handover_pack).
-- Mirrored by ho.sources() in src/data/demo/handover.ts.

-- ---------------------------------------------------------------------------
-- 1 and 2. handover_pack
-- ---------------------------------------------------------------------------

/** Whether a tutor currently teaches the handover's student and subject (see the header for the rule). */
create or replace function public.handover_is_current(h public.handovers, p_tutor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_tutor is not null and (
    exists (select 1 from public.enrolments e
            where e.student_id = h.student_id and e.active and e.tutor_id = p_tutor
              and (h.subject is null or lower(e.subject) = lower(h.subject)))
    or exists (select 1 from public.lessons l
               where h.student_id = any (l.student_ids) and l.tutor_id = p_tutor
                 and l.status in ('scheduled', 'completed', 'no-show')
                 and l.end_at > now() - interval '7 days'
                 and (h.subject is null or l.subject is null or lower(l.subject) = lower(h.subject))))
$$;
revoke all on function public.handover_is_current(public.handovers, uuid) from public, anon, authenticated;

/**
 * Everything the incoming tutor needs about the student. Admins, and the incoming tutor while they still teach the
 * student; a closed pack holds only the handover and the student's name.
 */
create or replace function public.handover_pack(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  h public.handovers; st public.students; me uuid := public.my_tutor_id(); admin boolean := public.is_admin();
  v_student jsonb; v_enrolment jsonb; v_lessons jsonb; v_notes jsonb; v_homework jsonb; v_plans jsonb;
  v_ratings jsonb; v_resources jsonb; v_report jsonb;
  lesson_ids uuid[]; plan_resources text[]; homework_resources text[];
begin
  select * into h from public.handovers where id = p_id;
  if not found or not (admin or coalesce(h.to_tutor_id = me, false)) then
    raise exception 'Handover pack not found.' using errcode = '42501';
  end if;
  select * into st from public.students where id = h.student_id;

  -- A tutor who no longer teaches the student keeps only the handover and its note.
  if not admin and not public.handover_is_current(h, me) then
    return jsonb_build_object(
      'handover', to_jsonb(h), 'closed', true,
      'student', jsonb_build_object('id', h.student_id, 'full_name', coalesce(h.student_name, st.full_name)),
      'enrolment', null, 'lessons', '[]'::jsonb, 'notes', '[]'::jsonb, 'homework', '[]'::jsonb, 'plans', '[]'::jsonb,
      'ratings', '[]'::jsonb, 'resources', '[]'::jsonb, 'latest_report', null);
  end if;

  -- Tutor-only notes follow the "staff student notes" policy.
  select to_jsonb(st) || jsonb_build_object('student_notes',
           case when sn.notes is not null
                     and (admin or (me is not null and st.id = any (public.visible_student_ids())))
                then jsonb_build_object('notes', sn.notes) end)
  into v_student
  from (select 1) one left join public.student_notes sn on sn.student_id = st.id;

  select to_jsonb(e) into v_enrolment from public.enrolments e where e.id = h.enrolment_id;
  if v_enrolment is null and h.subject is not null then
    select to_jsonb(e) into v_enrolment from public.enrolments e
    where e.student_id = h.student_id and e.active and lower(e.subject) = lower(h.subject)
    order by e.created_at limit 1;
  end if;

  -- Recent taught lessons in this subject, by any tutor.
  select coalesce(array_agg(id order by start_at desc), '{}'), coalesce(jsonb_agg(to_jsonb(x) order by start_at desc), '[]')
  into lesson_ids, v_lessons
  from (select l.* from public.lessons l
        where h.student_id = any (l.student_ids) and l.status in ('completed', 'no-show')
          and (h.subject is null or l.subject is null or lower(l.subject) = lower(h.subject))
        order by l.start_at desc limit 10) x;

  -- Private notes follow the lesson_private_notes policy: admins and that lesson's own tutor only.
  select coalesce(jsonb_agg(to_jsonb(n) || jsonb_build_object('lesson_private_notes',
           case when (admin or l.tutor_id = me) and pn.private_note is not null
                then jsonb_build_object('private_note', pn.private_note) end)
         order by l.start_at desc), '[]')
  into v_notes
  from public.lesson_notes n join public.lessons l on l.id = n.lesson_id
  left join public.lesson_private_notes pn on pn.lesson_id = n.lesson_id
  where n.lesson_id = any (lesson_ids);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date, x.created_at), '[]') into v_homework
  from (select hw.* from public.homework hw left join public.lessons l on l.id = hw.lesson_id
        where hw.student_id = h.student_id and not hw.done
          and (hw.lesson_id is null or h.subject is null or l.subject is null or lower(l.subject) = lower(h.subject))
        order by hw.due_date, hw.created_at limit 20) x;
  homework_resources := array(
    select a->>'resourceId' from jsonb_array_elements(v_homework) hw,
      jsonb_array_elements(case jsonb_typeof(hw->'attachments') when 'array' then hw->'attachments' else '[]' end) a
    where a->>'resourceId' is not null);

  -- Plans for this subject, including upcoming lessons.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.lesson_start_at desc), '[]') into v_plans
  from (select p.*, l.start_at lesson_start_at from public.lesson_plans p join public.lessons l on l.id = p.lesson_id
        where h.student_id = any (l.student_ids)
          and (h.subject is null or l.subject is null or lower(l.subject) = lower(h.subject))
        order by l.start_at desc limit 5) x;
  plan_resources := array(
    select r from jsonb_array_elements(v_plans) p, jsonb_array_elements_text(p->'resource_ids') r);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.rated_at), '[]') into v_ratings
  from public.topic_ratings r where r.student_id = h.student_id;

  select coalesce(jsonb_agg(to_jsonb(x) - 'student_ids' order by x.created_at desc), '[]') into v_resources
  from (select r.* from public.resources r
        where r.id::text = any (plan_resources) or r.id::text = any (homework_resources) or (r.visibility = 'students' and h.student_id = any (r.student_ids))
        order by r.created_at desc limit 30) x;

  select to_jsonb(r) into v_report from public.student_reports r
  where r.student_id = h.student_id and r.status in ('approved', 'published')
    and (h.subject is null or r.subject is null or lower(r.subject) = lower(h.subject))
  order by coalesce(r.published_at, r.updated_at) desc limit 1;

  return jsonb_build_object(
    'handover', to_jsonb(h), 'closed', false, 'student', v_student, 'enrolment', v_enrolment, 'lessons', v_lessons,
    'notes', v_notes, 'homework', v_homework, 'plans', v_plans, 'ratings', v_ratings, 'resources', v_resources,
    'latest_report', v_report);
end $$;
-- create or replace keeps the grant to authenticated from the handover migration.

-- ---------------------------------------------------------------------------
-- 3. Migrations ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261113001300', 'handoverac_fix');
