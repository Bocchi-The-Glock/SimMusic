import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const dataDirectory = () => resolve(process.env.SIMMUSIC_DATA_DIR || 'data');
export function migrate(sqlite, directory = resolve('drizzle')) {
  sqlite.exec('CREATE TABLE IF NOT EXISTS simmusic_migrations (name TEXT PRIMARY KEY)');
  for (const name of readdirSync(directory).filter(n => /^\d+.*\.sql$/.test(n)).sort()) {
    if (sqlite.prepare('SELECT 1 FROM simmusic_migrations WHERE name=?').get(name)) continue;
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec(readFileSync(join(directory, name), 'utf8'));
      sqlite.prepare('INSERT INTO simmusic_migrations VALUES (?)').run(name);
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
}

export function openDatabase(directory = dataDirectory(), migrations = resolve('drizzle')) {
  if (existsSync(join(directory, 'IMPORT_INCOMPLETE'))) throw Error('Refusing incomplete import');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(join(directory, 'simmusic.sqlite'));
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  migrate(sqlite, migrations);
  class Statement {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...args) { return new Statement(this.sql, args); }
    execute() {
      const statement = sqlite.prepare(this.sql);
      const before = sqlite.prepare('SELECT total_changes() AS n').get().n;
      const results = statement.all(...this.args.map(v => v instanceof ArrayBuffer ? new Uint8Array(v) : v));
      const meta = sqlite.prepare('SELECT total_changes()-? AS changes, last_insert_rowid() AS last_row_id').get(before);
      return { success: true, results, meta: { ...meta, duration: 0 } };
    }
    async all() { return this.execute(); }
    async run() { return this.execute(); }
    async first(column) { const row = this.execute().results[0]; return column ? row?.[column] ?? null : row ?? null; }
  }
  return {
    prepare: sql => new Statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = statements.map(s => s.execute());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close: () => sqlite.close(),
  };
}

export function fileBucket(directory = dataDirectory()) {
  const root = join(directory, 'images');
  function path(key) {
    if (!/^covers\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(key)) throw new Error('Invalid image key');
    return join(root, key);
  }
  return {
    async put(key, bytes) {
      const target = path(key);
      await mkdir(join(root, 'covers'), { recursive: true, mode: 0o700 });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' }); await rename(temporary, target); }
      finally { await unlink(temporary).catch(e => { if(e.code !== 'ENOENT') throw e; }); }
    },
    async get(key) {
      try {
        const bytes = await readFile(path(key));
        return { body: new Uint8Array(bytes), size: bytes.length, httpEtag: `"${createHash('sha256').update(bytes).digest('hex')}"` };
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async delete(key) { await unlink(path(key)).catch(e => { if (e.code !== 'ENOENT') throw e; }); },
  };
}
