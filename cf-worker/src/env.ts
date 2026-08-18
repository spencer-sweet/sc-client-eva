/** Cloudflare Worker bindings (secrets / vars). */
export interface Env {
  /** Webflow webhook signing secret (site token secret or OAuth client secret). */
  WEBFLOW_WEBHOOK_SECRET: string;
  /** Postmark server API token. */
  POSTMARK_SERVER_TOKEN: string;
  /** Verified Postmark From address. */
  POSTMARK_FROM: string;
  /** Inbox that receives contact-form notifications. */
  POSTMARK_TO: string;
}
