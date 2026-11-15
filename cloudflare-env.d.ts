declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    SIMMUSIC_ALLOWED_ORIGIN?: string;
    BUCKET?: R2Bucket;
  }
}
