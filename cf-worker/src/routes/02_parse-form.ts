import { jsonResponse } from '../lib/json-response';
import { parsePostBody } from '../lib/parse-body';
import {
  isWebflowFormSubmission,
  parseContactFormData,
  type ContactFormData,
} from '../types/webflow-form';

/**
 * POST /wf/02_parse-form — extract typed contact fields from Webflow
 * form_submission payload.data and log them.
 */
export async function handle02ParseForm(request: Request): Promise<Response> {
  const body = await parsePostBody(request);

  if (!isWebflowFormSubmission(body)) {
    console.warn('[wf/02_parse-form] unexpected body shape:', body);
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
  console.log('[wf/02_parse-form] data:', data);

  return jsonResponse({ ok: true, data });
}
