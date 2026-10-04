-- Elite Education — classwork hardening after review.
-- 1. Tutors no longer read the resources table directly for resources they did not add, so they cannot see which
--    students (other tutors' students, other families' children) a resource is shared with. Everyone reads the
--    library through list_resources(), which lists only the caller's own students in student_ids.
-- 2. A classwork file still referenced by a hand-in, homework or a library resource cannot be deleted from storage,
--    even by its uploader or an admin, so work already set or handed in never loses its file.

-- ---------------------------------------------------------------------------
-- Resource library: direct reads for admins and the uploader only
-- ---------------------------------------------------------------------------

drop policy "see resources" on public.resources;
-- The uploader still reads (and so can update) their own rows; everything else goes through list_resources().
create policy "see resources" on public.resources for select to authenticated
  using (public.is_admin() or (public.my_tutor_id() is not null and uploaded_by = auth.uid()));

-- ---------------------------------------------------------------------------
-- Classwork storage: never delete a file that is still in use
-- ---------------------------------------------------------------------------

/** True when no homework, hand-in or library resource refers to the stored file p_name (classwork bucket). */
create function public.classwork_can_delete(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_name is not null and length(p_name) > 0
    and not exists (select 1 from public.homework h where h.attachments @> jsonb_build_array(jsonb_build_object('path', p_name)))
    and not exists (select 1 from public.homework_submissions s where s.files @> jsonb_build_array(jsonb_build_object('path', p_name)))
    and not exists (select 1 from public.resources r where r.path = p_name)
$$;
revoke all on function public.classwork_can_delete(text) from public, anon;
grant execute on function public.classwork_can_delete(text) to authenticated;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute 'drop policy if exists "classwork delete" on storage.objects';
    execute $p$create policy "classwork delete" on storage.objects for delete to authenticated
      using (bucket_id = 'classwork' and (public.is_admin() or owner_id = auth.uid()::text)
             and public.classwork_can_delete(name))$p$;
  end if;
end $$;
