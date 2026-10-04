// Delivers queued notifications (public.notification_outbox): push via Expo, email via Resend.
// Schedule every minute or two (Supabase → Edge Functions → Schedules).
// Secrets: RESEND_API_KEY, EMAIL_FROM (e.g. "Elite Education <hello@eliteeducation.me>"), APP_URL.
import { adminClient } from '../_shared/supabase.ts';

const MAX_ATTEMPTS = 5;

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function emailHtml(subject: string, body: string, link?: string) {
  const paragraphs = esc(body).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a202c">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#1a365d;color:#fff;border-radius:12px 12px 0 0;padding:18px 24px;font-weight:700;font-size:18px">Elite <span style="color:#d69e2e">Education</span></div>
    <div style="background:#fff;border-radius:0 0 12px 12px;padding:24px;font-size:15px;line-height:1.55">
      <h2 style="margin:0 0 16px;font-size:18px;color:#1a365d">${esc(subject)}</h2>
      ${paragraphs}
      ${link ? `<p style="margin:20px 0 0"><a href="${link}" style="background:#d69e2e;color:#1a365d;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Open in the app</a></p>` : ''}
    </div>
    <p style="color:#64748b;font-size:12px;text-align:center">Elite Education UAE · eliteeducation.me</p>
  </div></body></html>`;
}

Deno.serve(async () => {
  const db = adminClient();
  const appUrl = Deno.env.get('APP_URL') ?? 'https://eliteeducation.me';
  const from = Deno.env.get('EMAIL_FROM') ?? 'Elite Education <hello@eliteeducation.me>';
  const resendKey = Deno.env.get('RESEND_API_KEY');

  const { data: queue, error } = await db
    .from('notification_outbox')
    .select('*, profiles(push_token)')
    .is('sent_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at')
    .limit(100);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  for (const n of queue ?? []) {
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
    if (problems.length) {
      await db.from('notification_outbox').update({ attempts: n.attempts + 1, error: problems.join('; ') }).eq('id', n.id);
    } else {
      await db.from('notification_outbox').update({ sent_at: new Date().toISOString(), error: null }).eq('id', n.id);
      sent++;
    }
  }
  return new Response(`sent ${sent} of ${queue?.length ?? 0}`);
});
