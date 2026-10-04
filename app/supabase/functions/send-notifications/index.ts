// Delivers queued notifications (public.notification_outbox): push via Expo, email via Resend,
// and WhatsApp via Twilio (approved templates only, and only to people who opted in under Account, or family contacts
// without a login whom the family or office recorded as agreeing to WhatsApp messages).
// Schedule every minute (Supabase → Edge Functions → Schedules).
// Secrets: RESEND_API_KEY, EMAIL_FROM (e.g. "Elite Education <hello@eliteeducation.me>"), APP_URL.
// WhatsApp secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (+971…), and the approved
// Content SIDs TWILIO_TEMPLATE_LESSON_REMINDER, TWILIO_TEMPLATE_LESSON_NOTES, TWILIO_TEMPLATE_INVOICE_SENT,
// TWILIO_TEMPLATE_INVOICE_AUTOPAY, TWILIO_TEMPLATE_INVOICE_OVERDUE, TWILIO_TEMPLATE_HOMEWORK_DUE. Without them WhatsApp rows are marked skipped.
import { adminClient } from '../_shared/supabase.ts';
import { buildTwilioMessage, readTwilioResult, twilioConfigFromEnv, whatsappRecipient } from '../_shared/whatsapp.ts';

const MAX_ATTEMPTS = 5;
/** Written to a WhatsApp row while it is claimed for sending (see below). */
const WHATSAPP_CLAIM_NOTE = 'WhatsApp send in progress';

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function emailHtml(subject: string, body: string, link?: string) {
  const paragraphs = esc(body).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');
  // Brand palette (matches src/lib/pdf-brand.ts): Noir Black, Champagne Gold as a hairline only, Ivory Cream, Georgia and Calibri.
  const serif = "Georgia,'Times New Roman',serif";
  const sans = "Calibri,Carlito,'Segoe UI',Arial,sans-serif";
  return `<!doctype html><html><body style="margin:0;background:#F9F8F5;font-family:${sans};color:#0A0A0A">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#0A0A0A;color:#FFFFFF;padding:20px 24px;border-bottom:2px solid #C9A84C;font-family:${serif};font-size:20px;letter-spacing:0.5px">Elite Education</div>
    <div style="background:#FFFFFF;border:1px solid #E5E0D4;border-top:0;padding:24px;font-size:15px;line-height:1.6">
      <h2 style="margin:0 0 16px;font-family:${serif};font-weight:700;font-size:19px;color:#0A0A0A">${esc(subject)}</h2>
      ${paragraphs}
      ${link ? `<p style="margin:20px 0 0"><a href="${link}" style="background:#0A0A0A;color:#FFFFFF;border:1px solid #C9A84C;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:700">Open in the app</a></p>` : ''}
    </div>
    <p style="color:#6B6B6B;font-size:12px;text-align:center;letter-spacing:0.5px">Elite Education | eliteeducation.me</p>
  </div></body></html>`;
}

Deno.serve(async () => {
  const db = adminClient();
  const appUrl = Deno.env.get('APP_URL') ?? 'https://eliteeducation.me';
  const from = Deno.env.get('EMAIL_FROM') ?? 'Elite Education <hello@eliteeducation.me>';
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const twilio = twilioConfigFromEnv((k) => Deno.env.get(k));

  // WhatsApp rows held for quiet hours (whatsapp_not_before, UAE time) stay out of the batch until the morning,
  // so they neither count an attempt nor crowd out other notifications overnight.
  const now = new Date().toISOString();
  const { data: queue, error } = await db
    .from('notification_outbox')
    .select('*, profiles(push_token, whatsapp_opt_in, whatsapp_number), family_contacts(receives_whatsapp, phone)')
    .is('sent_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .or(`whatsapp_not_before.is.null,whatsapp_not_before.lte."${now}"`)
    .order('created_at')
    .limit(100);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  for (const n of queue ?? []) {
    // Belt and braces: never send a held WhatsApp early, and leave the row untouched (still pending, no attempt counted).
    if (n.whatsapp && n.whatsapp_status === 'pending' && n.whatsapp_not_before && n.whatsapp_not_before > now) continue;
    const problems: string[] = [];
    const token = n.profiles?.push_token as string | null;
    if (n.push_title && token) {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: token, title: n.push_title, body: n.push_body ?? '', data: { url: n.url } }),
      });
      if (!res.ok) problems.push(`push ${res.status}`);
    }
    if (n.send_email && n.email) {
      if (!resendKey) {
        problems.push('RESEND_API_KEY not set');
      } else {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from,
            to: n.email,
            subject: n.subject,
            text: n.body + (n.url ? `\n\n${appUrl}${n.url}` : ''),
            html: emailHtml(n.subject, n.body, n.url ? `${appUrl}${n.url}` : undefined),
          }),
        });
        if (!res.ok) problems.push(`email ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    }
    // WhatsApp: only rows still pending, so a retry for another channel never sends the message twice.
    const wa: Record<string, unknown> = {};
    const notes: string[] = [];
    if (n.whatsapp && n.whatsapp_status === 'failed' && n.error === WHATSAPP_CLAIM_NOTE) {
      // An earlier run claimed this row and stopped before recording Twilio's answer. Keep a trace for the office.
      notes.push('WhatsApp outcome unknown: the send was interrupted, so it was not retried');
    } else if (n.whatsapp && n.whatsapp_status === 'pending') {
      // A login's own opt-in, or a family contact (no login) who still agrees to WhatsApp messages.
      const number = whatsappRecipient(n);
      if (!number) {
        wa.whatsapp_status = 'skipped';
      } else if (!twilio) {
        wa.whatsapp_status = 'skipped';
        notes.push('WhatsApp skipped: Twilio is not configured');
      } else {
        const msg = buildTwilioMessage(twilio, number, n.whatsapp_template, n.whatsapp_vars);
        if (!msg.ok) {
          wa.whatsapp_status = 'failed';
          notes.push(`WhatsApp failed: ${msg.reason}`);
        } else {
          // Claim the row before calling Twilio, so an overlapping run (or a crash after sending) can never send it twice.
          // While claimed it reads 'failed'; it only returns to 'pending' when Twilio asks us to retry.
          const { data: claimed } = await db
            .from('notification_outbox')
            .update({ whatsapp_status: 'failed', error: WHATSAPP_CLAIM_NOTE })
            .eq('id', n.id)
            .eq('whatsapp_status', 'pending')
            .select('id');
          let result;
          if (!claimed?.length) {
            result = null;
          } else {
            try {
              const res = await fetch(msg.url, msg.init);
              result = readTwilioResult(res.status, await res.text());
            } catch (e) {
              // The message may have gone out before the connection dropped, so never retry it.
              result = { ok: false as const, retry: false, error: `Twilio network error: ${e instanceof Error ? e.message : String(e)}` };
            }
          }
          if (!result) continue; // another run claimed this row and will record the outcome
          if (result.ok) {
            wa.whatsapp_status = 'sent';
            wa.whatsapp_sent_at = new Date().toISOString();
            wa.whatsapp_sid = result.sid;
          } else if (result.retry && n.attempts + 1 < MAX_ATTEMPTS) {
            // Twilio did not accept it: release the claim so the next run tries again.
            wa.whatsapp_status = 'pending';
            problems.push(`whatsapp ${result.error}`);
          } else {
            wa.whatsapp_status = 'failed';
            notes.push(`WhatsApp failed: ${result.error}`);
          }
        }
      }
    }
    if (problems.length) {
      const error = [...problems, ...notes].join('; ');
      await db.from('notification_outbox').update({ attempts: n.attempts + 1, error, ...wa }).eq('id', n.id);
    } else {
      await db.from('notification_outbox').update({ sent_at: new Date().toISOString(), error: notes.length ? notes.join('; ') : null, ...wa }).eq('id', n.id);
      sent++;
    }
  }
  return new Response(`sent ${sent} of ${queue?.length ?? 0}`);
});
