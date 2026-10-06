-- Elite Education — database security audit fixes (whole schema, 20261002000000_init.sql onwards).
--
--  1. A former tutor kept a child's data for ever. visible_student_ids() gave a tutor every student they had EVER had a
--     lesson with, so a tutor whose subject the office had moved to someone else (or who once covered a lesson) could
--     still read the student's record, every new homework and hand-in (and the files in storage), topic ratings,
--     enrolments, the family's row with the main contact's email and telephone number, and the office's tutor-only
--     student notes, which they could also rewrite; they could set homework, upload into the child's folder and share
--     resources with the child. can_access_thread() used the same lesson history, so they also read and wrote in the
--     family's private conversation with the office indefinitely.
--     A tutor now sees the students they currently teach, matching the handover packs (20261113001300_handoverac_fix):
--     an active enrolment taught by them, a lesson with them that is still scheduled (including one not yet recorded),
--     a lesson with them that took place within the last 7 days, or a report assigned to them that is still being
--     written. Their own lessons, lesson notes and private notes stay readable through the lesson policies, as before.
--  2. Message sender names could be forged. The "send messages" policy let anyone in a conversation insert straight
--     into public.messages with any sender_name (only sender_id and sender_role were checked), so a parent or tutor
--     could post as "Elite Education Office", for example asking the family to pay into another account. The app
--     always sends through public.send_message, which takes the name from the sender's profile, so direct writes to
--     messages are now refused.
--  3. Anyone, signed out, can upload a CV to the applications bucket, which had no size or type limit. It now takes
--     PDF, Word and image files of up to 10 MB, like the other buckets.
--  4. Signed-out visitors no longer hold privileges on any sequence (Supabase grants them by default; the
--     calendar_sync_queue and submission_log counters were readable and could be advanced by anyone).
--  5. The migrations ledger records this file.

-- ---------------------------------------------------------------------------
-- 1. Which students a person can see
-- ---------------------------------------------------------------------------

/** The students the caller can see: all (admin), their family's (parent), themselves (student), or the ones a tutor currently teaches. */
create or replace function public.visible_student_ids() returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if p is null then return '{}'; end if;
  if p.role = 'admin' then return array(select id from public.students); end if;
  if p.role = 'parent' then return array(select id from public.students where family_id = p.family_id); end if;
  if p.role = 'student' then return array[p.student_id]; end if;
  if p.role <> 'tutor' or p.tutor_id is null then return '{}'; end if;
  -- A tutor: the students they currently teach (see the header).
  return array(
    select student_id from public.enrolments where active and tutor_id = p.tutor_id
    union
    select unnest(l.student_ids) from public.lessons l
     where l.tutor_id = p.tutor_id
       and (l.status = 'scheduled'
            or (l.status in ('completed', 'no-show', 'late-cancel') and l.end_at > now() - interval '7 days'))
    union
    select r.student_id from public.student_reports r
     where r.tutor_id = p.tutor_id and r.status in ('draft', 'submitted'));
end $$;
revoke all on function public.visible_student_ids() from public, anon;
grant execute on function public.visible_student_ids() to authenticated;

/** Whether the caller can read and write in a family's conversation: the office, the family, or a tutor who currently teaches one of its children. */
create or replace function public.can_access_thread(p_family_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.is_admin()
    or public.my_family_id() = p_family_id
    or (public.my_tutor_id() is not null and exists (
      select 1 from public.students s where s.family_id = p_family_id and s.id = any (public.visible_student_ids()))),
    false)
$$;
revoke all on function public.can_access_thread(uuid) from public, anon;
grant execute on function public.can_access_thread(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Messages are written only through send_message
-- ---------------------------------------------------------------------------

drop policy if exists "send messages" on public.messages;
revoke insert, update, delete, truncate on public.messages from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. CV uploads: PDF, Word or an image, up to 10 MB
-- ---------------------------------------------------------------------------

update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['application/pdf', 'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
 where id = 'applications';

-- ---------------------------------------------------------------------------
-- 4. No sequence privileges for signed-out visitors
-- ---------------------------------------------------------------------------

revoke all on all sequences in schema public from anon;

-- ---------------------------------------------------------------------------
-- 5. Ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261114000200', 'sec_db');
