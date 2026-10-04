-- Elite Education — homework with files and links, hand-ins with tutor feedback, the resource library
-- and the private `classwork` storage bucket.
--
-- Attachment JSON (a contract with the app, camelCase keys):
--   { "kind": "file" | "link", "name": text, "path"?: text, "url"?: text, "mimeType"?: text, "resourceId"?: uuid text }
-- File paths live in the `classwork` bucket, under students/<student id>/… or resources/….

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------

/** True when p is a list of well-formed attachments that a given student's work may refer to. */
create function public.valid_attachments(p jsonb, p_student_id uuid) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(jsonb_typeof(p) = 'array' and not exists (
    select 1 from jsonb_array_elements(p) e
    where not coalesce(
      jsonb_typeof(e) = 'object'
      and length(trim(e->>'name')) > 0
      and case e->>'kind'
        when 'file' then
          (e->>'path' like 'students/' || p_student_id::text || '/_%' or e->>'path' like 'resources/_%')
          and position('..' in e->>'path') = 0
        when 'link' then e->>'url' ~* '^https?://[^[:space:]]+$'
        else false
      end,
      false)
  ), false)
$$;

-- ---------------------------------------------------------------------------
-- Homework: details, attachments and who set it
-- ---------------------------------------------------------------------------

alter table public.homework
  add column details text,
  add column attachments jsonb not null default '[]' check (jsonb_typeof(attachments) = 'array'),
  add column tutor_id uuid references public.tutors(id) on delete set null,
  add column created_at timestamptz not null default now();

update public.homework h set tutor_id = l.tutor_id
from public.lessons l where l.id = h.lesson_id and h.tutor_id is null;

/** Homework set from a lesson belongs to that lesson's tutor unless stated otherwise. */
create function public.homework_default_tutor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tutor_id is null and new.lesson_id is not null then
    select tutor_id into new.tutor_id from public.lessons where id = new.lesson_id;
  end if;
  return new;
end $$;
create trigger homework_default_tutor before insert on public.homework
  for each row execute function public.homework_default_tutor();

-- ---------------------------------------------------------------------------
-- Hand-ins
-- ---------------------------------------------------------------------------

create table public.homework_submissions (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homework(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_by_name text,
  note text,
  files jsonb not null default '[]' check (jsonb_typeof(files) = 'array'),
  submitted_at timestamptz not null default now(),
  feedback text,
  mark text,
  feedback_at timestamptz,
  feedback_by uuid references public.profiles(id) on delete set null,
  feedback_by_name text
);
create index homework_submissions_homework_idx on public.homework_submissions (homework_id);
create index homework_submissions_student_idx on public.homework_submissions (student_id);

alter table public.homework_submissions enable row level security;
create policy "see submissions" on public.homework_submissions for select to authenticated
  using (student_id = any (public.visible_student_ids()));
create policy "admin submissions" on public.homework_submissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Resource library
-- ---------------------------------------------------------------------------

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  -- Plain text on purpose: subjects and levels are free-form labels here.
  subject text,
  curriculum text,
  level text,
  kind text not null check (kind in ('file', 'link')),
  path text,
  url text,
  file_name text,
  mime_type text,
  tags text[] not null default '{}',
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  visibility text not null default 'tutors' check (visibility in ('tutors', 'students')),
  student_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  check ((kind = 'file' and path like 'resources/%' and position('..' in path) = 0) or (kind = 'link' and url ~* '^https?://'))
);
create index resources_students_idx on public.resources using gin (student_ids);

create function public.resources_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.uploaded_by := auth.uid();
      new.uploaded_by_name := (select full_name from public.profiles where id = auth.uid());
    end if;
  else
    new.uploaded_by := old.uploaded_by;
    new.uploaded_by_name := old.uploaded_by_name;
    new.created_at := old.created_at;
    -- Only admins may share with students the editor does not teach.
    if auth.uid() is not null and not public.is_admin() and exists (
      select 1 from unnest(new.student_ids) s
      where s <> all (old.student_ids) and s <> all (public.visible_student_ids())
    ) then
      raise exception 'You can only share resources with your own students.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger resources_before_write before insert or update on public.resources
  for each row execute function public.resources_before_write();

alter table public.resources enable row level security;
create policy "see resources" on public.resources for select to authenticated
  using (public.is_admin() or public.my_tutor_id() is not null or student_ids && public.visible_student_ids());
create policy "staff add resources" on public.resources for insert to authenticated
  with check ((public.is_admin() or public.my_tutor_id() is not null)
              and (public.is_admin() or student_ids <@ public.visible_student_ids()));
create policy "owner updates resources" on public.resources for update to authenticated
  using (public.is_admin() or uploaded_by = auth.uid())
  with check (public.is_admin() or uploaded_by = auth.uid());
create policy "owner deletes resources" on public.resources for delete to authenticated
  using (public.is_admin() or uploaded_by = auth.uid());

grant select, insert, update, delete on public.resources to authenticated;
grant select on public.homework_submissions to authenticated;
-- Hand-ins and feedback are written through the functions below only.
revoke insert, update, delete on public.homework_submissions from authenticated;
revoke all on public.resources, public.homework_submissions from anon;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

/** Notify a student's own login(s), if they have one. */
create function public.notify_student(
  p_student_id uuid, p_subject text, p_body text, p_push_title text, p_push_body text, p_url text, p_send_email boolean default true
) returns void language plpgsql security definer set search_path = public as $$
declare p record;
begin
  for p in select id, email from public.profiles where role = 'student' and student_id = p_student_id loop
    perform public.notify(p.id, p.email, p_subject, p_body, p_push_title, p_push_body, p_url, p_send_email);
  end loop;
end $$;
revoke all on function public.notify_student(uuid, text, text, text, text, text, boolean) from public, anon, authenticated;

-- New homework: the student hears straight away. Homework set outside a lesson also goes to the family;
-- homework set while recording a lesson is already listed in the lesson-notes email, so the student
-- gets a push only and the family is not told twice.
create function public.on_homework_set() returns trigger
language plpgsql security definer set search_path = public as $$
declare st public.students; first_name text; body text;
begin
  select * into st from public.students where id = new.student_id;
  first_name := split_part(st.full_name, ' ', 1);
  body := 'Due ' || to_char(new.due_date, 'DD Mon') || '.' || coalesce(E'\n\n' || nullif(trim(new.details), ''), '');
  perform public.notify_student(new.student_id, 'New homework: ' || new.title, body,
    'New homework', new.title || ' — due ' || to_char(new.due_date, 'DD Mon'), '/homework/' || new.id, new.lesson_id is null);
  if new.lesson_id is null then
    perform public.notify_family(st.family_id, 'New homework for ' || first_name || ': ' || new.title,
      first_name || ' has been set "' || new.title || '". ' || body
        || E'\n\nYou can view the details and any attached materials in the Elite Education app.',
      'New homework for ' || first_name, new.title || ' — due ' || to_char(new.due_date, 'DD Mon'), '/homework/' || new.id);
  end if;
  return new;
end $$;
create trigger homework_notify after insert on public.homework
  for each row execute function public.on_homework_set();

-- ---------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------

/** Set (p_id null) or edit a piece of homework. Admins, or tutors for students they teach. */
create function public.save_homework(
  p_id uuid, p_student_id uuid, p_title text, p_details text, p_due_date date, p_attachments jsonb, p_lesson_id uuid default null
) returns public.homework language plpgsql security definer set search_path = public as $$
declare h public.homework; atts jsonb := coalesce(p_attachments, '[]');
begin
  if not (public.is_admin() or (public.my_tutor_id() is not null and p_student_id = any (public.visible_student_ids()))) then
    raise exception 'You can only set homework for your own students.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'Please give the homework a title.'; end if;
  if p_due_date is null then raise exception 'Please choose a due date.'; end if;
  if not public.valid_attachments(atts, p_student_id) then
    raise exception 'One of the attachments could not be accepted. Please check the files and links and try again.';
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

/** A student or parent hands in homework. Marks it done and tells the tutor. */
create function public.submit_homework(p_homework_id uuid, p_note text, p_files jsonb)
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
  if not public.valid_attachments(files, h.student_id) then
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

/** A tutor (or admin) responds to a hand-in. The student and family are told. */
create function public.give_homework_feedback(p_submission_id uuid, p_feedback text, p_mark text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.homework_submissions; h public.homework; st public.students; me public.profiles; body text;
begin
  select * into s from public.homework_submissions where id = p_submission_id;
  if s.id is null and public.is_admin() then raise exception 'Hand-in not found'; end if;
  if s.id is null or not (public.is_admin()
      or (public.my_tutor_id() is not null and s.student_id = any (public.visible_student_ids()))) then
    raise exception 'You can only give feedback to your own students.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_feedback, ''))) = 0 then raise exception 'Please write some feedback first.'; end if;
  select * into me from public.profiles where id = auth.uid();
  update public.homework_submissions
     set feedback = trim(p_feedback), mark = nullif(trim(p_mark), ''), feedback_at = now(),
         feedback_by = auth.uid(), feedback_by_name = me.full_name
   where id = s.id
  returning * into s;

  select * into h from public.homework where id = s.homework_id;
  select * into st from public.students where id = s.student_id;
  body := s.feedback || coalesce(E'\n\nMark: ' || s.mark, '');
  perform public.notify_student(s.student_id, 'Feedback on ' || h.title, body,
    'Feedback on ' || h.title, left(s.feedback, 120), '/homework/' || h.id);
  perform public.notify_family(st.family_id, 'Feedback on ' || h.title,
    split_part(st.full_name, ' ', 1) || '''s tutor has reviewed "' || h.title || E'".\n\n' || body,
    'Feedback on ' || h.title, left(s.feedback, 120), '/homework/' || h.id);
end $$;

/** Share a library resource with a student. The student and family are told the first time. */
create function public.share_resource(p_resource_id uuid, p_student_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.resources; st public.students; first_name text;
begin
  if not (public.is_admin() or (public.my_tutor_id() is not null and p_student_id = any (public.visible_student_ids()))) then
    raise exception 'You can only share resources with your own students.' using errcode = '42501';
  end if;
  select * into r from public.resources where id = p_resource_id;
  if r.id is null then raise exception 'Resource not found'; end if;
  select * into st from public.students where id = p_student_id;
  if st.id is null then raise exception 'Student not found'; end if;
  if p_student_id = any (r.student_ids) then
    update public.resources set visibility = 'students' where id = r.id;
    return;
  end if;
  update public.resources set student_ids = student_ids || p_student_id, visibility = 'students' where id = r.id;

  first_name := split_part(st.full_name, ' ', 1);
  perform public.notify_student(p_student_id, 'A new resource from Elite Education: ' || r.title,
    'Your tutor has shared "' || r.title || '" with you.' || coalesce(E'\n\n' || nullif(trim(r.description), ''), '')
      || E'\n\nYou can find it under Homework in the Elite Education app.',
    'New resource', r.title, '/student/homework');
  perform public.notify_family(st.family_id, 'A new resource from Elite Education: ' || r.title,
    first_name || '''s tutor has shared "' || r.title || '".' || coalesce(E'\n\n' || nullif(trim(r.description), ''), '')
      || E'\n\nYou can find it in the Elite Education app.',
    'New resource for ' || first_name, r.title, '/parent/progress');
end $$;

revoke all on function public.save_homework(uuid, uuid, text, text, date, jsonb, uuid),
  public.submit_homework(uuid, text, jsonb), public.give_homework_feedback(uuid, text, text),
  public.share_resource(uuid, uuid) from public, anon;
grant execute on function public.valid_attachments(jsonb, uuid),
  public.save_homework(uuid, uuid, text, text, date, jsonb, uuid),
  public.submit_homework(uuid, text, jsonb), public.give_homework_feedback(uuid, text, text),
  public.share_resource(uuid, uuid) to authenticated;
revoke all on function public.homework_default_tutor(), public.resources_before_write(), public.on_homework_set()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Classwork storage: students/<student id>/… and resources/…
-- Path segments are compared as text, never cast, so a malformed path is simply refused.
-- ---------------------------------------------------------------------------

create function public.classwork_can_read(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(coalesce(p_name, ''), '/');
begin
  if coalesce(array_length(parts, 1), 0) < 2 or parts[array_length(parts, 1)] = '' or position('..' in p_name) > 0 then
    return false;
  end if;
  if parts[1] = 'students' then
    return array_length(parts, 1) >= 3 and parts[2] = any (public.visible_student_ids()::text[]);
  elsif parts[1] = 'resources' then
    return public.is_admin() or public.my_tutor_id() is not null
      or exists (select 1 from public.resources r where r.path = p_name and r.student_ids && public.visible_student_ids())
      or exists (select 1 from public.homework h where h.student_id = any (public.visible_student_ids())
                 and h.attachments @> jsonb_build_array(jsonb_build_object('path', p_name)));
  end if;
  return false;
end $$;

create function public.classwork_can_write(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(coalesce(p_name, ''), '/');
begin
  if coalesce(array_length(parts, 1), 0) < 2 or parts[array_length(parts, 1)] = '' or position('..' in p_name) > 0 then
    return false;
  end if;
  if parts[1] = 'students' then
    return array_length(parts, 1) >= 3 and parts[2] = any (public.visible_student_ids()::text[]);
  elsif parts[1] = 'resources' then
    return public.is_admin() or public.my_tutor_id() is not null;
  end if;
  return false;
end $$;

revoke all on function public.classwork_can_read(text), public.classwork_can_write(text) from public, anon;
grant execute on function public.classwork_can_read(text), public.classwork_can_write(text) to authenticated;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('classwork', 'classwork', false)
    on conflict (id) do nothing;
    execute $p$create policy "classwork read" on storage.objects for select to authenticated
      using (bucket_id = 'classwork' and public.classwork_can_read(name))$p$;
    execute $p$create policy "classwork upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'classwork' and public.classwork_can_write(name))$p$;
    execute $p$create policy "classwork delete" on storage.objects for delete to authenticated
      using (bucket_id = 'classwork' and (public.is_admin() or owner_id = auth.uid()::text))$p$;
  end if;
end $$;
