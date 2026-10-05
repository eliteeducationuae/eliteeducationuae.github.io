-- Elite Education — session plans and tutor handover packs.
--
-- Session plans: a tutor plans an upcoming lesson (objectives, topics, resources and homework to set),
-- optionally sharing the plan with the family. The plan later pre-fills "Record lesson".
--
-- Handover packs: whenever a student changes tutor (a lesson is covered, an enrolment is reassigned or
-- a role with a student is awarded) the incoming tutor gets a pack with the student's goals, recent
-- lesson notes, open homework, plans, focus topics, resources and latest report. The outgoing tutor is
-- asked for a short handover note. Private lesson notes stay visible only to their author and admins.

-- ---------------------------------------------------------------------------
-- Session plans
-- ---------------------------------------------------------------------------

create table public.lesson_plans (
  lesson_id uuid primary key references public.lessons(id) on delete cascade,
  -- The lesson's tutor when the plan was last saved.
  tutor_id uuid references public.tutors(id) on delete set null,
  objectives text not null default '' check (length(objectives) <= 4000),
  -- Built-in syllabus topic ids and custom topic uuids, as text.
  topic_ids text[] not null default '{}' check (cardinality(topic_ids) <= 50),
  resource_ids uuid[] not null default '{}' check (cardinality(resource_ids) <= 20),
  -- [{ "studentId"?: uuid, "title": text, "details"?: text }]
  homework jsonb not null default '[]'
    check (jsonb_typeof(homework) = 'array' and jsonb_array_length(homework) <= 10),
  shared_with_family boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lesson_plans_tutor_idx on public.lesson_plans (tutor_id);

alter table public.lesson_plans enable row level security;
-- Direct reads are for staff only: admins and the lesson's own tutor. Families read shared plans through
-- visible_lesson_plans, which drops planned homework meant for children outside their family (group lessons).
create policy "see lesson plans" on public.lesson_plans for select to authenticated using (
  public.is_admin() or exists (
    select 1 from public.lessons l where l.id = lesson_id and l.tutor_id = public.my_tutor_id()));
-- Writes go through save_lesson_plan / delete_lesson_plan only.
revoke all on public.lesson_plans from anon, authenticated;
grant select on public.lesson_plans to authenticated;

/**
 * The plans the caller may read, for one lesson or for lessons starting in [p_from, p_to).
 * Staff get the whole plan. Parents and students get shared plans of lessons they can see, with planned
 * homework limited to general items and items for their own children.
 */
create function public.visible_lesson_plans(
  p_lesson_id uuid default null, p_from timestamptz default null, p_to timestamptz default null
) returns setof public.lesson_plans language plpgsql stable security definer set search_path = public as $$
declare
  admin boolean := public.is_admin(); me uuid := public.my_tutor_id();
  v_role text := (select role from public.profiles where id = auth.uid());
  mine text[] := coalesce(public.visible_student_ids()::text[], '{}');
begin
  return query
  select p.lesson_id, p.tutor_id, p.objectives, p.topic_ids, p.resource_ids,
    case when admin or coalesce(l.tutor_id = me, false) then p.homework
      else coalesce((select jsonb_agg(item order by ord) from jsonb_array_elements(p.homework) with ordinality h(item, ord)
                     where item->>'studentId' is null or item->>'studentId' = any (mine)), '[]'::jsonb) end,
    p.shared_with_family, p.created_at, p.updated_at
  from public.lesson_plans p join public.lessons l on l.id = p.lesson_id
  where (p_lesson_id is null or p.lesson_id = p_lesson_id)
    and (p_from is null or l.start_at >= p_from) and (p_to is null or l.start_at < p_to)
    and (admin or coalesce(l.tutor_id = me, false)
         or (p.shared_with_family and v_role in ('parent', 'student') and public.can_see_lesson(l)));
end $$;
revoke all on function public.visible_lesson_plans(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.visible_lesson_plans(uuid, timestamptz, timestamptz) to authenticated;

/** Save (create or replace) the plan for a scheduled lesson. Admins, or the lesson's own tutor. */
create function public.save_lesson_plan(
  p_lesson_id uuid, p_objectives text, p_topic_ids text[], p_resource_ids uuid[], p_homework jsonb, p_shared boolean
) returns public.lesson_plans language plpgsql security definer set search_path = public as $$
declare
  l public.lessons; result public.lesson_plans;
  v_objectives text := coalesce(trim(p_objectives), '');
  v_topics text[]; v_resources uuid[]; v_homework jsonb := '[]'; item jsonb; v_title text; v_details text; v_student text;
begin
  select * into l from public.lessons where id = p_lesson_id;
  if not found or not (public.is_admin() or coalesce(l.tutor_id = public.my_tutor_id(), false)) then
    raise exception 'Only the lesson''s tutor can plan this lesson.' using errcode = '42501';
  end if;
  if l.status <> 'scheduled' then raise exception 'Only scheduled lessons can be planned.'; end if;
  if length(v_objectives) > 4000 then raise exception 'Please keep the objectives under 4,000 characters.'; end if;

  -- Topics and resources: drop blanks and repeats, keeping the order given.
  select coalesce(array_agg(t order by o), '{}') into v_topics from (
    select trim(x) t, min(ord) o from unnest(coalesce(p_topic_ids, '{}')) with ordinality u(x, ord)
    where nullif(trim(x), '') is not null group by trim(x)) s;
  select coalesce(array_agg(r order by o), '{}') into v_resources from (
    select x r, min(ord) o from unnest(coalesce(p_resource_ids, '{}')) with ordinality u(x, ord)
    where x is not null group by x) s;
  -- Unknown resources are dropped rather than stored.
  v_resources := array(select r from unnest(v_resources) with ordinality u(r, o)
    where exists (select 1 from public.resources x where x.id = u.r) order by o);
  if cardinality(v_topics) > 50 then raise exception 'A plan can include up to 50 topics.'; end if;
  if cardinality(v_resources) > 20 then raise exception 'A plan can include up to 20 resources.'; end if;

  -- Planned homework: [{studentId?, title, details?}], each for a student in this lesson.
  if p_homework is not null and jsonb_typeof(p_homework) <> 'null' then
    if jsonb_typeof(p_homework) <> 'array' then raise exception 'Planned homework must be a list.'; end if;
    if jsonb_array_length(p_homework) > 10 then raise exception 'A plan can include up to 10 homework items.'; end if;
    for item in select value from jsonb_array_elements(p_homework) loop
      if jsonb_typeof(item) <> 'object' then raise exception 'Each planned homework item needs a title.'; end if;
      v_title := trim(coalesce(item->>'title', ''));
      v_details := nullif(trim(coalesce(item->>'details', '')), '');
      v_student := nullif(trim(coalesce(item->>'studentId', '')), '');
      if length(v_title) = 0 then raise exception 'Each planned homework item needs a title.'; end if;
      if length(v_title) > 200 then raise exception 'Please keep homework titles under 200 characters.'; end if;
      if length(v_details) > 4000 then raise exception 'Please keep homework details under 4,000 characters.'; end if;
      if v_student is not null and not (lower(v_student) = any (l.student_ids::text[])) then
        raise exception 'Planned homework must be for a student in this lesson.';
      end if;
      v_homework := v_homework || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'studentId', lower(v_student), 'title', v_title, 'details', v_details)));
    end loop;
  end if;

  if v_objectives = '' and cardinality(v_topics) = 0 and cardinality(v_resources) = 0 and jsonb_array_length(v_homework) = 0 then
    raise exception 'Please add an objective, a topic, a resource or planned homework.';
  end if;

  insert into public.lesson_plans (lesson_id, tutor_id, objectives, topic_ids, resource_ids, homework, shared_with_family)
  values (l.id, l.tutor_id, v_objectives, v_topics, v_resources, v_homework, coalesce(p_shared, false))
  on conflict (lesson_id) do update set
    tutor_id = excluded.tutor_id, objectives = excluded.objectives, topic_ids = excluded.topic_ids,
    resource_ids = excluded.resource_ids, homework = excluded.homework,
    shared_with_family = excluded.shared_with_family, updated_at = now()
  returning * into result;
  return result;
end $$;

create function public.delete_lesson_plan(p_lesson_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.lessons;
begin
  select * into l from public.lessons where id = p_lesson_id;
  if not found or not (public.is_admin() or coalesce(l.tutor_id = public.my_tutor_id(), false)) then
    raise exception 'Only the lesson''s tutor can plan this lesson.' using errcode = '42501';
  end if;
  delete from public.lesson_plans where lesson_id = l.id;
end $$;

grant execute on function public.save_lesson_plan(uuid, text, text[], uuid[], jsonb, boolean),
  public.delete_lesson_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Handovers
-- ---------------------------------------------------------------------------

create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reason text not null check (reason in ('cover', 'reassigned', 'awarded')),
  student_id uuid not null references public.students(id) on delete cascade,
  subject text check (length(subject) <= 80),
  enrolment_id uuid references public.enrolments(id) on delete set null,
  lesson_id uuid references public.lessons(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  from_tutor_id uuid references public.tutors(id) on delete set null,
  to_tutor_id uuid not null references public.tutors(id) on delete cascade,
  note text check (length(note) <= 4000),
  note_updated_at timestamptz,
  viewed_at timestamptz
);
create index handovers_to_idx on public.handovers (to_tutor_id, created_at desc);
create index handovers_from_idx on public.handovers (from_tutor_id);
create index handovers_student_idx on public.handovers (student_id);

alter table public.handovers enable row level security;
-- The outgoing tutor sees the row so they can write a note; only the incoming tutor and admins open the pack.
create policy "see handovers" on public.handovers for select to authenticated using (
  public.is_admin() or to_tutor_id = public.my_tutor_id() or from_tutor_id = public.my_tutor_id());
revoke all on public.handovers from anon, authenticated;
grant select on public.handovers to authenticated;

/** "Sami's Maths lessons" / "Sami's lessons". */
create function public.handover_whose(p_student text, p_subject text, p_noun text) returns text
language sql immutable set search_path = public as $$
  select p_student || '''s ' || coalesce(nullif(trim(p_subject), '') || ' ', '') || p_noun
$$;

/**
 * Record a change of tutor and tell both tutors. Internal: called from the triggers below.
 * A second change for the same student, incoming tutor and subject within 14 days reuses the
 * existing handover (filling in any missing links) and sends nothing new.
 */
create function public.create_handover(
  p_reason text, p_student uuid, p_subject text, p_enrolment uuid, p_lesson uuid, p_opportunity uuid, p_from uuid, p_to uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; st public.students; l public.lessons; to_name text; v_subject text := nullif(trim(p_subject), '');
  pack text := ' Your handover pack has their goals, recent lesson notes, open homework and focus topics.';
  body text; when_text text;
begin
  if p_to is null or p_student is null or p_from is not distinct from p_to then return null; end if;

  select id into v_id from public.handovers
  where student_id = p_student and to_tutor_id = p_to
    and lower(coalesce(subject, '')) = lower(coalesce(v_subject, ''))
    and created_at > now() - interval '14 days'
  order by created_at desc limit 1;
  if v_id is not null then
    update public.handovers set
      lesson_id = coalesce(lesson_id, p_lesson), enrolment_id = coalesce(enrolment_id, p_enrolment),
      opportunity_id = coalesce(opportunity_id, p_opportunity), from_tutor_id = coalesce(from_tutor_id, p_from)
    where id = v_id;
    return v_id;
  end if;

  insert into public.handovers (reason, student_id, subject, enrolment_id, lesson_id, opportunity_id, from_tutor_id, to_tutor_id)
  values (p_reason, p_student, v_subject, p_enrolment, p_lesson, p_opportunity, p_from, p_to)
  returning id into v_id;

  select * into st from public.students where id = p_student;
  select full_name into to_name from public.tutors where id = p_to;
  if p_lesson is not null then select * into l from public.lessons where id = p_lesson; end if;
  when_text := case when l.id is not null
    then ' on ' || to_char(l.start_at at time zone 'Asia/Dubai', 'FMDay FMDD Mon "at" HH24:MI') else '' end;

  body := case p_reason
    when 'cover' then 'You are covering ' || public.handover_whose(st.full_name, v_subject, 'lesson') || when_text || '.'
    when 'reassigned' then 'You are now ' || public.handover_whose(st.full_name, v_subject, 'tutor') || '.'
    else 'Welcome to ' || public.handover_whose(st.full_name, v_subject, 'lessons') || '.'
  end || pack;
  perform public.notify_tutor(p_to, 'Handover pack: ' || st.full_name || coalesce(' (' || v_subject || ')', ''), body,
    'Handover pack', st.full_name, '/handover/' || v_id);

  if p_from is not null then
    perform public.notify_tutor(p_from, 'Handover note for ' || st.full_name,
      coalesce(to_name, 'Another tutor') || case when p_reason = 'cover'
        then ' is covering ' || public.handover_whose(st.full_name, v_subject, 'lesson') || when_text || '.'
        else ' is taking over ' || public.handover_whose(st.full_name, v_subject, 'lessons') || '.' end
      || ' Please add a short handover note for them in the app.',
      'Handover note', st.full_name, '/handover/' || v_id);
  end if;
  return v_id;
end $$;
revoke all on function public.create_handover(text, uuid, text, uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.handover_whose(text, text, text) from public, anon, authenticated;

-- a) Cover: a scheduled lesson moves to another tutor.
create function public.on_lesson_tutor_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare sid uuid; v_subject text; v_enrolment uuid;
begin
  foreach sid in array new.student_ids loop
    v_subject := nullif(trim(new.subject), '');
    if v_subject is null then
      select min(e.subject) into v_subject from public.enrolments e
      where e.student_id = sid and e.active having count(*) = 1;
    end if;
    v_enrolment := null;
    if v_subject is not null then
      select e.id into v_enrolment from public.enrolments e
      where e.student_id = sid and e.active and lower(e.subject) = lower(v_subject)
      order by e.created_at limit 1;
    end if;
    perform public.create_handover('cover', sid, v_subject, v_enrolment, new.id, null, old.tutor_id, new.tutor_id);
  end loop;
  return null;
end $$;
create trigger lessons_handover after update of tutor_id on public.lessons
  for each row when (old.tutor_id is distinct from new.tutor_id and new.status = 'scheduled')
  execute function public.on_lesson_tutor_changed();

-- b) Reassigned: an active enrolment moves from one tutor to another.
create function public.on_enrolment_tutor_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.create_handover('reassigned', new.student_id, new.subject, new.id, null, null, old.tutor_id, new.tutor_id);
  return null;
end $$;
create trigger enrolments_handover after update of tutor_id on public.enrolments
  for each row when (old.tutor_id is not null and new.tutor_id is not null
                     and old.tutor_id is distinct from new.tutor_id and new.active)
  execute function public.on_enrolment_tutor_changed();

-- c) Awarded: a role with a named student goes to a tutor.
create function public.on_opportunity_awarded() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.enrolments;
begin
  if new.subject is not null then
    select * into e from public.enrolments
    where student_id = new.student_id and active and lower(subject) = lower(new.subject)
    order by created_at limit 1;
  end if;
  perform public.create_handover('awarded', new.student_id, new.subject, e.id, null, new.id, e.tutor_id, new.awarded_tutor_id);
  return null;
end $$;
create trigger opportunities_handover after update on public.opportunities
  for each row when (new.status = 'awarded' and old.status is distinct from 'awarded'
                     and new.student_id is not null and new.awarded_tutor_id is not null)
  execute function public.on_opportunity_awarded();

revoke all on function public.on_lesson_tutor_changed(), public.on_enrolment_tutor_changed(),
  public.on_opportunity_awarded() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------

/** Everything the incoming tutor needs about the student. Incoming tutor and admins only. */
create function public.handover_pack(p_id uuid) returns jsonb
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

  select to_jsonb(st) || jsonb_build_object('student_notes',
           case when sn.notes is not null then jsonb_build_object('notes', sn.notes) end)
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
    'handover', to_jsonb(h), 'student', v_student, 'enrolment', v_enrolment, 'lessons', v_lessons, 'notes', v_notes,
    'homework', v_homework, 'plans', v_plans, 'ratings', v_ratings, 'resources', v_resources, 'latest_report', v_report);
end $$;

/** The outgoing tutor (or an admin) leaves a note for the incoming tutor. */
create function public.save_handover_note(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare h public.handovers; v_note text := nullif(trim(p_note), ''); st_name text; from_name text;
begin
  select * into h from public.handovers where id = p_id;
  if not found or not (public.is_admin() or coalesce(h.from_tutor_id = public.my_tutor_id(), false)) then
    raise exception 'Handover not found.' using errcode = '42501';
  end if;
  if length(v_note) > 4000 then raise exception 'Please keep the handover note under 4,000 characters.'; end if;
  update public.handovers set note = v_note, note_updated_at = now() where id = h.id;
  if v_note is null then return; end if;
  select full_name into st_name from public.students where id = h.student_id;
  select full_name into from_name from public.tutors where id = h.from_tutor_id;
  perform public.notify_tutor(h.to_tutor_id, 'Handover note for ' || st_name,
    coalesce(from_name, 'Elite Education') || ' has added a handover note for ' || st_name
      || coalesce(' (' || h.subject || ')', '') || '.',
    'Handover note', st_name, '/handover/' || h.id);
end $$;

/** The incoming tutor has opened the pack. Does nothing for anyone else. */
create function public.mark_handover_viewed(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.handovers set viewed_at = coalesce(viewed_at, now())
  where id = p_id and public.my_tutor_id() is not null and to_tutor_id = public.my_tutor_id();
end $$;

grant execute on function public.handover_pack(uuid), public.save_handover_note(uuid, text),
  public.mark_handover_viewed(uuid) to authenticated;
