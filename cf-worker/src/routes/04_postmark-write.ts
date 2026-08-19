import { jsonResponse } from '../lib/json-response';
import { sendContactFormNotification } from '../lib/postmark';
import { loadValidatedContactForm } from '../lib/validated-form';
import type { Env } from '../env';

/**
 * POST /wf/04_postmark-write — validate Webflow signature, then email the
 * typed ContactFormData via Postmark.
 */
export async function handle04PostmarkWrite(request: Request, env: Env): Promise<Response> {
  const result = await loadValidatedContactForm(request, env);
  if (!result.ok) return result.response;

  console.log('[wf/04_postmark-write] data:', result.data);

  try {
    const { messageId } = await sendContactFormNotification(result.data, {
      serverToken: env.POSTMARK_SERVER_TOKEN,
      to: env.POSTMARK_TO,
    });
    return jsonResponse({ ok: true, data: result.data, messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[wf/04_postmark-write] postmark error:', message);
    return jsonResponse({ ok: false, error: message }, 502);
  }
}
