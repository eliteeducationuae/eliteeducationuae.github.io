-- Round 4 final review fixes.
--  1. Notification links point at routes that exist: /manage/enquiries, /manage/requests and /tutor-invoices/<id>
--     (they said /admin/enquiries, /admin/requests and /manage/tutor-invoice/<id>). Pending notifications are corrected too.
--  2. Lesson charges read '17 Aug 2026' rather than '2026-08-17' on invoices. Existing charges are left as they are.
--  3. The classwork bucket is always private, with the 25 MB and file-type limits, even if it was created by hand first.
--  4. alert_unrecorded_payment: the Stripe webhook tells the office when a card payment succeeded but could not be
--     recorded (for example the invoice was deleted), so the money can be reconciled by hand. Never carries card or bank details.

-- 1 and 2. Each function keeps its body and grants; only the quoted text changes. The migration stops if the text
-- it expects is missing, so a later change to one of these functions cannot be silently overwritten.
create function pg_temp.swap_literal(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $$
declare def text := pg_get_functiondef(p_fn);
begin
  if position(p_from in def) = 0 then
    raise exception 'Expected % in %', p_from, p_fn;
  end if;
  execute replace(def, p_from, p_to);
end $$;

select pg_temp.swap_literal('public.link_login(uuid, text, jsonb)', '''/admin/enquiries''', '''/manage/enquiries''');
select pg_temp.swap_literal('public.submit_enquiry(text, text, text, text, text, text, text, text, text, text, text)',
  '''/admin/enquiries''', '''/manage/enquiries''');
select pg_temp.swap_literal('public.request_lesson(uuid, text, uuid, uuid, uuid, timestamptz, text, text)',
  '''/admin/requests''', '''/manage/requests''');
select pg_temp.swap_literal('public.submit_tutor_invoice(uuid)', '''/manage/tutor-invoice/''', '''/tutor-invoices/''');
select pg_temp.swap_literal('public.apply_charges(uuid, jsonb)', '''YYYY-MM-DD''', '''FMDD Mon YYYY''');

update public.notification_outbox set url = case
    when url = '/admin/enquiries' then '/manage/enquiries'
    when url = '/admin/requests' then '/manage/requests'
    else '/tutor-invoices/' || substr(url, length('/manage/tutor-invoice/') + 1)
  end
 where sent_at is null
   and (url in ('/admin/enquiries', '/admin/requests') or url like '/manage/tutor-invoice/%');

-- 3. Keep the classwork bucket private and limited, whoever created it.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    update storage.buckets
       set public = false,
           file_size_limit = 26214400,
           allowed_mime_types = array[
             'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/gif',
             'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
             'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
     where id = 'classwork';
  end if;
end $$;

-- 4. A card payment Stripe took that the database could not record. Called only by the stripe-webhook function.
create function public.alert_unrecorded_payment(p_kind text, p_payment_intent text, p_amount numeric, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare what text := case p_kind when 'offer-paid' then 'a lesson package' else 'an invoice' end;
begin
  perform public.notify_admins(
    'Card payment needs reconciling',
    'Stripe has taken a card payment of AED ' || to_char(coalesce(p_amount, 0), 'FM999,999,990.00') || ' for ' || what
      || ', but it could not be recorded in the app.'
      || E'\n\nStripe payment reference: ' || coalesce(p_payment_intent, 'not given')
      || E'\nReason: ' || left(coalesce(p_error, 'unknown'), 300)
      || E'\n\nPlease find the payment in the Stripe dashboard and record it by hand, or refund it.',
    'Card payment needs reconciling',
    'AED ' || to_char(coalesce(p_amount, 0), 'FM999,999,990.00') || ' could not be recorded',
    '/manage/money');
end $$;
revoke all on function public.alert_unrecorded_payment(text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.alert_unrecorded_payment(text, text, numeric, text) to service_role;
