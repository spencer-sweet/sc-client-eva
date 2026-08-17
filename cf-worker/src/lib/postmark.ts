import type { ContactFormData } from '../types/webflow-form';

export interface PostmarkSendConfig {
  serverToken: string;
  from: string;
  to: string;
}

interface PostmarkEmailResponse {
  MessageID?: string;
  ErrorCode?: number;
  Message?: string;
}

/** Build a plain-text notification from the typed contact fields. */
export function formatContactEmail(data: ContactFormData): { subject: string; textBody: string } {
  const name = [data.title, data.nameFirst, data.nameLast].filter(Boolean).join(' ').trim() || 'Unknown';
  return {
    subject: `New contact form submission from ${name}`,
    textBody: [
      `Title: ${data.title}`,
      `First name: ${data.nameFirst}`,
      `Last name: ${data.nameLast}`,
      `Organization: ${data.nameOrg}`,
      `Email: ${data.email}`,
    ].join('\n'),
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
  if (!config.from) throw new Error('Missing POSTMARK_FROM');
  if (!config.to) throw new Error('Missing POSTMARK_TO');

  const { subject, textBody } = formatContactEmail(data);

  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': config.serverToken,
    },
    body: JSON.stringify({
      From: config.from,
      To: config.to,
      Subject: subject,
      TextBody: textBody,
      ReplyTo: data.email || undefined, // TODO make this the new customer
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
