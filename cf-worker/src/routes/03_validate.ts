import { jsonResponse } from '../lib/json-response';
import { loadValidatedContactForm } from '../lib/validated-form';
import type { Env } from '../env';

/**
 * POST /wf/03_validate — verify Webflow signature, parse ContactFormData, log it.
 */
export async function handle03Validate(request: Request, env: Env): Promise<Response> {
  const result = await loadValidatedContactForm(request, env);
  if (!result.ok) return result.response;

  console.log('[wf/03_validate] data:', result.data);
  return jsonResponse({ ok: true, data: result.data });
}
