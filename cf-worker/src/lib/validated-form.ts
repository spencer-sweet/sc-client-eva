import { jsonResponse } from './json-response';
import { verifyWebflowSignature } from './webflow-signature';
import {
  isWebflowFormSubmission,
  parseContactFormData,
  type ContactFormData,
} from '../types/webflow-form';
import type { Env } from '../env';

export type ValidatedFormResult =
  | { ok: true; data: ContactFormData }
  | { ok: false; response: Response };

/**
 * Read raw body → verify Webflow signature → parse ContactFormData.
 * Shared by /wf/03_validate and /wf/04_postmark-write.
 */
export async function loadValidatedContactForm(
  request: Request,
  env: Env,
): Promise<ValidatedFormResult> {
  const rawBody = await request.text();
  const timestamp = request.headers.get('x-webflow-timestamp');
  const signature = request.headers.get('x-webflow-signature');
  const check = await verifyWebflowSignature(
    env.WEBFLOW_WEBHOOK_SECRET,
    // '318ed29b9ba9b7f2e2b8de9e55abb247cb7b4fdfa55a3d3de6c4dc5866752159', // tmp dev tunnel secret
    timestamp,
    rawBody,
    signature,
  );

  if (!check.ok) {
    const headerDump = {
      'x-webflow-timestamp': timestamp,
      'x-webflow-signature': signature ? '(present)' : null,
      'content-type': request.headers.get('content-type'),
      'user-agent': request.headers.get('user-agent'),
    };
    console.warn('[validate] rejected:', check.reason, headerDump);
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: check.reason,
          hint:
            'Signature headers are only sent for webhooks created via the Webflow Data API (not dashboard/Logic “Send to”). Use /wf/02_parse-form for unsigned webhooks, or create the webhook with the API so x-webflow-timestamp + x-webflow-signature are included.',
        },
        401,
      ),
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return { ok: false, response: jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400) };
  }

  if (!isWebflowFormSubmission(body)) {
    console.warn('[validate] unexpected body shape:', body);
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: 'Expected Webflow form_submission JSON ({ triggerType, payload.data })',
          received: body,
        },
        400,
      ),
    };
  }

  return { ok: true, data: parseContactFormData(body.payload.data) };
}
