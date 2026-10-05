-- Elite Education — spam and abuse protection for the public enquiry and application forms.
--
-- What this adds, in plain terms:
--   * Every enquiry and tutor application now carries a spam status ('clean', 'suspected' or 'spam'),
--     the reasons it was flagged, how many times the same person re-sent it, and when they last did.
--   * Repeat submissions from the same email or the same connection are limited (see the thresholds below).
--     A visitor who goes over the limit sees a courteous message asking them to wait or to email Craig.
--   * A person who sends the same enquiry twice within a day has the second copy folded into the first,
--     so the office sees one enquiry rather than several.
--   * Submissions that look automated (links in a name, several links in a message, filled in faster than a
--     person could type, or a failed security check) are still saved but marked 'suspected'. They do not
--     notify the office or email the address given, so the forms cannot be used to email a stranger.
--     Nothing is rejected for looking like spam, and the website is never told it was flagged.
--   * The office can mark a submission as spam (or not spam) with set_submission_spam.
--   * Connection addresses (IP addresses) are never stored; only a one-way fingerprint is kept for 30 days.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.enquiries
  add column if not exists spam_status text not null default 'clean' check (spam_status in ('clean', 'suspected', 'spam')),
  add column if not exists spam_reasons text[] not null default '{}',
  add column if not exists repeat_count integer not null default 0,
  add column if not exists last_submitted_at timestamptz;
alter table public.tutor_applications
  add column if not exists spam_status text not null default 'clean' check (spam_status in ('clean', 'suspected', 'spam')),
  add column if not exists spam_reasons text[] not null default '{}',
  add column if not exists repeat_count integer not null default 0,
  add column if not exists last_submitted_at timestamptz;

-- Emails are stored lower-cased, so these serve the duplicate and 30-day checks directly.
create index if not exists enquiries_email_idx on public.enquiries (email, created_at desc);
create index if not exists tutor_applications_email_idx on public.tutor_applications (email, created_at desc);

/** When on, website submissions without a completed Cloudflare Turnstile check are marked 'suspected'. */
alter table public.settings add column if not exists captcha_required boolean not null default false;

-- ---------------------------------------------------------------------------
-- Submission log (for the rate limits) and security-check passes
-- ---------------------------------------------------------------------------

/**
 * One row per accepted, flagged or merged submission from the public forms. Used only to count recent
 * submissions per email and per connection fingerprint. Attempts that hit the limit are not logged
 * (the error undoes the whole call), so a lockout never extends itself. Rows older than 30 days are removed.
 */
create table if not exists public.submission_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('enquiry', 'application')),
  email text,
  ip_hash text,
  outcome text not null check (outcome in ('accepted', 'flagged', 'merged'))
);
create index if not exists submission_log_email_idx on public.submission_log (kind, email, created_at desc);
create index if not exists submission_log_ip_idx on public.submission_log (kind, ip_hash, created_at desc);
create index if not exists submission_log_created_idx on public.submission_log (created_at);
alter table public.submission_log enable row level security;
revoke all on public.submission_log from anon, authenticated;
create policy "admin reads submission log" on public.submission_log for select to authenticated using (public.is_admin());
grant select on public.submission_log to authenticated;

/**
 * A pass is created by the verify-captcha Edge Function (service role) after Cloudflare confirms a visitor
 * completed the Turnstile check. The website sends the pass id with the form; each pass works once,
 * for one form, within ten minutes.
 */
create table if not exists public.captcha_passes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  form text not null check (form in ('enquiry', 'application'))
);
alter table public.captcha_passes enable row level security;
revoke all on public.captcha_passes from anon, authenticated;
grant select, insert, update on public.captcha_passes to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/**
 * A one-way fingerprint of the visitor's connection, taken from the headers Supabase passes through.
 * The raw address is never stored. Returns null when there are no headers (for example in tests or cron).
 */
create or replace function public.request_ip_hash() returns text
language plpgsql stable security definer set search_path = public as $$
declare raw text; h json; ip text;
begin
  raw := current_setting('request.headers', true);
  if raw is null or raw = '' then return null; end if;
  begin
    h := raw::json;
  exception when others then
    return null;
  end;
  if json_typeof(h) <> 'object' then return null; end if;
  ip := coalesce(nullif(trim(h ->> 'cf-connecting-ip'), ''), nullif(trim(h ->> 'x-real-ip'), ''),
                 nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''));
  if ip is null then return null; end if;
  return encode(sha256(convert_to('elite-education:' || ip, 'UTF8')), 'hex');
end $$;
revoke execute on function public.request_ip_hash() from public, anon, authenticated;

/**
 * Lower case, ASCII punctuation turned into spaces, runs of spaces collapsed. Only ASCII punctuation is
 * touched, so Arabic and other scripts survive. The app mirrors this exactly in src/domain/spam.ts.
 */
create or replace function public.normalise_message(t text) returns text
language sql immutable set search_path = public as $$
  select trim(regexp_replace(regexp_replace(lower(coalesce(t, '')), '[!-/:-@[-`{-~]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

/**
 * How alike two messages are, from 0 to 1: the share of distinct words they have in common (Jaccard index).
 * An empty message counts as matching anything, so a blank re-send is treated as the same enquiry.
 */
create or replace function public.message_similarity(a text, b text) returns numeric
language sql immutable set search_path = public as $$
  with x as (select public.normalise_message(a) as na, public.normalise_message(b) as nb),
  ta as (select distinct w from x, unnest(string_to_array(x.na, ' ')) w),
  tb as (select distinct w from x, unnest(string_to_array(x.nb, ' ')) w)
  select case when x.na = '' or x.nb = '' then 1::numeric
    else (select count(*) from ta join tb using (w))::numeric
         / (select count(*) from (select w from ta union select w from tb) u)::numeric
  end
  from x
$$;

/** Number of web links (http://, https:// or www.) in a piece of text. */
create or replace function public.count_links(t text) returns integer
language sql immutable set search_path = public as $$
  select count(*)::integer from regexp_matches(coalesce(t, ''), '(https?://|www\.)', 'gi')
$$;

/** Uses up a security-check pass. True only for an unused pass for this form, less than ten minutes old. */
create or replace function public.consume_captcha_pass(p_pass uuid, p_form text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if p_pass is null then return false; end if;
  update public.captcha_passes set used_at = now()
  where id = p_pass and form = p_form and used_at is null and created_at > now() - interval '10 minutes'
  returning true into ok;
  return coalesce(ok, false);
end $$;
revoke execute on function public.consume_captcha_pass(uuid, text) from public, anon, authenticated;

/**
 * Whether this email or connection has sent too much recently. Limits (mirrored in src/domain/spam.ts):
 *   enquiries:     per email 3 an hour and 6 a day; per connection 5 an hour and 20 a day.
 *   applications:  per email 2 an hour and 3 a day; per connection 3 an hour and 10 a day.
 */
create or replace function public.submission_rate_limited(p_kind text, p_email text, p_ip_hash text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  email_hour int := case when p_kind = 'enquiry' then 3 else 2 end;
  email_day int := case when p_kind = 'enquiry' then 6 else 3 end;
  ip_hour int := case when p_kind = 'enquiry' then 5 else 3 end;
  ip_day int := case when p_kind = 'enquiry' then 20 else 10 end;
begin
  if p_email is not null then
    if (select count(*) from public.submission_log
        where kind = p_kind and email = p_email and created_at > now() - interval '1 hour') >= email_hour
    or (select count(*) from public.submission_log
        where kind = p_kind and email = p_email and created_at > now() - interval '24 hours') >= email_day then
      return true;
    end if;
  end if;
  if p_ip_hash is not null then
    if (select count(*) from public.submission_log
        where kind = p_kind and ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= ip_hour
    or (select count(*) from public.submission_log
        where kind = p_kind and ip_hash = p_ip_hash and created_at > now() - interval '24 hours') >= ip_day then
      return true;
    end if;
  end if;
  return false;
end $$;
revoke execute on function public.submission_rate_limited(text, text, text) from public, anon, authenticated;

/**
 * Tidies the log (anything over 30 days old) and stops the call with HTTP 429 when the sender is over the limit.
 * PostgREST turns SQLSTATE PTxyz into HTTP status xyz, so the website receives a 429 with code 'PT429'.
 */
create or replace function public.enforce_submission_rate_limit(p_kind text, p_email text, p_ip_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.submission_log where created_at < now() - interval '30 days';
  if public.submission_rate_limited(p_kind, p_email, p_ip_hash) then
    raise exception using errcode = 'PT429', hint = 'rate_limited',
      message = 'Thank you. We have received several messages from you in a short time, so we have paused further '
        || 'submissions for now. We will be in touch shortly; if your enquiry is urgent, please email craig@craigobrieneducation.com.';
  end if;
end $$;
revoke execute on function public.enforce_submission_rate_limit(text, text, text) from public, anon, authenticated;

/** Records a submission for the rate limits. */
create or replace function public.log_submission(p_kind text, p_email text, p_ip_hash text, p_outcome text) returns void
language sql security definer set search_path = public as $$
  insert into public.submission_log (kind, email, ip_hash, outcome) values (p_kind, p_email, p_ip_hash, p_outcome)
$$;
revoke execute on function public.log_submission(text, text, text, text) from public, anon, authenticated;

/** The security check applies only to the website, only when the office has switched it on, and never to an admin. */
create or replace function public.captcha_needed(p_source text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select captcha_required from public.settings where id = 1), false)
     and p_source = 'website' and not public.is_admin()
$$;
revoke execute on function public.captcha_needed(text) from public, anon, authenticated;

/**
 * Why a submission looks automated, in a fixed order: 'link-in-name', 'links', 'too-fast', 'captcha'.
 *   link-in-name: any web link in a person's name.
 *   links:        three or more web links in the free text.
 *   too-fast:     the form was completed in under three seconds (an unknown time is never flagged).
 *   captcha:      the security check was needed but no valid pass was supplied.
 * An empty list means the submission is clean.
 */
create or replace function public.submission_spam_reasons(
  p_names text[], p_free_text text, p_elapsed_ms integer, p_captcha_needed boolean, p_captcha_ok boolean
) returns text[] language plpgsql immutable set search_path = public as $$
declare reasons text[] := '{}';
begin
  if public.count_links(array_to_string(p_names, ' ')) > 0 then reasons := reasons || 'link-in-name'::text; end if;
  if public.count_links(p_free_text) >= 3 then reasons := reasons || 'links'::text; end if;
  if p_elapsed_ms is not null and p_elapsed_ms < 3000 then reasons := reasons || 'too-fast'::text; end if;
  if coalesce(p_captcha_needed, false) and not coalesce(p_captcha_ok, false) then reasons := reasons || 'captcha'::text; end if;
  return reasons;
end $$;
revoke execute on function public.submission_spam_reasons(text[], text, integer, boolean, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The office marks a submission as spam, or not spam
-- ---------------------------------------------------------------------------

/** Marking as not spam returns it to 'clean' but keeps the original reasons on record. */
create or replace function public.set_submission_spam(p_kind text, p_id uuid, p_spam boolean) returns void
language plpgsql security definer set search_path = public as $$
declare st text := case when p_spam then 'spam' else 'clean' end;
begin
  if not public.is_admin() then raise exception 'Only an administrator can do this' using errcode = '42501'; end if;
  if p_kind = 'enquiry' then
    update public.enquiries set spam_status = st where id = p_id;
  elsif p_kind = 'application' then
    update public.tutor_applications set spam_status = st where id = p_id;
  else
    raise exception 'Unknown submission type';
  end if;
end $$;
revoke execute on function public.set_submission_spam(text, uuid, boolean) from public, anon;
grant execute on function public.set_submission_spam(text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The public forms
--
-- NOTE FOR THE MERGE LEAD: other round-4 branches may also redefine submit_enquiry and
-- submit_tutor_application. The screening steps are factored into helper functions
-- (request_ip_hash, enforce_submission_rate_limit, consume_captcha_pass, captcha_needed,
-- submission_spam_reasons, log_submission, message_similarity) so they can be re-applied to any
-- newer definition: validate, skip everything for admins, enforce the limit, merge duplicates,
-- compute the reasons, insert with spam_status/spam_reasons, log, and notify only when clean.
-- ---------------------------------------------------------------------------

drop function if exists public.submit_enquiry(text, text, text, text, text, text, text, text, text, text, text);
/**
 * Anyone (including the public website) can send an enquiry. Signed-in parents are linked automatically.
 * p_elapsed_ms is how long the visitor spent on the form; p_captcha_pass is a pass from verify-captcha.
 * The same id is returned whether the enquiry was saved, merged with an earlier copy or flagged.
 */
create function public.submit_enquiry(
  p_parent_name text, p_email text, p_phone text, p_student_name text, p_curriculum text,
  p_year_group text, p_message text, p_preferred_times text, p_source text default 'app',
  p_subject text default null, p_phase text default null, p_elapsed_ms integer default null, p_captcha_pass uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  eid uuid; fam uuid; subj text; ph text; src text; em text; ip text;
  admin boolean := public.is_admin(); captcha_ok boolean := false; reasons text[] := '{}';
  new_message text := nullif(trim(p_message), '');
begin
  if nullif(trim(p_parent_name), '') is null then raise exception 'Please enter your name'; end if;
  if nullif(trim(p_email), '') is null and nullif(trim(p_phone), '') is null then
    raise exception 'Please give an email address or phone number';
  end if;
  -- Sensible size limits, with friendly wording (the website shows these messages as they are).
  if length(trim(p_parent_name)) > 200 or length(trim(p_student_name)) > 200 then
    raise exception 'Please shorten the name to 200 characters or fewer';
  end if;
  if length(trim(p_email)) > 200 or length(trim(p_phone)) > 50 then
    raise exception 'Please check the email address or telephone number';
  end if;
  if length(trim(p_message)) > 4000 then raise exception 'Please shorten your message to 4,000 characters or fewer'; end if;
  if length(trim(p_preferred_times)) > 1000 or length(trim(p_year_group)) > 100 then
    raise exception 'Please shorten your answers a little';
  end if;
  subj := nullif(regexp_replace(trim(p_subject), '\s+', ' ', 'g'), '');
  ph := nullif(regexp_replace(trim(p_phase), '\s+', ' ', 'g'), '');
  if length(subj) > 80 or length(ph) > 60 then raise exception 'Please choose a shorter subject or phase'; end if;
  src := case when p_source in ('app', 'website', 'referral', 'phone', 'other') then p_source else 'other' end;
  em := nullif(lower(trim(p_email)), '');
  fam := public.my_family_id();

  -- The office entering an enquiry by hand is never limited, merged or flagged.
  if not admin then
    ip := public.request_ip_hash();
    perform public.enforce_submission_rate_limit('enquiry', em, ip);
    -- A pass is used up as soon as it is presented, so it can never be replayed.
    captcha_ok := public.consume_captcha_pass(p_captcha_pass, 'enquiry');

    -- The same person re-sending much the same enquiry within a day: fold it into the earlier one.
    if em is not null then
      select e.id into eid from public.enquiries e
      where e.email = em
        and greatest(e.created_at, coalesce(e.last_submitted_at, e.created_at)) > now() - interval '24 hours'
        and e.spam_status <> 'spam'
        and e.status not in ('enrolled', 'lost')
        and not (nullif(trim(e.student_name), '') is not null and nullif(trim(p_student_name), '') is not null
                 and public.normalise_message(e.student_name) <> public.normalise_message(p_student_name))
        and public.message_similarity(e.message, new_message) >= 0.6
      order by greatest(e.created_at, coalesce(e.last_submitted_at, e.created_at)) desc
      limit 1
      for update;
      if eid is not null then
        update public.enquiries e set
          phone = coalesce(e.phone, nullif(trim(p_phone), '')),
          student_name = coalesce(e.student_name, nullif(trim(p_student_name), '')),
          curriculum = coalesce(e.curriculum, nullif(p_curriculum, '')),
          subject = coalesce(e.subject, subj),
          phase = coalesce(e.phase, ph),
          year_group = coalesce(e.year_group, nullif(trim(p_year_group), '')),
          preferred_times = coalesce(e.preferred_times, nullif(trim(p_preferred_times), '')),
          message = case when e.message is null or length(new_message) > length(e.message) then coalesce(new_message, e.message)
                         else e.message end,
          repeat_count = e.repeat_count + 1,
          last_submitted_at = now()
        where e.id = eid;
        perform public.log_submission('enquiry', em, ip, 'merged');
        return eid;
      end if;
    end if;

    reasons := public.submission_spam_reasons(
      array[p_parent_name, p_student_name], concat_ws(' ', p_message, p_preferred_times), p_elapsed_ms,
      public.captcha_needed(src), captcha_ok);
  end if;

  insert into public.enquiries (parent_name, email, phone, student_name, curriculum, year_group, message, preferred_times, source, family_id,
                                subject, phase, spam_status, spam_reasons, last_submitted_at)
  values (trim(p_parent_name), em, nullif(trim(p_phone), ''), nullif(trim(p_student_name), ''),
          nullif(p_curriculum, ''), nullif(trim(p_year_group), ''), new_message, nullif(trim(p_preferred_times), ''),
          src, fam, subj, ph,
          case when cardinality(reasons) = 0 then 'clean' else 'suspected' end, reasons, now())
  returning id into eid;
  if not admin then
    perform public.log_submission('enquiry', em, ip, case when cardinality(reasons) = 0 then 'accepted' else 'flagged' end);
  end if;

  -- Flagged enquiries stay silent: no alert to the office and no email to the address given.
  if cardinality(reasons) = 0 then
    perform public.notify_admins('New enquiry: ' || trim(p_parent_name),
      trim(p_parent_name) || coalesce(' (' || nullif(trim(p_email), '') || ')', '') || coalesce(', ' || nullif(trim(p_phone), ''), '')
        || coalesce(E'\nStudent: ' || nullif(trim(p_student_name), ''), '') || coalesce(' — ' || nullif(p_curriculum, ''), '')
        || coalesce(E'\nSubject: ' || subj, '') || coalesce(E'\nPhase: ' || ph, '')
        || coalesce(E'\n\n' || nullif(trim(p_message), ''), ''),
      'New enquiry', trim(p_parent_name), '/admin/enquiries');
    if em is not null then
      perform public.notify(null, em, 'Thank you for contacting Elite Education',
        'Dear ' || split_part(trim(p_parent_name), ' ', 1) || E',\n\nThank you for contacting Elite Education. '
        || E'We will be in touch within one working day to arrange a complimentary consultation.\n\n'
        || E'With kind regards,\nElite Education\n\nElite Education | eliteeducation.me');
    end if;
  end if;
  return eid;
end $$;
grant execute on function public.submit_enquiry(text, text, text, text, text, text, text, text, text, text, text, integer, uuid)
  to anon, authenticated;

drop function if exists public.submit_tutor_application(text, text, text, text[], text, text, text, text, text, text[]);
/**
 * Anyone can apply to teach. A second application from the same email within a day (while still 'applied')
 * is folded into the first. The same id is returned whether it was saved, merged or flagged.
 */
create function public.submit_tutor_application(
  p_full_name text, p_email text, p_phone text, p_curricula text[], p_subjects text,
  p_experience text, p_qualifications text, p_availability text, p_cv_path text default null,
  p_phases text[] default '{}', p_elapsed_ms integer default null, p_captcha_pass uuid default null, p_source text default 'app'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  aid uuid; em text; ip text;
  admin boolean := public.is_admin(); captcha_ok boolean := false; reasons text[] := '{}';
  new_experience text := nullif(trim(p_experience), '');
begin
  if nullif(trim(p_full_name), '') is null then raise exception 'Please enter your name'; end if;
  if nullif(trim(p_email), '') is null or position('@' in p_email) = 0 then raise exception 'Please enter a valid email address'; end if;
  if cardinality(p_phases) > 10 then raise exception 'Please choose up to ten phases'; end if;
  -- Sensible size limits, with friendly wording.
  if length(trim(p_full_name)) > 200 then raise exception 'Please shorten the name to 200 characters or fewer'; end if;
  if length(trim(p_email)) > 200 or length(trim(p_phone)) > 50 then
    raise exception 'Please check the email address or telephone number';
  end if;
  if length(trim(p_experience)) > 4000 then raise exception 'Please shorten your message to 4,000 characters or fewer'; end if;
  if length(trim(p_availability)) > 1000 or length(trim(p_qualifications)) > 2000 or length(trim(p_subjects)) > 500
     or cardinality(p_curricula) > 20 or cardinality(p_phases) > 20 then
    raise exception 'Please shorten your answers a little';
  end if;
  em := lower(trim(p_email));

  if not admin then
    ip := public.request_ip_hash();
    perform public.enforce_submission_rate_limit('application', em, ip);
    captcha_ok := public.consume_captcha_pass(p_captcha_pass, 'application');

    -- The same person applying again within a day: fold the new details into the earlier application.
    select a.id into aid from public.tutor_applications a
    where a.email = em
      and greatest(a.created_at, coalesce(a.last_submitted_at, a.created_at)) > now() - interval '24 hours'
      and a.status = 'applied'
      and a.spam_status <> 'spam'
    order by greatest(a.created_at, coalesce(a.last_submitted_at, a.created_at)) desc
    limit 1
    for update;
    if aid is not null then
      update public.tutor_applications a set
        phone = coalesce(a.phone, nullif(trim(p_phone), '')),
        subjects = coalesce(a.subjects, nullif(trim(p_subjects), '')),
        qualifications = coalesce(a.qualifications, nullif(trim(p_qualifications), '')),
        availability = coalesce(a.availability, nullif(trim(p_availability), '')),
        experience = case when a.experience is null or length(new_experience) > length(a.experience)
                          then coalesce(new_experience, a.experience) else a.experience end,
        curricula = array(select c from unnest(a.curricula || coalesce(p_curricula, '{}')) with ordinality u(c, n)
                          group by c order by min(n)),
        phases = array(select p from unnest(a.phases || coalesce(p_phases, '{}')) with ordinality u(p, n)
                       group by p order by min(n)),
        cv_path = coalesce(nullif(p_cv_path, ''), a.cv_path),
        repeat_count = a.repeat_count + 1,
        last_submitted_at = now()
      where a.id = aid;
      perform public.log_submission('application', em, ip, 'merged');
      return aid;
    end if;
  end if;

  if (select count(*) from public.tutor_applications where lower(email) = em and created_at > now() - interval '30 days') >= 2 then
    raise exception 'We already have your application — we''ll be in touch soon';
  end if;

  if not admin then
    reasons := public.submission_spam_reasons(
      array[p_full_name], concat_ws(' ', p_experience, p_qualifications, p_subjects, p_availability), p_elapsed_ms,
      public.captcha_needed(p_source), captcha_ok);
  end if;

  insert into public.tutor_applications (full_name, email, phone, curricula, subjects, experience, qualifications, availability, cv_path, phases,
                                         spam_status, spam_reasons, last_submitted_at)
  values (trim(p_full_name), em, nullif(trim(p_phone), ''), coalesce(p_curricula, '{}'), nullif(trim(p_subjects), ''),
          new_experience, nullif(trim(p_qualifications), ''), nullif(trim(p_availability), ''), nullif(p_cv_path, ''),
          coalesce(p_phases, '{}'),
          case when cardinality(reasons) = 0 then 'clean' else 'suspected' end, reasons, now())
  returning id into aid;
  if not admin then
    perform public.log_submission('application', em, ip, case when cardinality(reasons) = 0 then 'accepted' else 'flagged' end);
  end if;

  -- Flagged applications stay silent: no alert to the office and no email to the address given.
  if cardinality(reasons) = 0 then
    perform public.notify_admins('Tutor application: ' || trim(p_full_name),
      trim(p_full_name) || ' (' || em || ') applied to teach '
        || coalesce(nullif(trim(p_subjects), '') || ' — ', '') || coalesce(array_to_string(p_curricula, ', '), '')
        || coalesce(E'\nPhases: ' || nullif(array_to_string(p_phases, ', '), ''), '')
        || coalesce(E'\n\n' || nullif(trim(p_experience), ''), ''),
      'New tutor application', trim(p_full_name), '/manage/applications');
    perform public.notify(null, em, 'Thank you for applying to Elite Education',
      'Dear ' || split_part(trim(p_full_name), ' ', 1) || E',\n\nThank you for applying to teach with Elite Education. '
        || E'We review every application carefully and will be in touch shortly.\n\n'
        || E'With kind regards,\nElite Education\n\nElite Education | eliteeducation.me');
  end if;
  return aid;
end $$;
grant execute on function public.submit_tutor_application(text, text, text, text[], text, text, text, text, text, text[], integer, uuid, text)
  to anon, authenticated;
