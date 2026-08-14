/** Cloudflare Worker bindings (secrets / vars). */
export interface Env {
  /** Webflow webhook signing secret (site token secret or OAuth client secret). */
  WEBFLOW_WEBHOOK_SECRET: string;
}
