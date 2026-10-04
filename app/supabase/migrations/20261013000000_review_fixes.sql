-- Elite Education — fixes from the round 4 review.
--
-- 1. save_homework: homework set from a lesson must name a lesson the student was in and that the caller teaches
--    (or the caller is an admin). Otherwise a tutor could attach homework to another tutor's lesson, which also
--    suppressed the family's notice for homework set outside a lesson.
-- 2. submit_homework: hand-ins may cite only files in the student's own folder (students/<student id>/…) and links.
--    Library paths (resources/…) remain valid for homework that tutors set, but not for hand-ins, so a hand-in can
--    no longer pin a library file in storage.

/** True when p is a list of well-formed hand-in files: the student's own folder, or links. */
create function public.valid_handin_files(p jsonb, p_student_id uuid) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(jsonb_typeof(p) = 'array' and not exists (
    select 1 from jsonb_array_elements(p) e
    where not coalesce(
      jsonb_typeof(e) = 'object'
      and length(trim(e->>'name')) > 0
      and case e->>'kind'
        when 'file' then e->>'path' like 'students/' || p_student_id::text || '/_%' and position('..' in e->>'path') = 0
        when 'link' then e->>'url' ~* '^https?://[^[:space:]]+$'
        else false
      end,
      false)
  ), false)
$$;
grant execute on function public.valid_handin_files(jsonb, uuid) to authenticated;

create or replace function public.save_homework(
  p_id uuid, p_student_id uuid, p_title text, p_details text, p_due_date date, p_attachments jsonb, p_lesson_id uuid default null
) returns public.homework language plpgsql security definer set search_path = public as $$
declare h public.homework; atts jsonb := coalesce(p_attachments, '[]');
begin
  if not (public.is_admin() or (public.my_tutor_id() is not null and p_student_id = any (public.visible_student_ids()))) then
    raise exception 'You can only set homework for your own students.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'Please give the homework a title.'; end if;
  if p_due_date is null then raise exception 'Please choose a due date.'; end if;
  if length(trim(p_title)) > 200 then raise exception 'Please keep the title to 200 characters or fewer.'; end if;
  if length(coalesce(p_details, '')) > 4000 then raise exception 'Please keep the details to 4,000 characters or fewer.'; end if;
  if not public.valid_attachments(atts, p_student_id) then
    raise exception 'One of the attachments could not be accepted. Please check the files and links and try again.';
  end if;
  -- Homework set from a lesson must belong to that lesson: the student was in it, and it is the caller's lesson.
  if p_id is null and p_lesson_id is not null and not exists (
    select 1 from public.lessons l
     where l.id = p_lesson_id and p_student_id = any (l.student_ids)
       and (public.is_admin() or l.tutor_id = public.my_tutor_id())
  ) then
    raise exception 'Lesson not found';
  end if;
  if p_id is null then
    insert into public.homework (student_id, lesson_id, title, details, due_date, attachments, tutor_id)
    values (p_student_id, p_lesson_id, trim(p_title), nullif(trim(p_details), ''), p_due_date, atts, public.my_tutor_id())
    returning * into h;
  else
    update public.homework
       set title = trim(p_title), details = nullif(trim(p_details), ''), due_date = p_due_date, attachments = atts
     where id = p_id and student_id = p_student_id
    returning * into h;
    if h.id is null then raise exception 'Homework not found'; end if;
  end if;
  return h;
end $$;

create or replace function public.submit_homework(p_homework_id uuid, p_note text, p_files jsonb)
returns public.homework_submissions language plpgsql security definer set search_path = public as $$
declare h public.homework; s public.homework_submissions; me public.profiles; st public.students;
  files jsonb := coalesce(p_files, '[]'); tutor uuid; first_name text; body text;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role is null or me.role not in ('student', 'parent', 'admin') then
    raise exception 'Only students and their families can hand in homework.' using errcode = '42501';
  end if;
  select * into h from public.homework where id = p_homework_id and student_id = any (public.visible_student_ids());
  if h.id is null then raise exception 'Homework not found'; end if;
  if length(trim(coalesce(p_note, ''))) = 0 and jsonb_typeof(files) = 'array' and jsonb_array_length(files) = 0 then
    raise exception 'Please add a note or attach your work before handing it in.';
  end if;
  if length(coalesce(p_note, '')) > 4000 then raise exception 'Please keep the note to 4,000 characters or fewer.'; end if;
  if not public.valid_handin_files(files, h.student_id) then
    raise exception 'One of the files could not be accepted. Please try attaching it again.';
  end if;

  insert into public.homework_submissions (homework_id, student_id, submitted_by, submitted_by_name, note, files)
  values (h.id, h.student_id, auth.uid(), me.full_name, nullif(trim(p_note), ''), files)
  returning * into s;
  update public.homework set done = true where id = h.id;

  select * into st from public.students where id = h.student_id;
  first_name := split_part(st.full_name, ' ', 1);
  body := first_name || ' has handed in "' || h.title || '"'
    || case when jsonb_array_length(files) > 0 then ' with ' || jsonb_array_length(files)
         || case when jsonb_array_length(files) = 1 then ' file' else ' files' end else '' end
    || '.' || coalesce(E'\n\nNote: ' || s.note, '') || E'\n\nYou can review it and give feedback in the Elite Education app.';
  tutor := coalesce(h.tutor_id, (select tutor_id from public.lessons where id = h.lesson_id));
  if tutor is null then
    perform public.notify_admins(first_name || ' has handed in homework: ' || h.title, body,
      'Homework handed in', first_name || ': ' || h.title, '/homework/' || h.id);
  elsif exists (select 1 from public.profiles where tutor_id = tutor and role in ('tutor', 'admin')) then
    perform public.notify_tutor(tutor, first_name || ' has handed in homework: ' || h.title, body,
      'Homework handed in', first_name || ': ' || h.title, '/homework/' || h.id);
  else
    perform public.notify(null, (select email from public.tutors where id = tutor),
      first_name || ' has handed in homework: ' || h.title, body, null, null, '/homework/' || h.id);
  end if;
  return s;
end $$;
