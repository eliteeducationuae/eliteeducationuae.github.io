-- Elite Education — several contacts per family.
--
-- A family can now have any number of contacts: mother, father, guardian, a PA, the family office, a driver. Each
-- contact says what they receive (invoices and payment notices, reports, lesson notes and homework) and whether they
-- may sign in. Every family notification is sent to each contact who receives that kind of notice, and any contact
-- allowed to sign in can create a login with their own email address (including an Apple private-relay address).
--
-- DESIGN DECISION: families.parent_name, families.email and families.phone are KEPT as a read-only mirror of the main
-- (primary) contact, so that everything which reads them keeps working unchanged: the Stripe customer email in
-- create-checkout, invoices and their PDFs, message thread titles, the WhatsApp first-name fallback, enquiry conversion
-- and older builds of the app. The sync runs both ways:
--   * writing families.parent_name/email/phone (the legacy saveFamily, link_login self-sign-up, set_my_name) updates the
--     main contact;
--   * changing the main contact, or which contact is the main one, updates families.
-- Recursion is avoided by only writing values that are actually different (IS DISTINCT FROM), and by only copying a
-- column across when that column changed.
--
-- Rules kept by the database:
--   * every family that has contacts has exactly one main contact, and the main contact has an email address;
--   * a contact who can sign in has an email address, and a sign-in email belongs to one family only;
--   * one login is linked to at most one contact (family_contacts.profile_id).
-- Bank details never appear in any notification, email or WhatsApp message.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table public.family_contacts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  relationship text not null default 'parent'
    check (relationship in ('mother', 'father', 'parent', 'guardian', 'pa', 'family_office', 'driver', 'other')),
  -- Stored lower-case and trimmed (see family_contacts_before); never an empty string.
  email text check (email is null or (email <> '' and email = lower(btrim(email)))),
  phone text,
  preferred_channel text not null default 'email' check (preferred_channel in ('email', 'phone', 'whatsapp')),
  can_log_in boolean not null default true,
  receives_invoices boolean not null default true,
  receives_reports boolean not null default true,
  receives_lesson_notes boolean not null default true,
  -- For a contact with a login this mirrors profiles.whatsapp_opt_in: a login's WhatsApp consent is their own.
  receives_whatsapp boolean not null default false,
  emergency_contact boolean not null default false,
  is_primary boolean not null default false,
  -- The login linked to this contact, if they have signed in.
  profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint family_contacts_login_needs_email check (not can_log_in or email is not null),
  constraint family_contacts_primary_needs_email check (not is_primary or email is not null)
);
create unique index family_contacts_one_primary on public.family_contacts (family_id) where is_primary;
create unique index family_contacts_family_email on public.family_contacts (family_id, lower(email)) where email is not null;
-- A sign-in email belongs to one family.
create unique index family_contacts_login_email on public.family_contacts (lower(email)) where can_log_in;
create unique index family_contacts_profile on public.family_contacts (profile_id) where profile_id is not null;
create index family_contacts_family_idx on public.family_contacts (family_id, created_at);

-- WhatsApp messages for contacts without a login are queued against the contact rather than a profile.
alter table public.notification_outbox
  add column contact_id uuid references public.family_contacts(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** A phone number as WhatsApp needs it (E.164, e.g. +971501234567), with spaces, dashes and brackets removed; else null. */
create function public.contact_whatsapp_number(p_phone text) returns text
language sql immutable set search_path = public as $$
  -- A UAE number must be a complete mobile (+971 5X XXX XXXX); a shortened one such as '050 123' is refused.
  select n from (select regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g') as n) x
  where n ~ '^\+[1-9][0-9]{7,14}$' and (n !~ '^\+971' or n ~ '^\+9715[0-9]{8}$')
$$;

/** How a relationship reads in a sentence: 'mother', 'PA', 'family office'. */
create function public.contact_relationship_label(p_relationship text) returns text
language sql immutable set search_path = public as $$
  select case p_relationship
    when 'pa' then 'PA'
    when 'family_office' then 'family office'
    else coalesce(p_relationship, 'contact')
  end
$$;

/**
 * Whether another family's sign-in contact with this email may give the email up. It may when its family is archived,
 * or when it is a login sitting alone in an empty prospect family (no children, no other parent login): for example an
 * Apple private-relay login that was given its own prospect family before the office added the relay address to the
 * right family. The login then moves (see contact_link_existing_login) and the empty prospect family is archived.
 */
create function public.contact_login_releasable(c public.family_contacts) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select f.status = 'archived'
      or (f.status = 'prospect' and c.profile_id is not null
          and not exists (select 1 from public.students st where st.family_id = f.id)
          and not exists (select 1 from public.profiles p where p.family_id = f.id and p.role = 'parent' and p.id <> c.profile_id))
    from public.families f where f.id = c.family_id), false)
$$;

/** True when another family has a sign-in contact with this email that cannot give it up. */
create function public.login_email_taken(p_email text, p_family_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_contacts c
    where c.email = lower(btrim(p_email)) and c.can_log_in and c.family_id <> p_family_id
      and not public.contact_login_releasable(c))
$$;

/** Free a sign-in email held by another family's contact that may give it up (see contact_login_releasable). */
create function public.release_login_email(p_email text, p_family_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.family_contacts; f public.families;
begin
  for c in select * from public.family_contacts
           where email = lower(btrim(p_email)) and can_log_in and family_id <> p_family_id for update loop
    if public.contact_login_releasable(c) then
      select * into f from public.families where id = c.family_id;
      -- Revoking the sign-in also unlinks the login (family_contacts_revoke); the new contact links it again.
      update public.family_contacts set can_log_in = false where id = c.id;
      if f.status = 'prospect' then update public.families set status = 'archived' where id = f.id; end if;
    end if;
  end loop;
end $$;

/**
 * Link a parent login to a contact in its family: the contact with the same email, or a new contact when there is none
 * (the main contact if the family has none yet). The contact's WhatsApp flag mirrors the login's own consent.
 * Contacts in other families that pointed at this login are unlinked; one with the login's own email also stops
 * signing in there, since the login has moved.
 */
create function public.link_parent_profile(p public.profiles) returns void
language plpgsql security definer set search_path = public as $$
declare c public.family_contacts; v_email text := nullif(lower(btrim(p.email)), ''); v_login boolean;
begin
  if p.role is distinct from 'parent' then return; end if;
  update public.family_contacts
    set profile_id = null, can_log_in = case when email = v_email then false else can_log_in end
    where profile_id = p.id and family_id is distinct from p.family_id;
  if p.family_id is null then return; end if;

  select * into c from public.family_contacts
    where family_id = p.family_id and (profile_id = p.id or (v_email is not null and email = v_email))
    order by (profile_id is not distinct from p.id) desc limit 1;
  if c.id is not null then
    v_login := c.email is not null and (c.can_log_in or not exists (
      select 1 from public.family_contacts o where o.email = c.email and o.can_log_in and o.family_id <> c.family_id));
    update public.family_contacts set profile_id = p.id, can_log_in = v_login, receives_whatsapp = p.whatsapp_opt_in
      where id = c.id and (profile_id, can_log_in, receives_whatsapp) is distinct from (p.id, v_login, p.whatsapp_opt_in);
  else
    insert into public.family_contacts (family_id, name, relationship, email, phone, can_log_in, receives_whatsapp,
      is_primary, profile_id)
    values (p.family_id,
      left(coalesce(nullif(btrim(p.full_name), ''), nullif(split_part(v_email, '@', 1), ''), 'Parent'), 120), 'parent',
      v_email, coalesce(p.whatsapp_number, nullif(btrim(p.phone), '')),
      v_email is not null and not exists (
        select 1 from public.family_contacts o where o.email = v_email and o.can_log_in and o.family_id <> p.family_id),
      p.whatsapp_opt_in,
      v_email is not null and not exists (select 1 from public.family_contacts o where o.family_id = p.family_id and o.is_primary),
      p.id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill
-- ---------------------------------------------------------------------------

-- One main contact per family from parent_name/email/phone. Where several families share an email, only one of them
-- keeps it as a sign-in: the family with a matching parent login, then any parent login, then active, then the oldest.
insert into public.family_contacts (family_id, name, relationship, email, phone, can_log_in, is_primary, created_at)
select f.id,
  left(coalesce(nullif(btrim(f.parent_name), ''), nullif(btrim(f.name), ''), 'Main contact'), 120), 'parent',
  lower(btrim(f.email)), nullif(btrim(f.phone), ''),
  row_number() over (partition by lower(btrim(f.email)) order by
    exists (select 1 from public.profiles p where p.family_id = f.id and p.role = 'parent' and lower(p.email) = lower(btrim(f.email))) desc,
    exists (select 1 from public.profiles p where p.family_id = f.id and p.role = 'parent') desc,
    (f.status = 'active') desc, f.created_at, f.id) = 1,
  true, f.created_at
from public.families f
where nullif(btrim(f.email), '') is not null;

-- Every parent login is linked to its contact, or given one.
do $$
declare p public.profiles;
begin
  for p in select * from public.profiles where role = 'parent' and family_id is not null order by email, id loop
    perform public.link_parent_profile(p);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers on family_contacts
-- ---------------------------------------------------------------------------

/** Tidy values, unlink a login whose sign-in is withdrawn, and free a sign-in email another family may give up. */
create function public.family_contacts_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  new.email := nullif(lower(btrim(new.email)), '');
  new.phone := nullif(btrim(new.phone), '');
  if tg_op = 'UPDATE' and old.can_log_in and not new.can_log_in then new.profile_id := null; end if;
  if new.can_log_in and new.email is not null
     and (tg_op = 'INSERT' or new.email is distinct from old.email or not old.can_log_in) then
    perform public.release_login_email(new.email, new.family_id);
  end if;
  return new;
end $$;
create trigger family_contacts_before before insert or update on public.family_contacts
  for each row execute function public.family_contacts_before();

/** The main contact is mirrored to families.parent_name/email/phone (phone only when set; the email is never cleared). */
create function public.family_contacts_sync_family() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_primary then
    update public.families set
      parent_name = new.name,
      email = case when new.email is not null and lower(email) is distinct from new.email then new.email else email end,
      phone = coalesce(new.phone, phone)
    where id = new.family_id
      and (parent_name is distinct from new.name
        or (new.email is not null and lower(email) is distinct from new.email)
        or (new.phone is not null and phone is distinct from new.phone));
  end if;
  return new;
end $$;
create trigger family_contacts_sync_family after insert or update on public.family_contacts
  for each row execute function public.family_contacts_sync_family();

/**
 * A contact who can sign in: link any confirmed login with that email (as link_existing_login did for families.email).
 * A login sitting alone in an empty prospect family (or with no family at all) moves to this family; the empty prospect
 * family is archived, never deleted. This is how Apple private-relay addresses are added: as a sign-in contact.
 */
create function public.contact_link_existing_login() returns trigger
language plpgsql security definer set search_path = public as $$
declare u record; p public.profiles; old_fam public.families;
begin
  if not new.can_log_in or new.email is null then return new; end if;
  if tg_op = 'UPDATE' and old.can_log_in and old.email is not distinct from new.email then return new; end if;
  for u in select id, email from auth.users where lower(email) = new.email and email_confirmed_at is not null loop
    p := null;
    old_fam := null;
    select * into p from public.profiles where id = u.id;
    if p.id is null then
      perform public.link_login(u.id, u.email);
    elsif p.role = 'parent' and p.family_id is distinct from new.family_id then
      if p.family_id is not null then select * into old_fam from public.families where id = p.family_id; end if;
      if p.family_id is null then
        update public.profiles set family_id = new.family_id, full_name = new.name where id = p.id;
      elsif old_fam.status = 'prospect' and not exists (select 1 from public.students where family_id = old_fam.id) then
        update public.profiles set family_id = new.family_id, full_name = new.name where id = p.id;
        update public.families set status = 'archived' where id = old_fam.id;
      end if;
    end if;
  end loop;
  return new;
end $$;
create trigger family_contacts_link_login after insert or update of email, can_log_in on public.family_contacts
  for each row execute function public.contact_link_existing_login();

/** Revoking access: deleting a contact with a login, or withdrawing their sign-in, takes the login out of the family. */
create function public.family_contacts_revoke() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.profile_id is not null and (tg_op = 'DELETE' or (old.can_log_in and not new.can_log_in)) then
    update public.profiles set family_id = null where id = old.profile_id and family_id = old.family_id;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger family_contacts_revoke after update of can_log_in or delete on public.family_contacts
  for each row execute function public.family_contacts_revoke();

/** A linked login carries its contact's name, so messages show the name the family gave. */
create function public.family_contacts_name_to_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set full_name = new.name where id = new.profile_id and full_name is distinct from new.name;
  return new;
end $$;
create trigger family_contacts_name_to_profile after update of name on public.family_contacts
  for each row when (new.profile_id is not null and old.name is distinct from new.name)
  execute function public.family_contacts_name_to_profile();

/** Withdrawing a contact's WhatsApp consent skips anything still waiting to be sent to them. */
create function public.family_contacts_whatsapp_off() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.notification_outbox set whatsapp_status = 'skipped'
  where contact_id = new.id and whatsapp and whatsapp_status = 'pending';
  return new;
end $$;
create trigger family_contacts_whatsapp_off after update of receives_whatsapp on public.family_contacts
  for each row when (old.receives_whatsapp and not new.receives_whatsapp)
  execute function public.family_contacts_whatsapp_off();

/** Checked at commit: every family that has contacts has exactly one main contact. */
create function public.family_contacts_check_primary() returns trigger
language plpgsql security definer set search_path = public as $$
declare fid uuid := case when tg_op = 'DELETE' then old.family_id else new.family_id end;
begin
  if exists (select 1 from public.family_contacts where family_id = fid)
     and (select count(*) from public.family_contacts where family_id = fid and is_primary) <> 1 then
    raise exception 'Every family needs exactly one main contact.';
  end if;
  if tg_op = 'UPDATE' and old.family_id is distinct from new.family_id
     and exists (select 1 from public.family_contacts where family_id = old.family_id)
     and (select count(*) from public.family_contacts where family_id = old.family_id and is_primary) <> 1 then
    raise exception 'Every family needs exactly one main contact.';
  end if;
  return null;
end $$;
create constraint trigger family_contacts_one_primary_check
  after insert or update or delete on public.family_contacts
  deferrable initially deferred
  for each row execute function public.family_contacts_check_primary();

-- ---------------------------------------------------------------------------
-- 3. Families <-> main contact
-- ---------------------------------------------------------------------------

/** A new family gets its main contact from parent_name/email/phone. */
create function public.families_create_contact() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text := nullif(lower(btrim(new.email)), '');
begin
  if v_email is null or exists (select 1 from public.family_contacts where family_id = new.id and is_primary) then
    return new;
  end if;
  insert into public.family_contacts (family_id, name, relationship, email, phone, can_log_in, is_primary)
  values (new.id, left(coalesce(nullif(btrim(new.parent_name), ''), nullif(btrim(new.name), ''), 'Main contact'), 120),
    'parent', v_email, nullif(btrim(new.phone), ''), not public.login_email_taken(v_email, new.id), true);
  return new;
end $$;
create trigger families_create_contact after insert on public.families
  for each row execute function public.families_create_contact();

/**
 * Writing families.parent_name/email/phone (the legacy family form, self-sign-up, set_my_name) updates the main contact.
 * When the new email is another contact's in the same family, that contact becomes the main contact. When it already
 * signs in to another family, the main contact keeps it but cannot sign in with it.
 */
create function public.families_sync_contact() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.family_contacts; other public.family_contacts;
  v_email text := nullif(lower(btrim(new.email)), '');
  v_name text := left(nullif(btrim(new.parent_name), ''), 120);
begin
  select * into c from public.family_contacts where family_id = new.id and is_primary;
  if c.id is null then
    if v_email is not null then perform public.families_create_contact_for(new); end if;
    return new;
  end if;

  if old.email is distinct from new.email and v_email is not null and v_email is distinct from c.email then
    select * into other from public.family_contacts where family_id = new.id and email = v_email and id <> c.id;
    if other.id is not null then
      update public.family_contacts set is_primary = false where id = c.id;
      update public.family_contacts set is_primary = true,
        name = case when old.parent_name is distinct from new.parent_name and v_name is not null then v_name else name end,
        phone = case when old.phone is distinct from new.phone and new.phone is not null then new.phone else phone end
      where id = other.id;
      return new;
    end if;
  end if;

  update public.family_contacts set
    email = case when old.email is distinct from new.email and v_email is not null then v_email else email end,
    can_log_in = case
      when old.email is distinct from new.email and v_email is not null and v_email is distinct from c.email and can_log_in
        then not public.login_email_taken(v_email, new.id)
      else can_log_in end,
    name = case when old.parent_name is distinct from new.parent_name and v_name is not null then v_name else name end,
    phone = case when old.phone is distinct from new.phone then nullif(btrim(new.phone), '') else phone end
  where id = c.id
    and ((old.email is distinct from new.email and v_email is not null and v_email is distinct from c.email)
      or (old.parent_name is distinct from new.parent_name and v_name is not null and v_name is distinct from c.name)
      or (old.phone is distinct from new.phone and nullif(btrim(new.phone), '') is distinct from c.phone));
  return new;
end $$;

/** As families_create_contact, for a family that had no usable email when it was created. */
create function public.families_create_contact_for(f public.families) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := nullif(lower(btrim(f.email)), '');
begin
  if v_email is null or exists (select 1 from public.family_contacts where family_id = f.id and is_primary) then return; end if;
  if exists (select 1 from public.family_contacts where family_id = f.id and email = v_email) then
    update public.family_contacts set is_primary = true where family_id = f.id and email = v_email;
    return;
  end if;
  insert into public.family_contacts (family_id, name, relationship, email, phone, can_log_in, is_primary)
  values (f.id, left(coalesce(nullif(btrim(f.parent_name), ''), nullif(btrim(f.name), ''), 'Main contact'), 120),
    'parent', v_email, nullif(btrim(f.phone), ''), not public.login_email_taken(v_email, f.id), true);
end $$;

create trigger families_sync_contact after update of parent_name, email, phone on public.families
  for each row execute function public.families_sync_contact();

-- The main contact's sign-in trigger (family_contacts_link_login) now links logins for families, so the families
-- trigger from 20261004000000_engagement.sql is dropped. tutors_link_login is unchanged.
drop trigger if exists families_link_login on public.families;

-- ---------------------------------------------------------------------------
-- 4. Profiles <-> contacts
-- ---------------------------------------------------------------------------

create function public.profiles_link_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.link_parent_profile(new);
  return new;
end $$;
create trigger profiles_link_contact_insert after insert on public.profiles
  for each row when (new.role = 'parent')
  execute function public.profiles_link_contact();
create trigger profiles_link_contact_update after update of family_id, email on public.profiles
  for each row when (new.role = 'parent' and (old.family_id is distinct from new.family_id or old.email is distinct from new.email))
  execute function public.profiles_link_contact();

/** A linked login's WhatsApp consent is their own; their contact's flag mirrors it. */
create function public.profiles_whatsapp_to_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.family_contacts set receives_whatsapp = new.whatsapp_opt_in
  where profile_id = new.id and receives_whatsapp is distinct from new.whatsapp_opt_in;
  return new;
end $$;
create trigger profiles_whatsapp_to_contact after update of whatsapp_opt_in on public.profiles
  for each row when (old.whatsapp_opt_in is distinct from new.whatsapp_opt_in)
  execute function public.profiles_whatsapp_to_contact();

-- ---------------------------------------------------------------------------
-- 5. link_login: any contact who can sign in
-- ---------------------------------------------------------------------------

-- As 20261006000000_social_sign_in.sql, except that a known parent is found through family_contacts (any contact who
-- can sign in) rather than families.email. NOTE for sibling migrations: any later migration that redefines link_login
-- must keep this contact lookup, or second contacts and Apple private-relay contacts will stop being able to sign in.
create or replace function public.link_login(p_user_id uuid, p_email text, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.tutors; c public.family_contacts; parent_name text; family_name text; fam_id uuid;
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

  select fc.* into c from public.family_contacts fc join public.families f on f.id = fc.family_id
    where fc.email = lower(btrim(p_email)) and fc.can_log_in
    order by (f.status <> 'archived') desc, fc.is_primary desc, fc.created_at
    limit 1;
  if c.id is not null then
    -- The profiles trigger links the contact (profile_id) and mirrors WhatsApp consent.
    insert into public.profiles (id, role, full_name, email, family_id) values (p_user_id, 'parent', c.name, p_email, c.family_id);
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
    values (coalesce(family_name, public.surname_of(parent_name)),
            parent_name, p_email, nullif(trim(p_meta->>'phone'), ''), 'prospect')
    returning id into fam_id;
    -- Creating the family creates its main contact, whose sign-in trigger may already have linked this login.
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

-- ---------------------------------------------------------------------------
-- 7. Row-level security
-- ---------------------------------------------------------------------------

alter table public.family_contacts enable row level security;
-- Admins and the family itself read contacts directly. Tutors read names only, through list_family_contacts.
-- There are no write policies: every change goes through save_family_contact and remove_family_contact.
create policy "see family contacts" on public.family_contacts for select to authenticated
  using (public.is_admin() or family_id = public.my_family_id());
revoke all on public.family_contacts from public, anon, authenticated;
grant select on public.family_contacts to authenticated;

-- ---------------------------------------------------------------------------
-- 8. RPCs
-- ---------------------------------------------------------------------------

/**
 * A family's contacts, main contact first. Admins and the family see everything; a tutor who teaches the family sees
 * only names and relationships (no email, phone or login); anyone else sees nothing.
 */
create function public.list_family_contacts(p_family_id uuid)
returns table (id uuid, family_id uuid, name text, relationship text, email text, phone text, preferred_channel text,
  can_log_in boolean, receives_invoices boolean, receives_reports boolean, receives_lesson_notes boolean,
  receives_whatsapp boolean, emergency_contact boolean, is_primary boolean, has_login boolean, profile_id uuid,
  created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_admin() or public.my_family_id() = p_family_id then
    return query
      select c.id, c.family_id, c.name, c.relationship, c.email, c.phone, c.preferred_channel, c.can_log_in,
        c.receives_invoices, c.receives_reports, c.receives_lesson_notes, c.receives_whatsapp, c.emergency_contact,
        c.is_primary, c.profile_id is not null, c.profile_id, c.created_at
      from public.family_contacts c where c.family_id = p_family_id
      order by c.is_primary desc, c.created_at, c.id;
  elsif public.my_tutor_id() is not null and public.can_access_thread(p_family_id) then
    return query
      select c.id, c.family_id, c.name, c.relationship, null::text, null::text, 'email'::text, false, false, false, false,
        false, false, c.is_primary, false, null::uuid, c.created_at
      from public.family_contacts c where c.family_id = p_family_id
      order by c.is_primary desc, c.created_at, c.id;
  end if;
end $$;

/**
 * Add (no id) or update (id) a family contact. Admins, or a parent of the family. Returns the contact's id.
 * Keys: id, name, relationship, email, phone, preferred_channel, can_log_in, receives_invoices, receives_reports,
 * receives_lesson_notes, receives_whatsapp, emergency_contact, is_primary. Missing keys keep the current value (or the
 * default for a new contact). A linked login's WhatsApp flag mirrors their own consent and is not changed here.
 */
create function public.save_family_contact(p_family_id uuid, p_contact jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  is_adm boolean := public.is_admin();
  fam public.families;
  cur public.family_contacts;
  me public.profiles;
  v jsonb := coalesce(p_contact, '{}'::jsonb);
  v_id uuid := nullif(btrim(coalesce(v->>'id', '')), '')::uuid;
  v_name text := btrim(regexp_replace(coalesce(v->>'name', ''), '\s+', ' ', 'g'));
  v_email text := nullif(lower(btrim(coalesce(v->>'email', ''))), '');
  v_phone text := nullif(btrim(coalesce(v->>'phone', '')), '');
  v_rel text; v_channel text;
  v_login boolean; v_invoices boolean; v_reports boolean; v_notes boolean; v_whatsapp boolean; v_emergency boolean;
  v_primary boolean; new_login boolean; result uuid; first_name text;
begin
  if not (is_adm or public.my_family_id() = p_family_id) then
    raise exception 'Family not found' using errcode = '42501';
  end if;
  select * into fam from public.families where id = p_family_id;
  if fam.id is null then raise exception 'Family not found' using errcode = '42501'; end if;
  if v_id is not null then
    select * into cur from public.family_contacts where id = v_id for update;
    if cur.id is null or cur.family_id <> p_family_id then raise exception 'Family not found' using errcode = '42501'; end if;
  end if;

  v_rel := coalesce(nullif(btrim(v->>'relationship'), ''), cur.relationship, 'parent');
  v_channel := coalesce(nullif(btrim(v->>'preferred_channel'), ''), cur.preferred_channel, 'email');
  v_login := coalesce((v->>'can_log_in')::boolean, cur.can_log_in, true);
  v_invoices := coalesce((v->>'receives_invoices')::boolean, cur.receives_invoices, true);
  v_reports := coalesce((v->>'receives_reports')::boolean, cur.receives_reports, true);
  v_notes := coalesce((v->>'receives_lesson_notes')::boolean, cur.receives_lesson_notes, true);
  v_whatsapp := coalesce((v->>'receives_whatsapp')::boolean, cur.receives_whatsapp, false);
  v_emergency := coalesce((v->>'emergency_contact')::boolean, cur.emergency_contact, false);
  v_primary := coalesce((v->>'is_primary')::boolean, cur.is_primary, false);
  if not v ? 'email' and cur.id is not null then v_email := cur.email; end if;
  if not v ? 'phone' and cur.id is not null then v_phone := cur.phone; end if;
  if not v ? 'name' and cur.id is not null then v_name := cur.name; end if;
  -- A linked login's WhatsApp consent is their own (set under Account); the contact flag only mirrors it.
  if cur.profile_id is not null then v_whatsapp := cur.receives_whatsapp; end if;
  -- A family without a main contact (which should not happen) makes this one its main contact.
  if not coalesce(cur.is_primary, false)
     and not exists (select 1 from public.family_contacts where family_id = p_family_id and is_primary) then
    v_primary := true;
  end if;

  if v_name = '' then raise exception 'Please enter the contact''s name.'; end if;
  if length(v_name) > 120 then raise exception 'Please enter a name of 120 characters or fewer.'; end if;
  if v_rel not in ('mother', 'father', 'parent', 'guardian', 'pa', 'family_office', 'driver', 'other') then
    raise exception 'Please choose how this contact is related to the family.';
  end if;
  if v_channel not in ('email', 'phone', 'whatsapp') then raise exception 'Please choose how this contact prefers to be reached.'; end if;
  -- An address already on file (for example one the office entered before contacts existed) is not re-checked.
  if v_email is not null and v_email is distinct from cur.email and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address.';
  end if;
  if v_login and v_email is null then raise exception 'A contact who can sign in needs an email address.'; end if;
  if v_primary and v_email is null then raise exception 'The main contact needs an email address.'; end if;
  if v_whatsapp and cur.profile_id is null and public.contact_whatsapp_number(v_phone) is null then
    raise exception 'Please enter a mobile number with its country code, for example +971 50 123 4567, to send WhatsApp messages.';
  end if;
  if v_email is not null and exists (select 1 from public.family_contacts
      where family_id = p_family_id and email = v_email and id is distinct from v_id) then
    raise exception 'Another contact in this family already uses that email address.';
  end if;
  if v_login and public.login_email_taken(v_email, p_family_id) then
    raise exception 'That email address already signs in to another family. Please use a different address.';
  end if;
  if not is_adm then
    if not v_login and not exists (select 1 from public.family_contacts
        where family_id = p_family_id and can_log_in and id is distinct from v_id) then
      raise exception 'At least one contact must be able to sign in.';
    end if;
    if cur.profile_id = auth.uid() and not v_login then
      raise exception 'You cannot remove your own access. Please ask the office if you need to.';
    end if;
  end if;
  if cur.is_primary and not v_primary then raise exception 'Please choose another main contact first.'; end if;

  new_login := v_login and v_email is not null and cur.profile_id is null
    and (cur.id is null or not cur.can_log_in or cur.email is distinct from v_email);

  -- Only one main contact: the previous one steps down first (checked again at commit).
  if v_primary and not coalesce(cur.is_primary, false) then
    update public.family_contacts set is_primary = false where family_id = p_family_id and is_primary;
  end if;

  if cur.id is null then
    insert into public.family_contacts (family_id, name, relationship, email, phone, preferred_channel, can_log_in,
      receives_invoices, receives_reports, receives_lesson_notes, receives_whatsapp, emergency_contact, is_primary)
    values (p_family_id, v_name, v_rel, v_email, v_phone, v_channel, v_login, v_invoices, v_reports, v_notes, v_whatsapp,
      v_emergency, v_primary)
    returning id into result;
  else
    update public.family_contacts set name = v_name, relationship = v_rel, email = v_email, phone = v_phone,
      preferred_channel = v_channel, can_log_in = v_login, receives_invoices = v_invoices, receives_reports = v_reports,
      receives_lesson_notes = v_notes, receives_whatsapp = v_whatsapp, emergency_contact = v_emergency, is_primary = v_primary
    where id = cur.id
    returning id into result;
  end if;

  -- Someone newly able to sign in who has no login yet is invited by email. Never bank details.
  if new_login and not exists (select 1 from auth.users where lower(email) = v_email and email_confirmed_at is not null) then
    first_name := coalesce(nullif(public.whatsapp_first_name(v_name), ''), v_name);
    perform public.notify(null, v_email, 'Your access to Elite Education',
      'Dear ' || first_name || ',' || E'\n\n'
        || 'You have been given access to the ' || fam.name || ' family''s account with Elite Education. Please download the '
        || 'Elite Education app, or open it on the web, and sign in or create an account with this email address ('
        || v_email || '). You will then see lessons, progress and messages for the family.'
        || E'\n\nElite Education | eliteeducation.me',
      null, null, '/sign-in');
  end if;

  if not is_adm then
    select * into me from public.profiles where id = auth.uid();
    perform public.notify_admins('Family contacts updated: ' || fam.name,
      coalesce(me.full_name, 'A parent') || case when cur.id is null then ' added ' else ' updated ' end || v_name
        || ' (' || public.contact_relationship_label(v_rel) || ') for the ' || fam.name || ' family.',
      'Contacts updated', v_name || ' (' || public.contact_relationship_label(v_rel) || '), ' || fam.name || ' family',
      '/manage/family-edit?id=' || p_family_id);
  end if;
  return result;
end $$;

/** Remove a family contact. The main contact cannot be removed; a parent cannot remove the family's last sign-in. */
create function public.remove_family_contact(p_contact_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare is_adm boolean := public.is_admin(); c public.family_contacts; fam public.families; me public.profiles;
begin
  select * into c from public.family_contacts where id = p_contact_id for update;
  if c.id is null or not (is_adm or public.my_family_id() = c.family_id) then
    raise exception 'Family not found' using errcode = '42501';
  end if;
  if c.is_primary then raise exception 'Please choose another main contact before removing this one.'; end if;
  if not is_adm then
    if c.can_log_in and not exists (select 1 from public.family_contacts
        where family_id = c.family_id and can_log_in and id <> c.id) then
      raise exception 'At least one contact must be able to sign in.';
    end if;
    if c.profile_id = auth.uid() then
      raise exception 'You cannot remove your own access. Please ask the office if you need to.';
    end if;
  end if;
  select * into fam from public.families where id = c.family_id;
  -- Removing a contact with a login takes that login out of the family (family_contacts_revoke).
  delete from public.family_contacts where id = c.id;
  if not is_adm then
    select * into me from public.profiles where id = auth.uid();
    perform public.notify_admins('Family contacts updated: ' || fam.name,
      coalesce(me.full_name, 'A parent') || ' removed ' || c.name || ' (' || public.contact_relationship_label(c.relationship)
        || ') from the ' || fam.name || ' family.',
      'Contacts updated', c.name || ' removed, ' || fam.name || ' family', '/manage/family-edit?id=' || c.family_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Fan-out: every family notice goes to each contact who receives that kind
-- ---------------------------------------------------------------------------

/**
 * The kind of a family notice, from the link it opens: invoices and payment notices, reports, lesson notes (lesson
 * notes, homework and resources), or general (everything else: lesson requests, messages and so on).
 * NOTE for sibling migrations (for example credit notes and refunds): call notify_family_kind with an explicit kind, or
 * give the notice a URL this function recognises ('/invoice/...', '/parent/billing...').
 */
create function public.family_notice_kind(p_url text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_url like '/invoice/%' or p_url like '/parent/billing%' then 'invoices'
    when p_url = '/parent/progress' or p_url like '/reports/%' then 'reports'
    when p_url like '/lesson/%' or p_url like '/homework%' or p_url like '/parent/progress?tab=homework%' then 'lesson_notes'
    else 'general'
  end
$$;

/** Whether a contact receives a kind of notice. General notices go to contacts who can sign in and the main contact. */
create function public.contact_receives(c public.family_contacts, p_kind text) returns boolean
language sql immutable set search_path = public as $$
  select case p_kind
    when 'invoices' then c.receives_invoices
    when 'reports' then c.receives_reports
    when 'lesson_notes' then c.receives_lesson_notes
    else c.can_log_in or c.is_primary
  end
$$;

/**
 * Notify a family's contacts who receive this kind of notice, main contact first: a contact with a login in the family
 * by push and email to their login, anyone else by email. Nobody is sent the same notice twice (by login or by email).
 * Parent logins not linked to any contact still receive everything; a family with no contacts at all falls back to
 * families.email when nobody has logged in, as before.
 */
create function public.notify_family_kind(
  p_family_id uuid, p_kind text, p_subject text, p_body text, p_push_title text, p_push_body text, p_url text,
  p_send_email boolean default true
) returns void language plpgsql security definer set search_path = public as $$
declare
  c public.family_contacts; pr public.profiles; fam public.families;
  seen_profiles uuid[] := '{}'; seen_emails text[] := '{}'; any_contact boolean := false;
begin
  for c in select * from public.family_contacts where family_id = p_family_id order by is_primary desc, created_at, id loop
    any_contact := true;
    if not public.contact_receives(c, p_kind) then continue; end if;
    pr := null;
    if c.profile_id is not null then
      select * into pr from public.profiles where id = c.profile_id and family_id = p_family_id and role = 'parent';
    end if;
    if pr.id is not null then
      if pr.id = any (seen_profiles) or lower(pr.email) = any (seen_emails) then continue; end if;
      perform public.notify(pr.id, pr.email, p_subject, p_body, p_push_title, p_push_body, p_url, p_send_email);
      seen_profiles := seen_profiles || pr.id;
      seen_emails := seen_emails || lower(pr.email);
    elsif c.email is not null then
      if c.email = any (seen_emails) then continue; end if;
      perform public.notify(null, c.email, p_subject, p_body, null, null, p_url, p_send_email);
      seen_emails := seen_emails || c.email;
    end if;
  end loop;

  for pr in select p.* from public.profiles p
            where p.family_id = p_family_id and p.role = 'parent'
              and not exists (select 1 from public.family_contacts fc where fc.profile_id = p.id)
            order by p.id loop
    if pr.id = any (seen_profiles) or lower(pr.email) = any (seen_emails) then continue; end if;
    perform public.notify(pr.id, pr.email, p_subject, p_body, p_push_title, p_push_body, p_url, p_send_email);
    seen_profiles := seen_profiles || pr.id;
    seen_emails := seen_emails || lower(pr.email);
  end loop;

  if not any_contact and cardinality(seen_profiles) = 0 then
    select * into fam from public.families where id = p_family_id;
    if fam.email is not null then
      perform public.notify(null, fam.email, p_subject, p_body, null, null, p_url, p_send_email);
    end if;
  end if;
end $$;

-- Same signature as before, so every existing caller (invoices sent and autopay, payment failed, lessons bought,
-- autopay off, lesson notes, homework set and feedback, resources, reports, lesson requests) fans out per contact.
create or replace function public.notify_family(
  p_family_id uuid, p_subject text, p_body text, p_push_title text, p_push_body text, p_url text, p_send_email boolean default true
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_family_kind(p_family_id, public.family_notice_kind(p_url), p_subject, p_body, p_push_title,
    p_push_body, p_url, p_send_email);
end $$;

-- ---------------------------------------------------------------------------
-- 10. WhatsApp for contacts
-- ---------------------------------------------------------------------------

/** The kind of notice each WhatsApp template is, matching family_notice_kind. */
create function public.whatsapp_template_kind(p_template text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_template in ('invoice_sent', 'invoice_autopay', 'invoice_overdue') then 'invoices'
    when p_template in ('lesson_notes', 'homework_due') then 'lesson_notes'
    else 'general'
  end
$$;

/**
 * Queue one WhatsApp message for a contact without a login who has agreed to WhatsApp messages (receives_whatsapp) and
 * has a mobile number with its country code. As queue_whatsapp, but against the contact rather than a profile.
 */
create function public.queue_whatsapp_contact(p_contact_id uuid, p_template text, p_vars jsonb, p_url text default null,
  p_now timestamptz default now())
returns boolean language plpgsql security definer set search_path = public as $$
declare c public.family_contacts; num text; first_name text; vars jsonb;
begin
  select * into c from public.family_contacts where id = p_contact_id;
  if c.id is null or c.profile_id is not null or not c.receives_whatsapp then return false; end if;
  num := public.contact_whatsapp_number(c.phone);
  if num is null then return false; end if;
  first_name := nullif(public.whatsapp_first_name(c.name), '');
  if first_name is null then return false; end if;
  select coalesce(jsonb_object_agg(key, coalesce(public.whatsapp_clean(value), '')), '{}') into vars
    from jsonb_each_text(coalesce(p_vars, '{}') || jsonb_build_object('1', first_name));
  insert into public.notification_outbox (profile_id, contact_id, email, subject, body, push_title, push_body, url, send_email,
    whatsapp, whatsapp_to, whatsapp_template, whatsapp_vars, whatsapp_status, whatsapp_not_before)
  values (null, c.id, null, public.whatsapp_subject(p_template),
    public.whatsapp_preview(p_template, vars), null, null, p_url, false,
    true, num, p_template, vars, 'pending', public.whatsapp_not_before(p_template, p_now));
  return true;
end $$;

/**
 * Queue a WhatsApp message for each contact of a family who receives this kind of notice: a contact with a login by
 * their own opt-in (queue_whatsapp), a contact without one when they agreed to WhatsApp. Parent logins not linked to a
 * contact still receive it as before. The same number is never messaged twice. Returns how many were queued.
 */
create or replace function public.queue_whatsapp_family(p_family_id uuid, p_template text, p_vars jsonb, p_url text default null,
  p_now timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare
  c public.family_contacts; p public.profiles; n int := 0; seen text[] := '{}'; num text;
  kind text := public.whatsapp_template_kind(p_template);
begin
  for c in select * from public.family_contacts where family_id = p_family_id order by is_primary desc, created_at, id loop
    if not public.contact_receives(c, kind) then continue; end if;
    if c.profile_id is not null then
      p := null;
      select * into p from public.profiles where id = c.profile_id and family_id = p_family_id and role = 'parent';
      if p.id is null or p.whatsapp_number = any (seen) then continue; end if;
      if public.queue_whatsapp(p.id, p_template, p_vars, p_url, p_now) then
        n := n + 1;
        seen := seen || p.whatsapp_number;
      end if;
    elsif c.receives_whatsapp then
      num := public.contact_whatsapp_number(c.phone);
      if num is null or num = any (seen) then continue; end if;
      if public.queue_whatsapp_contact(c.id, p_template, p_vars, p_url, p_now) then
        n := n + 1;
        seen := seen || num;
      end if;
    end if;
  end loop;

  for p in select pr.* from public.profiles pr
           where pr.family_id = p_family_id and pr.role = 'parent'
             and not exists (select 1 from public.family_contacts fc where fc.profile_id = pr.id)
           order by pr.id loop
    if p.whatsapp_number = any (seen) then continue; end if;
    if public.queue_whatsapp(p.id, p_template, p_vars, p_url, p_now) then
      n := n + 1;
      seen := seen || p.whatsapp_number;
    end if;
  end loop;
  return n;
end $$;
-- on_invoice_settled_whatsapp skips pending invoice messages by url and template, so contact rows are covered too.

-- ---------------------------------------------------------------------------
-- 11. set_my_name also renames the caller's contact
-- ---------------------------------------------------------------------------

create or replace function public.set_my_name(p_full_name text)
returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles; fam public.families; clean text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
begin
  if auth.uid() is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  if clean = '' then raise exception 'Please enter your name.'; end if;
  if length(clean) > 120 then raise exception 'Please enter a name of 120 characters or fewer.'; end if;
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role <> 'parent' then return; end if;
  if me.family_id is not null then
    select * into fam from public.families where id = me.family_id;
    if fam.id is not null and fam.status <> 'prospect' then return; end if;
  end if;
  update public.profiles set full_name = clean where id = me.id;
  if fam.id is not null and fam.parent_name = me.full_name then
    update public.families set parent_name = clean, name = public.surname_of(clean) where id = fam.id;
  end if;
  update public.family_contacts set name = clean where profile_id = me.id and name is distinct from clean;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges (create or replace keeps existing grants; new functions start closed)
-- ---------------------------------------------------------------------------

revoke all on function public.contact_whatsapp_number(text), public.contact_relationship_label(text),
  public.contact_login_releasable(public.family_contacts), public.login_email_taken(text, uuid),
  public.release_login_email(text, uuid), public.link_parent_profile(public.profiles),
  public.family_contacts_before(), public.family_contacts_sync_family(), public.contact_link_existing_login(),
  public.family_contacts_revoke(), public.family_contacts_name_to_profile(), public.family_contacts_whatsapp_off(),
  public.family_contacts_check_primary(), public.families_create_contact(), public.families_sync_contact(),
  public.families_create_contact_for(public.families), public.profiles_link_contact(), public.profiles_whatsapp_to_contact(),
  public.family_notice_kind(text), public.contact_receives(public.family_contacts, text),
  public.notify_family_kind(uuid, text, text, text, text, text, text, boolean),
  public.whatsapp_template_kind(text), public.queue_whatsapp_contact(uuid, text, jsonb, text, timestamptz),
  public.list_family_contacts(uuid), public.save_family_contact(uuid, jsonb), public.remove_family_contact(uuid)
  from public, anon, authenticated;
grant execute on function public.list_family_contacts(uuid), public.save_family_contact(uuid, jsonb),
  public.remove_family_contact(uuid) to authenticated;
