/**
 * Normalize a request body into a plain object.
 * Webflow Logic webhooks usually send JSON; form actions may send urlencoded/multipart.
 */
export async function parsePostBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const json = await request.json();
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      return json as Record<string, unknown>;
    }
    return { value: json };
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const form = await request.formData();
    const data: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      data[key] = typeof value === 'string' ? value : (value as File).name;
    }
    return data;
  }

  const text = await request.text();
  if (!text) return {};
  try {
    const json = JSON.parse(text) as unknown;
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      return json as Record<string, unknown>;
    }
    return { value: json };
  } catch {
    return { raw: text };
  }
}
