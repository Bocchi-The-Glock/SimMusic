import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'simmusic-reviewed-genres-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'test.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE genres(name TEXT PRIMARY KEY); INSERT INTO genres VALUES ('未分类'),('流行'),('游戏音乐');
    CREATE TABLE songs(id TEXT PRIMARY KEY,title TEXT,artist TEXT,owner TEXT,genre TEXT,description TEXT,price INTEGER);
    INSERT INTO songs VALUES ('1','song one','artist','Player','未分类','keep description',123),('2','song two','artist','Player','未分类','keep other',456);
    CREATE TABLE events(id INTEGER PRIMARY KEY,title TEXT); INSERT INTO events VALUES (1,'keep event');`);
  db.close();
  const review = [1, 2].map((n) => ({ id: String(n), title: n === 1 ? 'song one' : 'song two', artist: 'artist', owner: 'Player', oldGenre: '未分类', newGenre: n === 1 ? '流行' : '游戏音乐', reason: 'reviewed' }));
  const run = (rows = review, apply = false) => {
    const input = join(directory, 'review.json'); writeFileSync(input, JSON.stringify(rows));
    return spawnSync(process.execPath, [resolve('scripts/apply-reviewed-genres.mjs'), '--db', path, '--input', input, ...(apply ? ['--apply'] : [])], { encoding: 'utf8', windowsHide: true });
  };
  const rows = () => { const db = new DatabaseSync(path); try { return { songs: db.prepare('SELECT * FROM songs ORDER BY id').all(), events: db.prepare('SELECT * FROM events ORDER BY id').all() }; } finally { db.close(); } };
  return { run, rows, review };
}

test('dry run preserves all data; applying changes genres only and is idempotent', (t) => {
  const f = fixture(t), before = f.rows();
  const dry = f.run(); assert.equal(dry.status, 0, dry.stderr); assert.deepEqual(f.rows(), before);
  const applied = f.run(f.review, true); assert.equal(applied.status, 0, applied.stderr);
  const after = f.rows(); assert.deepEqual(after.events, before.events);
  assert.deepEqual(after.songs.map(s => ({ ...s })), before.songs.map((s, i) => ({ ...s, genre: f.review[i].newGenre })));
  const again = f.run(f.review, true); assert.equal(again.status, 0, again.stderr); assert.equal(JSON.parse(again.stdout).updated, 0);
});

test('a concurrent title or genre change aborts the entire transaction', (t) => {
  const f = fixture(t), before = f.rows();
  const conflict = f.review.map((r, i) => i === 1 ? { ...r, title: 'stale title' } : r);
  assert.notEqual(f.run(conflict, true).status, 0); assert.deepEqual(f.rows(), before);
  const genreConflict = f.review.map((r, i) => i === 1 ? { ...r, oldGenre: '流行' } : r);
  assert.notEqual(f.run(genreConflict, true).status, 0); assert.deepEqual(f.rows(), before);
});

test('unrecognized genres, missing songs and duplicate mappings cannot alter data', (t) => {
  const f = fixture(t), before = f.rows();
  for (const invalid of [
    [...f.review.slice(0, 1), { ...f.review[1], newGenre: 'not an allowed genre' }],
    [...f.review.slice(0, 1), { ...f.review[1], id: 'missing' }],
    [f.review[0], f.review[0]],
  ]) { assert.notEqual(f.run(invalid, true).status, 0); assert.deepEqual(f.rows(), before); }
});
