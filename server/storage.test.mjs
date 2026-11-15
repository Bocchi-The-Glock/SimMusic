import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, fileBucket } from './storage.mjs';
test('transactions rollback, persist, and migrate once', async () => {
 const dir=await mkdtemp(join(tmpdir(),'simmusic-test-')); let db=openDatabase(dir);
 try {
  const insert=n=>db.prepare('INSERT INTO genres(name,name_key) VALUES (?,?)').bind(n,n);
  await assert.rejects(db.batch([insert('a'),insert('a')]));
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM genres').first('n'),0);
  const result=await db.batch([insert('b'),db.prepare('SELECT name FROM genres')]);
  assert.equal(result[0].meta.changes,1); assert.equal(result[1].results[0].name,'b');
  db.close(); db=openDatabase(dir);
  assert.equal(await db.prepare('SELECT name FROM genres').first('name'),'b');
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM simmusic_migrations').first('n'),4);
 } finally {db.close();await rm(dir,{recursive:true});}
});
test('images roundtrip and reject traversal; incomplete imports fail closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'simmusic-image-'));
 try {
  const b=fileBucket(dir),key='covers/01234567-0123-0123-0123-012345678901.png';
  await b.put(key,new Uint8Array([1,2,3])); const image=await b.get(key);
  assert.equal(image.size,3);assert.deepEqual([...image.body],[1,2,3]);
  await assert.rejects(b.get('../simmusic.sqlite'));await b.delete(key);assert.equal(await b.get(key),null);await b.delete(key);
  await mkdir(join(dir,'IMPORT_INCOMPLETE'));assert.throws(()=>openDatabase(dir),/incomplete/);
 } finally {await rm(dir,{recursive:true});}
});
