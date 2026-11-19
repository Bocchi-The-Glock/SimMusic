import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM simmusic_migrations').first('n'),8);
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

test('catalog migration preserves every old table value and existing identity',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'simmusic-upgrade-'));
 let sqlite=new DatabaseSync(join(dir,'simmusic.sqlite'));
 try {
  const names=(await readdir('drizzle')).filter(n=>/^000[0-3].*\.sql$/.test(n)).sort();
  sqlite.exec('CREATE TABLE simmusic_migrations(name TEXT PRIMARY KEY)');
  for(const name of names){sqlite.exec(await readFile(join('drizzle',name),'utf8'));sqlite.prepare('INSERT INTO simmusic_migrations VALUES (?)').run(name);}
  sqlite.exec(`INSERT INTO users VALUES ('old-user','ExistingPlayer','existingplayer','salt','hash',1);
   INSERT INTO profiles VALUES ('old-user','Existing biography');
   INSERT INTO songs VALUES ('old-song','Old title','Artist',50,0,0,'摇滚','Keep description','ExistingPlayer','old-user',1);
   INSERT INTO shops VALUES ('old-shop','Old shop','old shop',1,64,3,'Port',1,'old-user');
   INSERT INTO song_shops VALUES ('old-song','old-shop');
   INSERT INTO favorites VALUES ('old-song','old-user',1);
   INSERT INTO entity_images VALUES ('song','old-song','image-key','image/png',100);
   INSERT INTO sessions VALUES ('existing-session','old-user',12345);
   INSERT INTO events VALUES (NULL,'starry','2026-11-15',20,'ExistingPlayer','old-user','Keep show',1);`);
  const tables=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'simmusic_migrations'").all().map(r=>r.name);
  const originals=tables.map(name=>{const columns=sqlite.prepare(`PRAGMA table_info(${name})`).all().map(r=>r.name).join(',');return {name,columns,rows:JSON.stringify(sqlite.prepare(`SELECT ${columns} FROM ${name}`).all())};});
  sqlite.close();const upgraded=openDatabase(dir);upgraded.close();sqlite=new DatabaseSync(join(dir,'simmusic.sqlite'));
  for(const old of originals)assert.equal(JSON.stringify(sqlite.prepare(`SELECT ${old.columns} FROM ${old.name}`).all()),old.rows,old.name);
  assert.equal(sqlite.prepare("SELECT id FROM players WHERE game_key='existingplayer'").get().id,'old-user');
  assert.equal(sqlite.prepare("SELECT creator_id FROM shops WHERE id='old-shop'").get().creator_id,'old-user');
  assert.equal(sqlite.prepare("SELECT instruments FROM songs WHERE id='old-song'").get().instruments,'["钢琴"]');
 }finally{sqlite.close();await rm(dir,{recursive:true});}
});


test('bands/activity migration preserves complete catalog-era rows including imported identities',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'simmusic-community-upgrade-'));
 let sqlite=new DatabaseSync(join(dir,'simmusic.sqlite'));
 try{
  const names=(await readdir('drizzle')).filter(n=>/^000[0-4].*\.sql$/.test(n)).sort();
  sqlite.exec('CREATE TABLE simmusic_migrations(name TEXT PRIMARY KEY)');
  for(const name of names){sqlite.exec(await readFile(join('drizzle',name),'utf8'));sqlite.prepare('INSERT INTO simmusic_migrations VALUES (?)').run(name);}
  sqlite.exec(`INSERT INTO players VALUES ('pending','PendingPlayer','pendingplayer','Keep contact');
   INSERT INTO songs(id,title,artist,price,custom_price,bars,genre,description,owner,owner_id,created_at,instruments,sale_x,sale_y,sale_z) VALUES ('song','Keep title','Artist',50,0,10,'游戏音乐','Keep description','PendingPlayer','pending',1,'["钢琴","贝斯"]',12,64,34);
   INSERT INTO shops(id,name,name_key,x,y,z,port,created_at,owner_id,creator_id,coordinates_known) VALUES ('shop','Keep shop','keep shop',0,0,0,'',1,'pending','system-admin',0);
   INSERT INTO song_shops VALUES ('song','shop');
   INSERT INTO import_records VALUES ('source','original-id','song');`);
  const tables=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'simmusic_migrations'").all().map(r=>r.name);
  const originals=Object.fromEntries(tables.map(name=>[name,JSON.stringify(sqlite.prepare(`SELECT * FROM ${name}`).all())]));
  sqlite.close();const upgraded=openDatabase(dir);upgraded.close();sqlite=new DatabaseSync(join(dir,'simmusic.sqlite'));
  for(const name of tables)assert.equal(JSON.stringify(sqlite.prepare(`SELECT * FROM ${name}`).all()),originals[name],name);
  for(const name of ['bands','band_members','activities','activity_signups'])assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n,0);
  assert.equal(sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{sqlite.close();await rm(dir,{recursive:true});}
});

test('activity programme migration preserves existing signups, covers and venue detach behavior',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'simmusic-programme-upgrade-'));
 let sqlite=new DatabaseSync(join(dir,'simmusic.sqlite'));
 try{
  const names=(await readdir('drizzle')).filter(n=>/^000[0-5].*\.sql$/.test(n)).sort();
  sqlite.exec('CREATE TABLE simmusic_migrations(name TEXT PRIMARY KEY)');
  for(const name of names){sqlite.exec(await readFile(join('drizzle',name),'utf8'));sqlite.prepare('INSERT INTO simmusic_migrations VALUES (?)').run(name);}
  sqlite.exec(`INSERT INTO players VALUES ('pending','PendingPlayer','pendingplayer','Keep contact');
   INSERT INTO bands VALUES ('band','Keep band','pending',1);
   INSERT INTO livehouses VALUES ('venue','Keep venue',1,64,3,'','PendingPlayer','pending',1);
   INSERT INTO activities VALUES ('activity','Keep activity','2026-12-01','Keep introduction','Keep location','pending','venue',1);
   INSERT INTO activity_signups VALUES (7,'activity','individual','Guest',NULL,NULL,'individual:guest',2);
   INSERT INTO activity_signups VALUES (12,'activity','band','PendingPlayer','band','pending','band:band',3);
   INSERT INTO entity_images VALUES ('song','old-song','song-cover','image/png',100),('shop','old-shop','shop-cover','image/png',200),('profile','pending','profile-cover','image/webp',300),('livehouse','venue','venue-cover','image/webp',400);`);
  const tables=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'simmusic_migrations'").all().map(r=>r.name);
  const originals=tables.map(name=>{const columns=sqlite.prepare(`PRAGMA table_info(${name})`).all().map(r=>r.name).join(',');return {name,columns,rows:JSON.stringify(sqlite.prepare(`SELECT ${columns} FROM ${name}`).all())};});
  sqlite.close();const upgraded=openDatabase(dir);upgraded.close();sqlite=new DatabaseSync(join(dir,'simmusic.sqlite'));
  for(const old of originals)assert.equal(JSON.stringify(sqlite.prepare(`SELECT ${old.columns} FROM ${old.name}`).all()),old.rows,old.name);
  assert.deepEqual(sqlite.prepare('SELECT program_name FROM activity_signups ORDER BY id').all().map(r=>r.program_name),['','']);
  sqlite.exec("INSERT INTO entity_images VALUES ('activity','activity','activity-cover','image/png',500)");
  assert.equal(sqlite.prepare("SELECT object_key FROM entity_images WHERE entity_type='activity'").get().object_key,'activity-cover');
  sqlite.exec("DELETE FROM livehouses WHERE id='venue'");
  assert.equal(sqlite.prepare("SELECT livehouse_id FROM activities WHERE id='activity'").get().livehouse_id,null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM activity_signups').get().n,2);
  assert.deepEqual(sqlite.prepare('SELECT sort_order FROM activity_signups ORDER BY id').all().map(r=>r.sort_order),[null,null]);
  assert.equal(sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{sqlite.close();await rm(dir,{recursive:true});}
});
