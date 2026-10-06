-- Elite Education — credit notes and cancelled invoices reach the family's billing contacts.
--
--  1. Issuing a credit note, or cancelling a paid invoice, tells the family with a link to '/credit-note/<id>'
--     (20261105000000_tax.sql). family_notice_kind (20261103000000_contacts.sql) only knew '/invoice/...' and
--     '/parent/billing...', so these were 'general' notices: a billing-only contact (a PA or family office) never
--     heard about them, and a signed-in contact who had turned invoices off still did. Credit notes are now
--     'invoices' notices, like the invoices they adjust. Refund notices already link to '/invoice/<id>'.
--     Mirrors noticeKindForUrl() in src/domain/contacts.ts.
--  2. The migrations ledger records this file.

-- ---------------------------------------------------------------------------
-- 1. Credit notes are invoice notices
-- ---------------------------------------------------------------------------

/**
 * The kind of a family notice, from the link it opens: invoices and payment notices (invoices, credit notes and
 * billing), reports, lesson notes (lesson notes, homework and resources), or general (everything else: lesson
 * requests, messages and so on).
 */
create or replace function public.family_notice_kind(p_url text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_url like '/invoice/%' or p_url like '/credit-note/%' or p_url like '/parent/billing%' then 'invoices'
    when p_url = '/parent/progress' or p_url like '/reports/%' then 'reports'
    when p_url like '/lesson/%' or p_url like '/homework%' or p_url like '/parent/progress?tab=homework%' then 'lesson_notes'
    else 'general'
  end
$$;

-- ---------------------------------------------------------------------------
-- 2. Migrations ledger
-- ---------------------------------------------------------------------------

select public.record_migration('20261113001700', 'creditnote_fix');
