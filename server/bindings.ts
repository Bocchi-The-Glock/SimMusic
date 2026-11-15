// Build-time alias: the Cloudflare build never imports Node-only modules.
import { openDatabase, fileBucket } from './storage.mjs';
let database: D1Database | undefined;
export const env = {
  get DB(): D1Database { return database ??= openDatabase() as unknown as D1Database; },
  get BUCKET(): R2Bucket { return fileBucket() as unknown as R2Bucket; },
};
export function waitUntil(task: Promise<unknown>) {
  void task.catch(() => console.error('Background image cleanup failed'));
}
