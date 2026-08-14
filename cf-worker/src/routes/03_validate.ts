import { jsonResponse } from '../lib/json-response';
import { verifyWebflowSignature } from '../lib/webflow-signature';
import {
  isWebflowFormSubmission,
  parseContactFormData,
  type ContactFormData,
} from '../types/webflow-form';
import type { Env } from '../env';

/**
 * POST /wf/03_validate — same ContactFormData extraction as /wf/02_parse-form,
 * but only after Webflow HMAC signature + timestamp checks pass.
 *
 * Uses the raw body bytes for HMAC (must match what Webflow signed).
 * @see https://developers.webflow.com/data/docs/working-with-webhooks#validating-request-signatures
 */
export async function handle03Validate(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();
  const timestamp = request.headers.get('x-webflow-timestamp');
  const signature = request.headers.get('x-webflow-signature');
  const check = await verifyWebflowSignature(
    // env.WEBFLOW_WEBHOOK_SECRET,
    '5eca7eff7fe688b4e65c5ab6dd0857d2f2a5b321e7800196bdb9e74dd3497fd5', // tmp
    timestamp,
    rawBody,
    signature,
  );

  if (!check.ok) {
    // Dashboard / Logic "Send to" webhooks often omit signature headers entirely.
    const headerDump = {
      'x-webflow-timestamp': timestamp,
      'x-webflow-signature': signature ? '(present)' : null,
      'content-type': request.headers.get('content-type'),
      'user-agent': request.headers.get('user-agent'),
    };
    console.warn('[wf/03_validate] rejected:', check.reason, headerDump);
    return jsonResponse(
      {
        ok: false,
        error: check.reason,
        hint:
          'Signature headers are only sent for webhooks created via the Webflow Data API (not dashboard/Logic “Send to”). Use /wf/02_parse-form for unsigned webhooks, or create the webhook with the API so x-webflow-timestamp + x-webflow-signature are included.',
      },
      401,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (!isWebflowFormSubmission(body)) {
    console.warn('[wf/03_validate] unexpected body shape:', body);
    return jsonResponse(
      {
        ok: false,
        error: 'Expected Webflow form_submission JSON ({ triggerType, payload.data })',
        received: body,
      },
      400,
    );
  }

  const data: ContactFormData = parseContactFormData(body.payload.data);
  console.log('[wf/03_validate] data:', data);

  return jsonResponse({ ok: true, data });
}
