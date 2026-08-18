import { jsonResponse } from '../lib/json-response';
import { parsePostBody } from '../lib/parse-body';

/** POST /wf/01_dev — log the raw webhook body and echo it as JSON. */
export async function handle01Dev(request: Request): Promise<Response> {
  const data = await parsePostBody(request);
  const stringified = JSON.stringify(data, null, 2);

  console.log('[wf/01_dev] POST body object:', data);
  console.log('[wf/01_dev] stringified JSON:\n' + stringified);

  return jsonResponse(data);
}
