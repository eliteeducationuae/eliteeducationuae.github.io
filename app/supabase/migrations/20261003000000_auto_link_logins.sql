-- Link logins to tutors and families automatically.
--
-- The admin adds a tutor or family in the app (with their email). When that person creates an
-- account — or the admin adds them under Authentication → Users — and the email is confirmed,
-- they get a tutor or parent profile. Unknown emails get no profile, so they can't see anything.
-- Waiting for email confirmation stops someone claiming a family by typing its email address.

create function public.link_login(p_user_id uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tutors; f public.families;
begin
  if exists (select 1 from public.profiles where id = p_user_id) then return; end if;

  select * into t from public.tutors where lower(email) = lower(p_email) limit 1;
  if t.id is not null then
    insert into public.profiles (id, role, full_name, email, tutor_id)
    values (p_user_id, 'tutor', t.full_name, p_email, t.id);
    return;
  end if;

  select * into f from public.families where lower(email) = lower(p_email) limit 1;
  if f.id is not null then
    insert into public.profiles (id, role, full_name, email, family_id)
    values (p_user_id, 'parent', f.parent_name, p_email, f.id);
  end if;
end $$;
revoke all on function public.link_login(uuid, text) from public, anon, authenticated;

create function public.on_auth_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and new.email is not null then
    perform public.link_login(new.id, new.email);
  end if;
  return new;
end $$;

create trigger link_login_on_signup
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.on_auth_user_confirmed();

-- Also link anyone who signs up before the admin has added them: when a tutor or family is
-- saved, connect any confirmed login that already uses that email.
create function public.link_existing_login() returns trigger
language plpgsql security definer set search_path = public as $$
declare u record;
begin
  for u in select id, email from auth.users
           where lower(email) = lower(new.email) and email_confirmed_at is not null loop
    perform public.link_login(u.id, u.email);
  end loop;
  return new;
end $$;

create trigger tutors_link_login after insert or update of email on public.tutors
  for each row execute function public.link_existing_login();
create trigger families_link_login after insert or update of email on public.families
  for each row execute function public.link_existing_login();

-- Admins can see which tutors and families have logged in (for the "has a login" badge).
create function public.login_emails() returns setof text
language sql stable security definer set search_path = public as $$
  select lower(email) from public.profiles where public.is_admin()
$$;
grant execute on function public.login_emails() to authenticated;

-- Link anyone who already exists.
select public.link_login(id, email) from auth.users where email_confirmed_at is not null and email is not null;
