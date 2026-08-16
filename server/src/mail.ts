import { MAIL_FROM, RESEND_API_KEY } from './config.js';

/**
 * Outbound mail, via Resend's HTTPS API.
 *
 * Deliberately not nodemailer: SMTP would be a dependency, a connection pool
 * and a pile of transport config for the one message this app ever sends. This
 * is a fetch call.
 *
 * With no RESEND_API_KEY the mailer does not fail — it logs the message body to
 * the server console instead. That is the honest local-dev path (the reset link
 * lands in the terminal you are already watching) and the honest small-server
 * path (the operator reads it out of the Railway log). Callers are told which
 * happened so the UI never promises an inbox that nothing was sent to.
 */

export function mailConfigured(): boolean {
  return RESEND_API_KEY.length > 0;
}

export interface Mail {
  to: string;
  subject: string;
  /** Plain-text body. Always sent; the HTML is the enhancement, not the mail. */
  text: string;
  html: string;
}

/** True if the message actually reached the mail provider. */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (!mailConfigured()) {
    console.log(
      `\n--- mail not configured; message not sent ---\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n--- end ---\n`,
    );
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });
    if (!res.ok) {
      // The body carries the real reason (unverified sending domain, bad key).
      // Worth logging in full — it is the operator's only clue.
      console.error(`mail send failed (${res.status}): ${await res.text().catch(() => '')}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('mail send threw', err);
    return false;
  }
}

/** The one message this app sends. */
export function resetEmail(username: string, link: string, ttlMinutes: number): Omit<Mail, 'to'> {
  const text = [
    `Someone asked to reset the password for the Roll67 account "${username}".`,
    '',
    'Open this link to choose a new one:',
    link,
    '',
    `The link works once and expires in ${ttlMinutes} minutes.`,
    'If this was not you, ignore this message — nothing has changed.',
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#e8e4dc;background:#16130f;padding:28px;border-radius:10px;max-width:520px">
      <p style="font-size:20px;letter-spacing:.14em;margin:0 0 20px">ROLL67</p>
      <p>Someone asked to reset the password for the account <strong>${escapeHtml(username)}</strong>.</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(link)}" style="background:#c8a349;color:#16130f;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600;display:inline-block">Choose a new password</a>
      </p>
      <p style="color:#a29a8c;font-size:13px">The link works once and expires in ${ttlMinutes} minutes.
      If this was not you, ignore this message — nothing has changed.</p>
      <p style="color:#a29a8c;font-size:12px;word-break:break-all">${escapeHtml(link)}</p>
    </div>
  `;

  return { subject: 'Reset your Roll67 password', text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}
