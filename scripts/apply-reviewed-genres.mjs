import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_GENRES } from '../lib/server/constants.ts';

// Only applies an explicitly reviewed, identity-checked mapping. No fuzzy matching.
const args = process.argv.slice(2);
const arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
if (!arg('--db') || !arg('--input')) throw Error('Usage: --db existing.sqlite --input reviewed.json [--apply] [--report report.json]');
const databasePath = resolve(arg('--db'));
if (!existsSync(databasePath)) throw Error('Database does not exist');
const review = JSON.parse(readFileSync(resolve(arg('--input')), 'utf8'));
if (!Array.isArray(review) || !review.length) throw Error('Expected nonempty reviewed song array');
const seen = new Set();
for (const item of review) {
  for (const field of ['id', 'title', 'artist', 'owner', 'oldGenre', 'newGenre', 'reason']) {
    if (typeof item[field] !== 'string' || !item[field].trim()) throw Error(`Missing ${field}`);
  }
  if (seen.has(item.id)) throw Error(`Duplicate reviewed ID: ${item.id}`);
  seen.add(item.id);
}
const sqlite = new DatabaseSync(databasePath);
sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
const digest = rows => createHash('sha256').update(JSON.stringify(rows.map(row => JSON.stringify(row)).sort())).digest('hex');
const quoted = name => '"' + name.replaceAll('"', '""') + '"';
try {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
  const snapshot = () => Object.fromEntries(tables.map(table => [table, sqlite.prepare(`SELECT * FROM ${quoted(table)}`).all()]));
  const before = snapshot();
  const allowed = new Set([...DEFAULT_GENRES, ...before.genres.map(row => row.name)]);
  const changed = [], unchanged = [];
  for (const item of review) {
    if (!allowed.has(item.newGenre)) throw Error(`Unknown genre: ${item.newGenre}`);
    const row = sqlite.prepare('SELECT * FROM songs WHERE id=?').get(item.id);
    if (!row) throw Error(`Reviewed song is missing: ${item.id}`);
    if (row.title !== item.title || row.artist !== item.artist || row.owner !== item.owner) throw Error(`Song changed since review: ${item.title}`);
    if (row.genre === item.newGenre) { unchanged.push(item.id); continue; }
    if (row.genre !== item.oldGenre) throw Error(`Genre changed since review: ${item.title}`);
    const result = sqlite.prepare('UPDATE songs SET genre=? WHERE id=? AND genre=?').run(item.newGenre, item.id, item.oldGenre);
    if (Number(result.changes) !== 1) throw Error(`Update failed: ${item.id}`);
    changed.push({ id: item.id, title: item.title, oldGenre: item.oldGenre, newGenre: item.newGenre });
  }
  const after = snapshot();
  const stripGenre = rows => rows.map(({ genre, ...row }) => row);
  for (const table of tables) {
    const oldRows = table === 'songs' ? stripGenre(before[table]) : before[table];
    const newRows = table === 'songs' ? stripGenre(after[table]) : after[table];
    if (digest(oldRows) !== digest(newRows)) throw Error(`Unexpected data change in ${table}`);
  }
  if (sqlite.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('Database integrity check failed');
  if (sqlite.prepare('PRAGMA foreign_key_check').all().length) throw Error('Foreign key check failed');
  const genreCounts = sqlite.prepare('SELECT genre,COUNT(*) AS count FROM songs GROUP BY genre ORDER BY count DESC,genre').all();
  const report = { applied: args.includes('--apply'), reviewed: review.length, updated: changed.length, unchanged: unchanged.length, songs: after.songs.length, otherDataUnchanged: true, genreCounts, changes: changed };
  // Create the audit report before commit; a failed report write cannot silently commit.
  if (arg('--report')) writeFileSync(resolve(arg('--report')), JSON.stringify(report, null, 2));
  sqlite.exec(report.applied ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify({ ...report, changes: undefined }, null, 2));
} catch (error) {
  sqlite.exec('ROLLBACK');
  throw error;
} finally {
  sqlite.close();
}
