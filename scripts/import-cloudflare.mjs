// Run locally while the source site is read-only/stopped for writes.
// Never expose this tool as an HTTP endpoint. Destination MUST be new.
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openDatabase, fileBucket } from '../server/storage.mjs';
const [dump, source, destination] = process.argv.slice(2);
if (!dump || !source || !destination) throw Error('Usage: node scripts/import-cloudflare.mjs dump.sql https://old-site new-data-directory');
const origin = new URL(source);
if (origin.protocol !== 'https:') throw Error('Source must be HTTPS');
const target = resolve(destination);
// mkdir without recursive refuses existing destinations, protecting live data.
await mkdir(target, { mode: 0o700 });
await mkdir(join(target, 'IMPORT_INCOMPLETE'));
let database;
try {
  database = new DatabaseSync(join(target, 'simmusic.sqlite'));
  database.exec(await readFile(resolve(dump), 'utf8'));
  if (database.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('Invalid database');
  if (database.prepare('PRAGMA foreign_key_check').all().length) throw Error('Foreign key check failed');
  // Compare every application table/column against a fresh database built from migrations.
  const referenceDir = join(target, 'schema-reference');
  const reference = openDatabase(referenceDir); reference.close();
  const referenceDb = new DatabaseSync(join(referenceDir, 'simmusic.sqlite'));
  const tables = referenceDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'simmusic_migrations'").all();
  for (const { name } of tables) {
    const fields = db => db.prepare(`PRAGMA table_info("${name}")`).all().map(r => `${r.name}:${r.type}:${r.notnull}:${r.pk}`).join('|');
    if (fields(referenceDb) !== fields(database)) throw Error(`Schema mismatch: ${name}. Apply pending Cloudflare migrations first.`);
  }
  referenceDb.close(); await rm(referenceDir, { recursive: true });
  database.exec('CREATE TABLE IF NOT EXISTS simmusic_migrations (name TEXT PRIMARY KEY)');
  for (const name of (await readdir('drizzle')).filter(n => /^\d+.*\.sql$/.test(n))) database.prepare('INSERT OR IGNORE INTO simmusic_migrations VALUES (?)').run(name);
  const images = database.prepare('SELECT object_key, mime_type, size_bytes FROM entity_images').all();
  const bucket = fileBucket(target);
  for (const row of images) {
    const response = await fetch(new URL(`/api/images/${row.object_key}`, origin), { signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== row.mime_type) throw Error(`Image unavailable: ${row.object_key}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== row.size_bytes || bytes.length > 100000) throw Error(`Image size mismatch: ${row.object_key}`);
    await bucket.put(`covers/${row.object_key}`, bytes);
  }
  // Force new login on the new host; passwords, users and ownership stay intact.
  database.exec('DELETE FROM sessions; DELETE FROM rate_windows;');
  database.close(); database = undefined;
  await rename(join(target, 'IMPORT_INCOMPLETE'), join(target, 'IMPORT_COMPLETE'));
  console.log(`Imported ${tables.length} tables and ${images.length} images into ${target}`);
} catch (error) {
  database?.close();
  console.error('Import incomplete. Do not deploy this directory. Source and other destinations were untouched.');
  throw error;
}
