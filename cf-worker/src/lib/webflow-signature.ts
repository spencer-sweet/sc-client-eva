/**
 * Webflow webhook signature verification (HMAC-SHA256).
 * @see https://developers.webflow.com/data/docs/working-with-webhooks#validating-request-signatures
 *
 * Message = `${x-webflow-timestamp}:${rawBody}`
 * Key    = webhook secret (site token secret or OAuth client secret)
 * Reject if signature mismatch or timestamp older than 5 minutes.
 */

const MAX_AGE_MS = 5 * 60 * 1000;

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * @param rawBody Exact request body string Webflow signed (do not re-stringify JSON).
 */
export async function verifyWebflowSignature(
  secret: string,
  timestampHeader: string | null,
  rawBody: string,
  signatureHeader: string | null,
): Promise<SignatureCheck> {
  if (!secret) return { ok: false, reason: 'Missing WEBFLOW_WEBHOOK_SECRET' };
  if (!timestampHeader) return { ok: false, reason: 'Missing x-webflow-timestamp header' };
  if (!signatureHeader) return { ok: false, reason: 'Missing x-webflow-signature header' };

  const requestTimestamp = Number(timestampHeader);
  if (!Number.isFinite(requestTimestamp)) {
    return { ok: false, reason: 'Invalid x-webflow-timestamp' };
  }

  if (Date.now() - requestTimestamp > MAX_AGE_MS) {
    return { ok: false, reason: 'Request older than 5 minutes (possible replay)' };
  }

  const expected = await hmacSha256Hex(secret, `${requestTimestamp}:${rawBody}`);
  if (!timingSafeEqualHex(expected, signatureHeader.toLowerCase())) {
    return { ok: false, reason: 'Invalid signature' };
  }

  return { ok: true };
}
