-- Sign in with Apple and Google.
--
-- A person who signs in with Apple or Google and whose email we do not recognise becomes a
-- prospect parent with their own family, exactly as a parent who signs up with signup='parent'
-- does today. Tutor and family emails that we already know still link as before.
--
-- The login provider is taken from raw_app_meta_data, which only the auth server can set, so a
-- person cannot pretend to be a social login by writing auth_provider into their own metadata.
--
-- Apple can hide a person's email behind a private-relay address. When the office later changes a
-- family's email to that relay address, the login moves to that family, provided the prospect
-- family it was given has no children. Nothing is ever deleted; the empty prospect family is archived.
--
-- Apple sends the person's name only to the device, and only the first time, so the app saves it
-- afterwards with set_my_name().

create or replace function public.link_login(p_user_id uuid, p_email text, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.tutors; f public.families; parent_name text; family_name text; fam_id uuid;
  provider text := coalesce(p_meta->>'auth_provider', '');
  is_social boolean := coalesce(p_meta->>'auth_provider', '') in ('apple', 'google');
  provider_label text;
begin
  if exists (select 1 from public.profiles where id = p_user_id) then return; end if;

  select * into t from public.tutors where lower(email) = lower(p_email) limit 1;
  if t.id is not null then
    insert into public.profiles (id, role, full_name, email, tutor_id) values (p_user_id, 'tutor', t.full_name, p_email, t.id);
    return;
  end if;

  select * into f from public.families where lower(email) = lower(p_email) limit 1;
  if f.id is not null then
    insert into public.profiles (id, role, full_name, email, family_id) values (p_user_id, 'parent', f.parent_name, p_email, f.id);
    return;
  end if;

  -- A parent signing up through the app, or with Apple or Google, who we don't know yet: give them their own (prospect) family.
  if p_meta->>'signup' = 'parent' or is_social then
    parent_name := coalesce(
      nullif(trim(p_meta->>'full_name'), ''),
      nullif(trim(p_meta->>'name'), ''),
      nullif(trim(concat_ws(' ', nullif(trim(p_meta->>'given_name'), ''), nullif(trim(p_meta->>'family_name'), ''))), ''));
    family_name := nullif(trim(p_meta->>'family_name'), '');

    if parent_name is null then
      if not is_social then return; end if;
      if lower(p_email) not like '%@privaterelay.appleid.com' then
        parent_name := nullif(trim(initcap(regexp_replace(split_part(p_email, '@', 1), '[._-]+', ' ', 'g'))), '');
      end if;
      if parent_name is null then
        parent_name := 'New parent';
        family_name := 'New family';
      end if;
    end if;

    insert into public.families (name, parent_name, email, phone, status)
    values (coalesce(family_name, regexp_replace(parent_name, '^.*\s', '')),
            parent_name, p_email, nullif(trim(p_meta->>'phone'), ''), 'prospect')
    returning id into fam_id;
    -- Creating the family fires the families_link_login trigger, which may already have linked this login.
    insert into public.profiles (id, role, full_name, email, phone, family_id)
    values (p_user_id, 'parent', parent_name, p_email, nullif(trim(p_meta->>'phone'), ''), fam_id)
    on conflict (id) do update set phone = excluded.phone;

    if p_meta->>'signup' = 'parent' and not is_social then
      perform public.notify_admins('New parent sign-up: ' || parent_name,
        parent_name || ' (' || p_email || ') created an account in the app.', 'New sign-up', parent_name, '/admin/enquiries');
    else
      provider_label := case provider when 'apple' then 'Apple' else 'Google' end;
      perform public.notify_admins('New parent sign-up (' || provider_label || '): ' || parent_name,
        parent_name || ' (' || p_email || ') created an account in the app with ' || provider_label || '.',
        'New sign-up', parent_name, '/admin/enquiries');
    end if;
  end if;
end $$;
revoke all on function public.link_login(uuid, text, jsonb) from public, anon, authenticated;

-- The provider is added last so that it overrides anything a person put in their own metadata.
create or replace function public.on_auth_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and new.email is not null then
    perform public.link_login(new.id, new.email,
      coalesce(new.raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('auth_provider', new.raw_app_meta_data->>'provider'));
  end if;
  return new;
end $$;
-- The link_login_on_signup trigger (after insert or update of email_confirmed_at on auth.users) is unchanged.

-- When a tutor or family email changes, link any confirmed login with that email. A login that was
-- given its own empty prospect family (for example an Apple private-relay login) moves to the family.
create or replace function public.link_existing_login() returns trigger
language plpgsql security definer set search_path = public as $$
declare u record; p public.profiles; old_fam public.families;
begin
  for u in select id, email from auth.users where lower(email) = lower(new.email) and email_confirmed_at is not null loop
    p := null;
    old_fam := null;
    if TG_TABLE_NAME = 'families' then
      select * into p from public.profiles where id = u.id and role = 'parent' and family_id is distinct from new.id;
      if p.id is not null and p.family_id is not null then
        select * into old_fam from public.families where id = p.family_id;
      end if;
    end if;
    if old_fam.id is not null and old_fam.status = 'prospect'
       and not exists (select 1 from public.students where family_id = old_fam.id) then
      update public.profiles set family_id = new.id, full_name = new.parent_name where id = p.id;
      update public.families set status = 'archived' where id = old_fam.id;
    else
      perform public.link_login(u.id, u.email);
    end if;
  end loop;
  return new;
end $$;
-- The tutors_link_login and families_link_login triggers are unchanged.

/** A parent saves their own name (Apple only sends it to the device, and only the first time). */
create or replace function public.set_my_name(p_full_name text)
returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles; clean text := trim(coalesce(p_full_name, ''));
begin
  if auth.uid() is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  if clean = '' or length(clean) > 120 then raise exception 'Please enter your name.'; end if;
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role <> 'parent' then return; end if;
  update public.profiles set full_name = clean where id = me.id;
  if me.family_id is not null then
    update public.families
       set parent_name = clean, name = regexp_replace(clean, '^.*\s', '')
     where id = me.family_id and status = 'prospect' and parent_name = me.full_name;
  end if;
end $$;
revoke all on function public.set_my_name(text) from public, anon;
grant execute on function public.set_my_name(text) to authenticated;
