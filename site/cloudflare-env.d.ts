declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AGENT_SITES_TOKEN?: string;
  }
}
