-- Elite Education: every subject, phase and curriculum.
-- Students study one or more subjects (enrolments), each with its own curriculum, level, exam board and tutor.
-- Topic lists are shared: a list made for one student is reused for every student with the same subject,
-- curriculum and level. The built-in maths syllabuses remain, now as the Maths enrolments' topic trees.
-- Safe to run on a live database: existing students get a Maths enrolment and existing rows get a subject.

-- ---------------------------------------------------------------------------
-- Students: curriculum and syllabus become legacy; phase of education is new
-- ---------------------------------------------------------------------------

alter table public.students drop constraint if exists students_curriculum_check;
alter table public.students alter column curriculum drop not null;
alter table public.students alter column syllabus_id drop not null;
alter table public.students add column if not exists phase text check (length(phase) <= 60);

-- ---------------------------------------------------------------------------
-- Shared topic lists
-- ---------------------------------------------------------------------------

create table public.topic_lists (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subject text not null check (length(subject) between 1 and 80),
  curriculum text check (length(curriculum) <= 80),
  level text check (length(level) <= 80),
  name text not null check (length(name) between 1 and 200),
  created_by uuid references public.profiles(id) on delete set null
);
create unique index topic_lists_key_idx on public.topic_lists
  (lower(trim(subject)), lower(coalesce(trim(curriculum), '')), lower(coalesce(trim(level), '')));

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.topic_lists(id) on delete cascade,
  unit text check (length(unit) <= 120),
  name text not null check (length(name) between 1 and 200),
  sort int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index topics_name_idx on public.topics (list_id, lower(coalesce(unit, '')), lower(name));

-- ---------------------------------------------------------------------------
-- Enrolments: one row per subject a student studies with us
-- ---------------------------------------------------------------------------

create table public.enrolments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  student_id uuid not null references public.students(id) on delete cascade,
  subject text not null check (length(subject) between 1 and 80),
  curriculum text check (length(curriculum) <= 80),
  level text check (length(level) <= 80),
  exam_board text check (length(exam_board) <= 80),
  tutor_id uuid references public.tutors(id) on delete set null,
  -- Built-in maths syllabus id from the app (src/data/curriculum.ts), e.g. 'ib-aa-hl'.
  syllabus_id text,
  topic_list_id uuid references public.topic_lists(id) on delete set null,
  active boolean not null default true
);
create unique index enrolments_subject_idx on public.enrolments
  (student_id, lower(subject), lower(coalesce(curriculum, '')), lower(coalesce(level, ''))) where active;
create index enrolments_student_idx on public.enrolments (student_id);
create index enrolments_tutor_idx on public.enrolments (tutor_id) where active;

/** The shared list for a subject, curriculum and level, if one exists. */
create function public.topic_list_for(p_subject text, p_curriculum text, p_level text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.topic_lists
  where lower(trim(subject)) = lower(trim(p_subject))
    and lower(coalesce(trim(curriculum), '')) = lower(coalesce(trim(p_curriculum), ''))
    and lower(coalesce(trim(level), '')) = lower(coalesce(trim(p_level), ''))
$$;

/** Tidy the text fields and link the enrolment to its shared topic list (the server owns topic_list_id). */
create function public.on_enrolment_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.subject := regexp_replace(trim(new.subject), '\s+', ' ', 'g');
  new.curriculum := nullif(regexp_replace(trim(new.curriculum), '\s+', ' ', 'g'), '');
  new.level := nullif(regexp_replace(trim(new.level), '\s+', ' ', 'g'), '');
  new.exam_board := nullif(regexp_replace(trim(new.exam_board), '\s+', ' ', 'g'), '');
  new.syllabus_id := nullif(trim(new.syllabus_id), '');
  if tg_op = 'UPDATE' and (lower(new.subject) is distinct from lower(old.subject)
      or lower(new.curriculum) is distinct from lower(old.curriculum) or lower(new.level) is distinct from lower(old.level)) then
    new.topic_list_id := null;
  end if;
  if new.topic_list_id is null then
    new.topic_list_id := public.topic_list_for(new.subject, new.curriculum, new.level);
  end if;
  return new;
end $$;
create trigger enrolments_write before insert or update on public.enrolments
  for each row execute function public.on_enrolment_write();

/** The built-in topic trees from the app (src/data/curriculum.ts) and the enrolment each stands for. */
create function public.builtin_syllabuses()
returns table (id text, subject text, curriculum text, level text, exam_board text)
language sql immutable set search_path = public as $$
  values
    ('ib-aa-sl', 'Maths', 'IB DP', 'AA SL', 'IB'),
    ('ib-aa-hl', 'Maths', 'IB DP', 'AA HL', 'IB'),
    ('ib-ai-sl', 'Maths', 'IB DP', 'AI SL', 'IB'),
    ('ib-ai-hl', 'Maths', 'IB DP', 'AI HL', 'IB'),
    ('igcse-4ma1', 'Maths', 'IGCSE', null, 'Pearson Edexcel'),
    ('igcse-0580', 'Maths', 'IGCSE', null, 'Cambridge'),
    ('igcse-0606', 'Maths', 'IGCSE', 'Additional', 'Cambridge'),
    ('alevel-maths', 'Maths', 'A-Level', null, null)
$$;

/**
 * The enrolment a legacy maths syllabus id stands for. Every legacy syllabus is Maths, so existing lessons and
 * reports (all Maths) keep matching it; Cambridge 0606 is Maths at the 'Additional' level. Unknown ids keep the
 * student's own curriculum, with the old 'IB' read as 'IB DP'.
 */
create function public.syllabus_enrolment(p_syllabus_id text, p_curriculum text)
returns table (subject text, curriculum text, level text, exam_board text)
language sql immutable set search_path = public as $$
  select coalesce(m.subject, 'Maths'),
         coalesce(m.curriculum, case when trim(p_curriculum) = 'IB' then 'IB DP' else nullif(trim(p_curriculum), '') end),
         m.level, m.exam_board
  from (select 1) one
  left join public.builtin_syllabuses() m on m.id = p_syllabus_id
$$;

/**
 * The built-in topic tree for a new enrolment (mirrors resolveBuiltInSyllabus in src/data/curriculum.ts).
 * A requested id is kept only when it is built in and fits the subject (and the curriculum, if one is given).
 * Otherwise the one built-in tree whose curriculum, level and exam board match is chosen: a missing exam board
 * on either side matches any, a curriculum is required, and 'Additional Maths' as a subject is the 0606 tree.
 * Returns null when nothing, or more than one tree, fits.
 */
create function public.builtin_syllabus_for(p_subject text, p_curriculum text, p_level text, p_exam_board text, p_requested text default null)
returns text language plpgsql immutable set search_path = public as $$
declare cur text := nullif(lower(trim(p_curriculum)), ''); subj text := lower(trim(p_subject)); found text[];
begin
  if cur = 'ib' then cur := 'ib dp'; end if;
  select array_agg(m.id) into found
  from public.builtin_syllabuses() m
  where (lower(m.subject) = subj or (m.id = 'igcse-0606' and subj = 'additional maths'))
    and (cur is null or lower(m.curriculum) = cur)
    and m.id = nullif(trim(p_requested), '');
  if cardinality(found) = 1 then return found[1]; end if;
  if cur is null then return null; end if;
  select array_agg(m.id) into found
  from public.builtin_syllabuses() m
  where lower(m.curriculum) = cur
    and (
      (lower(m.subject) = subj and lower(coalesce(trim(p_level), '')) = lower(coalesce(m.level, '')))
      or (m.id = 'igcse-0606' and subj = 'additional maths'
          and (nullif(trim(p_level), '') is null or lower(trim(p_level)) = lower(m.level))))
    and (nullif(trim(p_exam_board), '') is null or m.exam_board is null or lower(trim(p_exam_board)) = lower(m.exam_board));
  return case when cardinality(found) = 1 then found[1] end;
end $$;

-- ---------------------------------------------------------------------------
-- Subjects on lessons, requests, services, tutors, enquiries, roles, applications and reports
-- ---------------------------------------------------------------------------

alter table public.lessons add column if not exists subject text check (length(subject) <= 80);
alter table public.lesson_requests add column if not exists subject text check (length(subject) <= 80);
alter table public.services add column if not exists subject text check (length(subject) <= 80);
alter table public.services add column if not exists phase text check (length(phase) <= 60);
alter table public.tutors add column if not exists curricula text[] not null default '{}';
alter table public.tutors add column if not exists phases text[] not null default '{}';
alter table public.enquiries add column if not exists subject text check (length(subject) <= 80);
alter table public.enquiries add column if not exists phase text check (length(phase) <= 60);
alter table public.opportunities add column if not exists subject text check (length(subject) <= 80);
alter table public.opportunities add column if not exists phase text check (length(phase) <= 60);
alter table public.tutor_applications add column if not exists phases text[] not null default '{}';
alter table public.student_reports add column if not exists subject text check (length(subject) <= 80);
alter table public.student_reports add column if not exists enrolment_id uuid references public.enrolments(id) on delete set null;

-- Reports are now one per cycle and enrolment (so Maths IGCSE and Maths A-Level each get one). Reports not linked to an
-- enrolment stay one per cycle, student and subject.
alter table public.student_reports drop constraint if exists student_reports_cycle_id_student_id_key;
create unique index if not exists student_reports_enrolment_idx on public.student_reports (cycle_id, enrolment_id)
  where enrolment_id is not null;
create unique index if not exists student_reports_subject_idx on public.student_reports (cycle_id, student_id, lower(coalesce(subject, '')))
  where enrolment_id is null;

-- ---------------------------------------------------------------------------
-- Backfill (owner only; idempotent)
-- ---------------------------------------------------------------------------

/**
 * Gives every student with a legacy syllabus and no enrolment their Maths enrolment, taught by the tutor they
 * have had most lessons with (the latest lesson breaks ties). Marks existing lessons, reports and roles as Maths,
 * and moves tutors' curricula out of the subjects column, where they used to be kept.
 */
create function public.backfill_enrolments() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.enrolments (student_id, subject, curriculum, level, exam_board, syllabus_id, tutor_id)
  select s.id, m.subject, m.curriculum, m.level, m.exam_board, s.syllabus_id,
         (select l.tutor_id from public.lessons l where s.id = any (l.student_ids)
          group by l.tutor_id order by count(*) desc, max(l.start_at) desc limit 1)
  from public.students s
  cross join lateral public.syllabus_enrolment(s.syllabus_id, s.curriculum) m
  where s.syllabus_id is not null
    and not exists (select 1 from public.enrolments e where e.student_id = s.id);

  update public.lessons set subject = 'Maths' where subject is null;
  update public.student_reports set subject = 'Maths' where subject is null;
  update public.student_reports r set enrolment_id = (
    select e.id from public.enrolments e
    where e.student_id = r.student_id and e.active and lower(e.subject) = lower(r.subject)
      and not exists (select 1 from public.student_reports o where o.cycle_id = r.cycle_id and o.enrolment_id = e.id)
    order by e.created_at limit 1)
  where r.enrolment_id is null
    and exists (select 1 from public.enrolments e where e.student_id = r.student_id and e.active and lower(e.subject) = lower(r.subject));
  update public.opportunities set subject = 'Maths' where subject is null and syllabus_id is not null;
  update public.tutors
  set curricula = array(select case when c = 'IB' then 'IB DP' else c end from unnest(subjects) c), subjects = '{Maths}'
  where cardinality(subjects) > 0 and subjects <@ array['IB', 'IGCSE', 'A-Level'] and cardinality(curricula) = 0;
end $$;
revoke all on function public.backfill_enrolments() from public, anon, authenticated;

/** Older app versions still create students with a syllabus: give them their Maths enrolment. */
create function public.on_student_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.syllabus_id is not null and not exists (select 1 from public.enrolments where student_id = new.id) then
    insert into public.enrolments (student_id, subject, curriculum, level, exam_board, syllabus_id)
    select new.id, m.subject, m.curriculum, m.level, m.exam_board, new.syllabus_id
    from public.syllabus_enrolment(new.syllabus_id, new.curriculum) m;
  end if;
  return new;
end $$;
create trigger students_enrol after insert on public.students
  for each row execute function public.on_student_created();

revoke all on function public.on_enrolment_write(), public.on_student_created(), public.syllabus_enrolment(text, text),
  public.topic_list_for(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Visibility: tutors also see the students they are assigned to, before the first lesson
-- ---------------------------------------------------------------------------

create or replace function public.visible_student_ids() returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if p is null then return '{}'; end if;
  if p.role = 'admin' then return array(select id from public.students); end if;
  if p.role = 'parent' then return array(select id from public.students where family_id = p.family_id); end if;
  if p.role = 'student' then return array[p.student_id]; end if;
  -- tutor
  return array(
    select distinct unnest(student_ids) from public.lessons where tutor_id = p.tutor_id
    union
    select student_id from public.enrolments where active and tutor_id = p.tutor_id);
end $$;

-- ---------------------------------------------------------------------------
-- Booking requests carry the subject
-- ---------------------------------------------------------------------------

drop function if exists public.request_lesson(uuid, text, uuid, uuid, uuid, timestamptz, text);
create function public.request_lesson(
  p_student_id uuid, p_kind text, p_lesson_id uuid, p_tutor_id uuid, p_service_id uuid, p_start timestamptz, p_note text,
  p_subject text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare st public.students; l public.lessons; dur int; rid uuid; svc uuid; subj text;
begin
  select * into st from public.students where id = p_student_id;
  if st is null or not (public.is_admin() or st.family_id = public.my_family_id()) then
    raise exception 'Student not found' using errcode = '42501';
  end if;
  if p_kind = 'reschedule' then
    select * into l from public.lessons where id = p_lesson_id and p_student_id = any (student_ids) and status = 'scheduled';
    if l is null then raise exception 'That lesson can no longer be moved'; end if;
    dur := extract(epoch from (l.end_at - l.start_at)) / 60;
    svc := l.service_id;
  elsif p_kind = 'new-lesson' then
    select duration_min, id into dur, svc from public.services where id = p_service_id;
    if dur is null then raise exception 'Choose a lesson type'; end if;
  else
    raise exception 'Unknown request';
  end if;
  subj := coalesce(nullif(regexp_replace(trim(p_subject), '\s+', ' ', 'g'), ''), l.subject);
  if length(subj) > 80 then raise exception 'Please choose a shorter subject name'; end if;
  if not exists (select 1 from public.open_slots(coalesce(l.tutor_id, p_tutor_id), (p_start at time zone 'Asia/Dubai')::date, 1, dur, l.id) o
                 where o.start_at = p_start) then
    raise exception 'Sorry, that time is no longer available';
  end if;
  insert into public.lesson_requests (family_id, student_id, requested_by, kind, lesson_id, tutor_id, service_id, start_at, end_at, note, subject)
  values (st.family_id, st.id, auth.uid(), p_kind, l.id, coalesce(l.tutor_id, p_tutor_id), svc, p_start,
          p_start + make_interval(mins => dur), nullif(trim(p_note), ''), subj)
  returning id into rid;
  perform public.notify_admins(
    case when p_kind = 'reschedule' then 'Reschedule request: ' else 'Lesson request: ' end || st.full_name,
    st.full_name || coalesce(' (' || subj || ')', '') || ' — ' || to_char(p_start at time zone 'Asia/Dubai', 'Dy DD Mon HH24:MI')
      || coalesce(E'\n\n' || nullif(trim(p_note), ''), ''),
    'Lesson request', st.full_name || ', ' || to_char(p_start at time zone 'Asia/Dubai', 'Dy DD Mon HH24:MI'), '/admin/requests');
  return rid;
end $$;
grant execute on function public.request_lesson(uuid, text, uuid, uuid, uuid, timestamptz, text, text) to authenticated;

create or replace function public.decide_request(p_id uuid, p_approve boolean, p_response text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.lesson_requests; st public.students; clash boolean;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into r from public.lesson_requests where id = p_id for update;
  if r is null or r.status <> 'pending' then raise exception 'This request has already been dealt with'; end if;
  select * into st from public.students where id = r.student_id;
  if p_approve then
    select exists (select 1 from public.lessons l
                   where l.status = 'scheduled' and l.id is distinct from r.lesson_id
                     and (l.tutor_id = r.tutor_id or r.student_id = any (l.student_ids))
                     and l.start_at < r.end_at and l.end_at > r.start_at) into clash;
    if clash then raise exception 'That time now clashes with another lesson — decline and suggest another time'; end if;
    if r.kind = 'reschedule' then
      update public.lessons set start_at = r.start_at, end_at = r.end_at where id = r.lesson_id and status = 'scheduled';
      if not found then raise exception 'The original lesson can no longer be moved'; end if;
    else
      insert into public.lessons (tutor_id, student_ids, service_id, start_at, end_at, location, subject)
      select r.tutor_id, array[r.student_id], r.service_id, r.start_at, r.end_at,
             coalesce((select location from public.lessons where r.student_id = any (student_ids) order by start_at desc limit 1), 'online'),
             r.subject;
    end if;
  end if;
  update public.lesson_requests set status = case when p_approve then 'approved' else 'declined' end,
    response = nullif(trim(p_response), ''), decided_at = now() where id = r.id;
  perform public.notify_family(r.family_id,
    case when p_approve then 'Lesson confirmed: ' else 'Lesson request update: ' end || st.full_name,
    case when p_approve
      then 'Confirmed for ' || to_char(r.start_at at time zone 'Asia/Dubai', 'FMDay DD Mon at HH24:MI') || '.'
      else 'Sorry, we can''t do ' || to_char(r.start_at at time zone 'Asia/Dubai', 'FMDay DD Mon at HH24:MI') || '.' end
      || coalesce(E'\n\n' || nullif(trim(p_response), ''), ''),
    case when p_approve then 'Lesson confirmed' else 'Request declined' end,
    st.full_name || ', ' || to_char(r.start_at at time zone 'Asia/Dubai', 'Dy DD Mon HH24:MI'), '/', true);
end $$;

-- ---------------------------------------------------------------------------
-- Reports: one per active enrolment, written by that subject's tutor
-- ---------------------------------------------------------------------------

/**
 * Start a report round. Each active enrolment of a student taught since `p_starts_on` gets a draft when a lesson
 * in that period counts for it: the lesson's subject matches, or the lesson has no subject and the student studies
 * only one subject. The enrolment's tutor writes it, or else the tutor of most of those lessons. A student who was
 * taught but has no report from an enrolment gets one report as before, for their main tutor.
 */
create or replace function public.open_report_cycle(p_name text, p_starts_on date, p_due date)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; t record;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  insert into public.report_cycles (name, starts_on, due_date) values (trim(p_name), p_starts_on, p_due) returning id into cid;

  insert into public.student_reports (cycle_id, student_id, tutor_id, subject, enrolment_id)
  select cid, x.student_id, coalesce(x.enrolment_tutor, x.tutor_id), x.subject, x.enrolment_id from (
    select c.enrolment_id, c.student_id, c.subject, c.enrolment_tutor, c.tutor_id,
           row_number() over (partition by c.enrolment_id order by count(*) desc, max(c.start_at) desc) as rk
    from (
      select e.id as enrolment_id, e.student_id, e.subject, e.tutor_id as enrolment_tutor, l.tutor_id, l.start_at
      from public.enrolments e
      join (select l.tutor_id, l.start_at, l.subject, sid
            from public.lessons l, unnest(l.student_ids) sid
            where l.start_at >= p_starts_on and l.status in ('completed', 'no-show', 'scheduled')) l on l.sid = e.student_id
      where e.active
        and ((l.subject is not null and lower(trim(l.subject)) = lower(trim(e.subject)))
             or (l.subject is null and (select count(*) from public.enrolments o where o.student_id = e.student_id and o.active) = 1))
    ) c
    group by c.enrolment_id, c.student_id, c.subject, c.enrolment_tutor, c.tutor_id
  ) x
  where x.rk = 1
  order by x.subject
  on conflict do nothing;

  insert into public.student_reports (cycle_id, student_id, tutor_id, subject)
  select cid, x.student_id, x.tutor_id,
         (select l.subject from public.lessons l
          where x.student_id = any (l.student_ids) and l.start_at >= p_starts_on
            and l.status in ('completed', 'no-show', 'scheduled') and l.subject is not null
          group by l.subject order by count(*) desc, max(l.start_at) desc limit 1)
  from (
    select sid as student_id, l.tutor_id,
           row_number() over (partition by sid order by count(*) desc, max(l.start_at) desc) as rk
    from public.lessons l, unnest(l.student_ids) sid
    where l.start_at >= p_starts_on and l.status in ('completed', 'no-show', 'scheduled')
    group by sid, l.tutor_id) x
  where x.rk = 1
    and not exists (select 1 from public.student_reports r where r.cycle_id = cid and r.student_id = x.student_id)
  on conflict do nothing;

  for t in select tutor_id, count(*) n from public.student_reports where cycle_id = cid group by tutor_id loop
    perform public.notify_tutor(t.tutor_id, 'Reports to write: ' || trim(p_name),
      'You have ' || t.n || ' report' || case when t.n = 1 then '' else 's' end || ' to write for ' || trim(p_name) ||
      ', due ' || to_char(p_due, 'FMDD Month') || E'.\n\nEach report is prefilled with attendance, homework and topic progress '
      || 'for its subject, and you may draft the comments with AI assistance before reviewing them.',
      'Reports to write', t.n || ' due ' || to_char(p_due, 'DD Mon'), '/reports');
  end loop;
  return cid;
end $$;

/** Publishing a report tells the family, naming the subject now that each subject has its own report. */
create or replace function public.set_report_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.student_reports; c public.report_cycles; st public.students; who text; subj text;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_status not in ('draft', 'approved', 'published') then raise exception 'Invalid status'; end if;
  select * into r from public.student_reports where id = p_id for update;
  if r is null then raise exception 'Report not found'; end if;
  if p_status = 'published' and r.status not in ('submitted', 'approved') then raise exception 'Only finished reports can be published'; end if;
  update public.student_reports set status = p_status, published_at = case when p_status = 'published' then now() end where id = p_id;
  if p_status = 'published' then
    select * into c from public.report_cycles where id = r.cycle_id;
    select * into st from public.students where id = r.student_id;
    who := split_part(st.full_name, ' ', 1);
    subj := nullif(trim(r.subject), '');
    perform public.notify_family(st.family_id, c.name || ' report for ' || who || coalesce(' · ' || subj, ''),
      who || '''s ' || c.name || coalesce(' ' || subj, '') || ' report is ready to read in the Elite Education app.',
      'New report', who || coalesce(' · ' || subj, '') || ' — ' || c.name, '/parent/progress', true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Enquiries and applications record the subject and phase
-- ---------------------------------------------------------------------------

drop function if exists public.submit_enquiry(text, text, text, text, text, text, text, text, text);
/** Anyone (including the public website) can send an enquiry. Signed-in parents are linked automatically. */
create function public.submit_enquiry(
  p_parent_name text, p_email text, p_phone text, p_student_name text, p_curriculum text,
  p_year_group text, p_message text, p_preferred_times text, p_source text default 'app',
  p_subject text default null, p_phase text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare eid uuid; fam uuid; subj text; ph text;
begin
  if nullif(trim(p_parent_name), '') is null then raise exception 'Please enter your name'; end if;
  if nullif(trim(p_email), '') is null and nullif(trim(p_phone), '') is null then
    raise exception 'Please give an email address or phone number';
  end if;
  if p_email is not null and (select count(*) from public.enquiries
      where lower(email) = lower(trim(p_email)) and created_at > now() - interval '1 day') >= 5 then
    raise exception 'We already have your enquiry — we''ll be in touch soon';
  end if;
  subj := nullif(regexp_replace(trim(p_subject), '\s+', ' ', 'g'), '');
  ph := nullif(regexp_replace(trim(p_phase), '\s+', ' ', 'g'), '');
  if length(subj) > 80 or length(ph) > 60 then raise exception 'Please choose a shorter subject or phase'; end if;
  fam := public.my_family_id();
  insert into public.enquiries (parent_name, email, phone, student_name, curriculum, year_group, message, preferred_times, source, family_id,
                                subject, phase)
  values (trim(p_parent_name), nullif(lower(trim(p_email)), ''), nullif(trim(p_phone), ''), nullif(trim(p_student_name), ''),
          nullif(p_curriculum, ''), nullif(trim(p_year_group), ''), nullif(trim(p_message), ''), nullif(trim(p_preferred_times), ''),
          case when p_source in ('app', 'website', 'referral', 'phone', 'other') then p_source else 'other' end, fam,
          subj, ph)
  returning id into eid;
  perform public.notify_admins('New enquiry: ' || trim(p_parent_name),
    trim(p_parent_name) || coalesce(' (' || nullif(trim(p_email), '') || ')', '') || coalesce(', ' || nullif(trim(p_phone), ''), '')
      || coalesce(E'\nStudent: ' || nullif(trim(p_student_name), ''), '') || coalesce(' — ' || nullif(p_curriculum, ''), '')
      || coalesce(E'\nSubject: ' || subj, '') || coalesce(E'\nPhase: ' || ph, '')
      || coalesce(E'\n\n' || nullif(trim(p_message), ''), ''),
    'New enquiry', trim(p_parent_name), '/admin/enquiries');
  if nullif(trim(p_email), '') is not null then
    perform public.notify(null, lower(trim(p_email)), 'Thank you for contacting Elite Education',
      'Dear ' || split_part(trim(p_parent_name), ' ', 1) || E',\n\nThank you for contacting Elite Education. '
      || E'We will be in touch within one working day to arrange a complimentary consultation.\n\n'
      || E'With kind regards,\nElite Education\n\nElite Education | eliteeducation.me');
  end if;
  return eid;
end $$;
grant execute on function public.submit_enquiry(text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

drop function if exists public.submit_tutor_application(text, text, text, text[], text, text, text, text, text);
create function public.submit_tutor_application(
  p_full_name text, p_email text, p_phone text, p_curricula text[], p_subjects text,
  p_experience text, p_qualifications text, p_availability text, p_cv_path text default null,
  p_phases text[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid;
begin
  if nullif(trim(p_full_name), '') is null then raise exception 'Please enter your name'; end if;
  if nullif(trim(p_email), '') is null or position('@' in p_email) = 0 then raise exception 'Please enter a valid email address'; end if;
  if (select count(*) from public.tutor_applications where lower(email) = lower(trim(p_email)) and created_at > now() - interval '30 days') >= 2 then
    raise exception 'We already have your application — we''ll be in touch soon';
  end if;
  if cardinality(p_phases) > 10 then raise exception 'Please choose up to ten phases'; end if;
  insert into public.tutor_applications (full_name, email, phone, curricula, subjects, experience, qualifications, availability, cv_path, phases)
  values (trim(p_full_name), lower(trim(p_email)), nullif(trim(p_phone), ''), coalesce(p_curricula, '{}'), nullif(trim(p_subjects), ''),
          nullif(trim(p_experience), ''), nullif(trim(p_qualifications), ''), nullif(trim(p_availability), ''), nullif(p_cv_path, ''),
          coalesce(p_phases, '{}'))
  returning id into aid;
  perform public.notify_admins('Tutor application: ' || trim(p_full_name),
    trim(p_full_name) || ' (' || lower(trim(p_email)) || ') applied to teach '
      || coalesce(nullif(trim(p_subjects), '') || ' — ', '') || coalesce(array_to_string(p_curricula, ', '), '')
      || coalesce(E'\nPhases: ' || nullif(array_to_string(p_phases, ', '), ''), '')
      || coalesce(E'\n\n' || nullif(trim(p_experience), ''), ''),
    'New tutor application', trim(p_full_name), '/manage/applications');
  perform public.notify(null, lower(trim(p_email)), 'Thank you for applying to Elite Education',
    'Dear ' || split_part(trim(p_full_name), ' ', 1) || E',\n\nThank you for applying to teach with Elite Education. '
      || E'We review every application carefully and will be in touch shortly.\n\n'
      || E'With kind regards,\nElite Education\n\nElite Education | eliteeducation.me');
  return aid;
end $$;
grant execute on function public.submit_tutor_application(text, text, text, text[], text, text, text, text, text, text[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Parents add a child with their subjects
-- ---------------------------------------------------------------------------

/** 'IGCSE Chemistry', 'IB DP Maths (AA HL)' or 'Arabic', as the app's enrolmentTitle. */
create function public.enrolment_title(p_subject text, p_curriculum text, p_level text) returns text
language sql immutable set search_path = public as $$
  select concat_ws(' ', nullif(trim(p_curriculum), ''), trim(p_subject)) || coalesce(' (' || nullif(trim(p_level), '') || ')', '')
$$;

-- The older add_my_child(name, curriculum, syllabus_id, school, year_group) stays for app clients
-- that have not updated yet: its syllabus_id gives the child a Maths enrolment through on_student_created.
-- The new signature puts p_subjects second, so calls with the older arguments still resolve to the old function.
/** A parent adds a child to their own family (during onboarding), with 1 to 10 subjects. */
create function public.add_my_child(
  p_full_name text, p_subjects jsonb, p_school text default null, p_year_group text default null, p_phase text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare fam uuid; sid uuid; s jsonb; subj text; cur text; lvl text; board text; syl text; m record; f public.families; list text;
begin
  fam := public.my_family_id();
  if fam is null then raise exception 'Only parents can add children' using errcode = '42501'; end if;
  if nullif(trim(p_full_name), '') is null then raise exception 'Enter your child''s name'; end if;
  if (select count(*) from public.students where family_id = fam) >= 10 then raise exception 'Please contact us to add more children'; end if;
  if jsonb_typeof(coalesce(p_subjects, '[]')) <> 'array' or jsonb_array_length(coalesce(p_subjects, '[]')) not between 1 and 10 then
    raise exception 'Please choose between one and ten subjects';
  end if;
  if length(trim(p_phase)) > 60 then raise exception 'Please choose a shorter phase'; end if;
  insert into public.students (family_id, full_name, school, year_group, phase)
  values (fam, trim(p_full_name), nullif(trim(p_school), ''), nullif(trim(p_year_group), ''), nullif(trim(p_phase), ''))
  returning id into sid;
  for s in select * from jsonb_array_elements(p_subjects) loop
    subj := nullif(regexp_replace(trim(s->>'subject'), '\s+', ' ', 'g'), '');
    cur := nullif(trim(s->>'curriculum'), '');
    lvl := nullif(trim(s->>'level'), '');
    board := nullif(trim(s->>'exam_board'), '');
    if subj is null or length(subj) > 80 then raise exception 'Please choose a subject for every row'; end if;
    if length(cur) > 80 or length(lvl) > 80 or length(board) > 80 then raise exception 'Please shorten the curriculum, level or exam board'; end if;
    -- Keep the family's choice of course if it is built in and fits, or find the one course that does, so the
    -- tutor's topic tree and the progress heatmap are ready from the first lesson.
    syl := public.builtin_syllabus_for(subj, cur, lvl, board, s->>'syllabus_id');
    if syl is not null then
      select * into m from public.builtin_syllabuses() b where b.id = syl;
      cur := coalesce(cur, m.curriculum);
      board := coalesce(board, m.exam_board);
      if lower(subj) = lower(m.subject) then lvl := coalesce(lvl, m.level); end if;
    end if;
    if exists (select 1 from public.enrolments e where e.student_id = sid and e.active and lower(e.subject) = lower(subj)
               and lower(coalesce(e.curriculum, '')) = lower(coalesce(cur, '')) and lower(coalesce(e.level, '')) = lower(coalesce(lvl, ''))) then
      raise exception '% is listed twice. Please remove one.', subj;
    end if;
    insert into public.enrolments (student_id, subject, curriculum, level, exam_board, syllabus_id) values (sid, subj, cur, lvl, board, syl);
  end loop;
  -- The parent is told we will confirm a tutor within one working day, so the office must hear about it.
  select * into f from public.families where id = fam;
  select string_agg(public.enrolment_title(e.subject, e.curriculum, e.level), ', ' order by e.created_at, e.subject) into list
  from public.enrolments e where e.student_id = sid;
  perform public.notify_admins('New child added: ' || trim(p_full_name),
    coalesce(f.parent_name, f.name, 'A family') || ' added ' || trim(p_full_name) || coalesce(' (' || nullif(trim(p_year_group), '') || ')', '')
      || E'.\n\nSubjects: ' || list || E'\n\nPlease arrange a tutor and confirm with the family within one working day.',
    'New child', trim(p_full_name) || ' — ' || list, '/students/' || sid);
  return sid;
end $$;
revoke all on function public.add_my_child(text, jsonb, text, text, text) from public, anon;
grant execute on function public.add_my_child(text, jsonb, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Adding topics to the shared lists
-- ---------------------------------------------------------------------------

/**
 * Add a topic to the shared list for an enrolment's subject, curriculum and level. Admins, the enrolment's tutor
 * and tutors who have taught the student that subject (a lesson in it, or without a subject, not cancelled) may add. The list is created on first use and linked to every matching
 * enrolment. The same name in the same unit returns the existing topic.
 */
create function public.add_topic(p_enrolment_id uuid, p_name text, p_unit text default null)
returns public.topics language plpgsql security definer set search_path = public as $$
declare e public.enrolments; lst uuid; t public.topics; v_name text; v_unit text; me uuid;
begin
  select * into e from public.enrolments where id = p_enrolment_id;
  me := public.my_tutor_id();
  if e.id is null or not (
      public.is_admin()
      or (me is not null and (e.tutor_id = me
          or exists (select 1 from public.lessons l
                     where l.tutor_id = me and e.student_id = any (l.student_ids) and l.status <> 'cancelled'
                       and (l.subject is null or lower(trim(l.subject)) = lower(e.subject)))))) then
    raise exception 'You can add topics only for students you teach' using errcode = '42501';
  end if;
  v_name := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_unit := nullif(regexp_replace(trim(coalesce(p_unit, '')), '\s+', ' ', 'g'), '');
  if length(v_name) not between 1 and 200 then raise exception 'Please enter a topic name of up to 200 characters'; end if;
  if length(v_unit) > 120 then raise exception 'Please enter a unit name of up to 120 characters'; end if;

  lst := public.topic_list_for(e.subject, e.curriculum, e.level);
  if lst is null then
    insert into public.topic_lists (subject, curriculum, level, name, created_by)
    values (e.subject, e.curriculum, e.level,
            trim(regexp_replace(concat_ws(' ', e.curriculum, e.subject, '(' || e.level || ')'), '\s+', ' ', 'g')),
            (select id from public.profiles where id = auth.uid()))
    on conflict do nothing
    returning id into lst;
    if lst is null then lst := public.topic_list_for(e.subject, e.curriculum, e.level); end if;
  end if;
  update public.enrolments set topic_list_id = lst
  where topic_list_id is null and public.topic_list_for(subject, curriculum, level) = lst;

  select * into t from public.topics
  where list_id = lst and lower(coalesce(unit, '')) = lower(coalesce(v_unit, '')) and lower(name) = lower(v_name);
  if t.id is not null then return t; end if;
  insert into public.topics (list_id, unit, name, sort, created_by)
  values (lst, v_unit, v_name, coalesce((select max(sort) from public.topics where list_id = lst), 0) + 1,
          (select id from public.profiles where id = auth.uid()))
  on conflict do nothing
  returning * into t;
  if t.id is null then
    select * into t from public.topics
    where list_id = lst and lower(coalesce(unit, '')) = lower(coalesce(v_unit, '')) and lower(name) = lower(v_name);
  end if;
  return t;
end $$;
revoke all on function public.add_topic(uuid, text, text) from public, anon;
grant execute on function public.add_topic(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.enrolments enable row level security;
alter table public.topic_lists enable row level security;
alter table public.topics enable row level security;

create policy "see enrolments" on public.enrolments for select to authenticated
  using (student_id = any (public.visible_student_ids()));
create policy "admin enrolments" on public.enrolments for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- Topic lists are shared reference data; tutors add to them only through add_topic.
create policy "read topic lists" on public.topic_lists for select to authenticated using (true);
create policy "admin topic lists" on public.topic_lists for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read topics" on public.topics for select to authenticated using (true);
create policy "admin topics" on public.topics for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.enrolments, public.topic_lists, public.topics to authenticated;
revoke all on public.enrolments, public.topic_lists, public.topics from anon;

-- Existing students get their Maths enrolment; existing lessons, reports and roles become Maths.
select public.backfill_enrolments();
