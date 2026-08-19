import type { ContactFormData } from '../types/webflow-form';

export interface PostmarkSendConfig {
  serverToken: string;
  to: string;
}

interface PostmarkEmailResponse {
  MessageID?: string;
  ErrorCode?: number;
  Message?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayName(data: ContactFormData): string {
  return [data.nameFirst, data.nameLast].filter(Boolean).join(' ').trim() || 'Unknown';
}

function fieldRow(label: string, valueHtml: string, last: boolean): string {
  const border = last ? 'none' : '1px solid #e6e6e6';
  return `
    <tr>
      <td style="padding:16px 0;border-bottom:${border};">
        <div style="font-size:13px;line-height:18px;color:#666666;font-weight:400;margin:0 0 4px 0;">${escapeHtml(label)}</div>
        <div style="font-size:18px;line-height:24px;color:#000000;font-weight:700;">${valueHtml}</div>
      </td>
    </tr>`;
}

function plainField(label: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return `${label}: ${trimmed}`;
}

/** Build a notification from the typed contact fields. */
export function formatContactEmail(data: ContactFormData): {
  subject: string;
  textBody: string;
  htmlBody: string;
} {
  const name = displayName(data);
  const email = data.email.trim();
  const emailHtml = email
    ? `<a href="mailto:${escapeHtml(email)}" style="color:#0066cc;text-decoration:underline;">${escapeHtml(email)}</a>`
    : '—';

  const rows: Array<{ label: string; html: string; text: string }> = [
    { label: 'First name', html: escapeHtml(data.nameFirst || '—'), text: data.nameFirst },
    { label: 'Last name', html: escapeHtml(data.nameLast || '—'), text: data.nameLast },
    { label: 'Email', html: emailHtml, text: email },
    { label: 'Organization', html: escapeHtml(data.nameOrg || '—'), text: data.nameOrg },
    { label: 'Job title', html: escapeHtml(data.jobTitle || '—'), text: data.jobTitle },
  ];

  if (data.message.trim()) {
    rows.push({
      label: 'Message',
      html: escapeHtml(data.message).replace(/\n/g, '<br>'),
      text: data.message,
    });
  }

  const htmlBody = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;padding:8px 24px;">
      ${rows.map((row, i) => fieldRow(row.label, row.html, i === rows.length - 1)).join('')}
    </table>
  </body>
</html>`;

  const textBody = rows
    .map((row) => plainField(row.label, row.text))
    .filter((line): line is string => line != null)
    .join('\n');

  return {
    subject: `Website submission from: ${name}`,
    textBody,
    htmlBody,
  };
}

/**
 * Send a single outbound email via Postmark.
 * @see https://postmarkapp.com/developer/api/email-api
 */
export async function sendContactFormNotification(
  data: ContactFormData,
  config: PostmarkSendConfig,
): Promise<{ messageId: string }> {
  if (!config.serverToken) throw new Error('Missing POSTMARK_SERVER_TOKEN');
  if (!config.to) throw new Error('Missing POSTMARK_TO');

  const fromEmail = data.email.trim();
  if (!fromEmail) throw new Error('Missing submitter email');

  const { subject, textBody, htmlBody } = formatContactEmail(data);
  const fromName = displayName(data);
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  const from = fromName !== 'Unknown' ? `"${fromName.replace(/"/g, '')}" <${fromEmail}>` : fromEmail;

  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': config.serverToken,
    },
    body: JSON.stringify({
      // From: from,
      From: config.to, // tmp - postmark acct needs approval to make from as customers' addr
      To: config.to,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      MessageStream: 'outbound', // default outgoing mail stream
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Postmark request failed (${response.status}): ${errorBody}`);
  }

  const result = (await response.json()) as PostmarkEmailResponse;
  const messageId = result.MessageID ?? '';
  console.log('[postmark] Email sent:', messageId);
  return { messageId };
}
