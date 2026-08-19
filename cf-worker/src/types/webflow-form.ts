/**
 * Webflow Logic / form webhook envelope.
 * Observed shape from a Contact Form submission (triggerType: form_submission).
 */

/** Contact form field keys — what we care about from payload.data. */
export interface ContactFormData {
  nameFirst: string;
  nameLast: string;
  nameOrg: string;
  jobTitle: string;
  email: string;
  /** Optional free-text from the form. */
  message: string;
}

export const CONTACT_FORM_KEYS = [
  'nameFirst',
  'nameLast',
  'nameOrg',
  'jobTitle',
  'email',
  'message',
] as const satisfies readonly (keyof ContactFormData)[];

export interface WebflowFormSubmission {
  triggerType: 'form_submission' | string;
  payload: WebflowFormPayload;
}

export interface WebflowFormPayload {
  name: string;
  siteId: string;
  data: ContactFormData & Record<string, string>;
  submittedAt: string;
  id: string;
  formId: string;
  formElementId: string;
  pageId: string;
  publishedPath: string;
  pageUrl: string;
  schema: unknown[];
  localeId: string | null;
}

function str(value: unknown): string {
  return value == null ? '' : String(value);
}

/** Pull the typed contact fields out of payload.data. */
export function parseContactFormData(raw: Record<string, unknown>): ContactFormData {
  return {
    nameFirst: str(raw.nameFirst),
    nameLast: str(raw.nameLast),
    nameOrg: str(raw.nameOrg),
    jobTitle: str(raw.jobTitle),
    email: str(raw.email),
    message: str(raw.message),
  };
}

export function isWebflowFormSubmission(value: unknown): value is WebflowFormSubmission {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.triggerType !== 'string') return false;
  if (!v.payload || typeof v.payload !== 'object') return false;
  const p = v.payload as Record<string, unknown>;
  return typeof p.data === 'object' && p.data !== null && !Array.isArray(p.data);
}
