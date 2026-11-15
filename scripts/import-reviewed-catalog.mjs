import { DatabaseSync } from 'node:sqlite';
import { readFileSync,writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const arg=k=>process.argv[process.argv.indexOf(k)+1];
if(!process.argv.includes('--db')||!process.argv.includes('--input'))throw Error('Usage: node scripts/import-reviewed-catalog.mjs --db db.sqlite --input reviewed.json [--apply] [--report report.json]');
const input=JSON.parse(readFileSync(resolve(arg('--input')),'utf8'));
const db=new DatabaseSync(resolve(arg('--db')));db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
const key=s=>String(s).trim().toLowerCase();
const text=(s,label)=>{if(typeof s!=='string'||!s.trim())throw Error('Missing '+label);return s.trim();};
const stats={playersCreated:0,contactsUpdated:0,shopsCreated:0,shopsMatched:0,shopOwnersUpdated:0,songsCreated:0,songsMatched:0,sourcesAdded:0};
const notes=[];
const before={};for(const table of ['users','songs','shops','livehouses','events','entity_images','favorites','sessions'])before[table]=db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
const protectedRows={users:db.prepare('SELECT * FROM users ORDER BY id').all(),images:db.prepare('SELECT * FROM entity_images ORDER BY entity_type,entity_id').all(),events:db.prepare('SELECT * FROM events ORDER BY id').all(),songs:db.prepare('SELECT id,title,artist,price,custom_price,bars,genre,description,owner,owner_id,created_at FROM songs ORDER BY id').all()};
function player(gameId,contact=''){
 gameId=text(gameId,'player');const normalized=key(gameId);
 let row=db.prepare('SELECT * FROM players WHERE game_key=?').get(normalized);
 if(!row){const user=db.prepare('SELECT id FROM users WHERE game_key=?').get(normalized);const id=normalized==='bocchi_theglock'?'system-admin':user?.id||randomUUID();db.prepare('INSERT INTO players(id,game_id,game_key,contact) VALUES (?,?,?,?)').run(id,gameId,normalized,'');row={id,contact:''};stats.playersCreated++;}
 if(contact){const merged=[...new Set([String(row.contact||''),String(contact)].flatMap(s=>s.split('\n')).map(s=>s.trim()).filter(Boolean))].join('\n');if(merged!==row.contact){db.prepare('UPDATE players SET contact=? WHERE id=?').run(merged,row.id);stats.contactsUpdated++;}}
 return row.id;
}
function coordinates(v){if(v===null||v===undefined)return null;for(const k of ['x','y','z'])if(!Number.isSafeInteger(v[k]))throw Error('Invalid coordinate '+k);if(Math.abs(v.x)>30000000||Math.abs(v.z)>30000000||v.y < -30000000 || v.y>30000000)throw Error('Coordinate out of range');return v;}
const acceptedInstruments=new Set(['钢琴','清音电吉他','木吉他','萨克斯','小提琴','大提琴','贝斯','竖笛','鼓组','失真电吉他']);
db.exec('BEGIN IMMEDIATE');
try{
 for(const p of input.players||[])player(p.gameId,p.contact||'');
 const shopMap=new Map();
 for(const shop of input.shops||[]){
  const name=text(shop.name,'shop name'),ownerId=player(shop.owner),c=shop.x==null||shop.y==null||shop.z==null?null:coordinates(shop);
  let row=shop.existingId?db.prepare('SELECT * FROM shops WHERE id=?').get(shop.existingId):null;
  const source=db.prepare('SELECT entity_id FROM import_records WHERE source=? AND source_id=?').get('catalog-shop',String(shop.key));
  if(!row&&source)row=db.prepare('SELECT * FROM shops WHERE id=?').get(source.entity_id);
  if(shop.existingId&&!row)throw Error('Reviewed shop no longer exists: '+shop.existingId);
  let id=row?.id;
  if(row){stats.shopsMatched++;if(row.owner_id!==ownerId){db.prepare('UPDATE shops SET owner_id=? WHERE id=?').run(ownerId,id);stats.shopOwnersUpdated++;}if(!row.coordinates_known&&c)db.prepare('UPDATE shops SET x=?,y=?,z=?,coordinates_known=1 WHERE id=?').run(c.x,c.y,c.z,id);}
  else{if(db.prepare('SELECT id FROM shops WHERE name_key=?').get(key(name)))throw Error('Unreviewed existing shop name collision: '+name);id=randomUUID();db.prepare('INSERT INTO shops(id,name,name_key,x,y,z,port,created_at,owner_id,creator_id,coordinates_known) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,name,key(name),c?.x??0,c?.y??0,c?.z??0,shop.port||'',Date.now(),ownerId,'system-admin',c?1:0);stats.shopsCreated++;}
  db.prepare('INSERT OR IGNORE INTO import_records(source,source_id,entity_id) VALUES (?,?,?)').run('catalog-shop',String(shop.key),id);shopMap.set(shop.key,id);
 }
 for(const song of input.songs||[]){
  const title=text(song.title,'song title'),owner=text(song.owner,'song owner'),ownerId=player(owner);
  const sources=song.sources||[];if(!sources.length)throw Error('Song missing provenance: '+title);
  const mapped=[...new Set(sources.map(s=>db.prepare('SELECT entity_id FROM import_records WHERE source=? AND source_id=?').get(String(s.source),String(s.id))?.entity_id).filter(Boolean))];
  if(mapped.length>1||song.existingId&&mapped.length&&mapped[0]!==song.existingId)throw Error('Conflicting reviewed merge: '+title);
  let id=song.existingId||mapped[0],existing=id?db.prepare('SELECT * FROM songs WHERE id=?').get(id):null;
  if(id&&!existing)throw Error('Referenced song is missing: '+id);
  const instruments=[...new Set(song.instruments?.length?song.instruments:['钢琴'])];if(instruments.some(i=>!acceptedInstruments.has(i)))throw Error('Unknown instrument: '+title);
  const c=coordinates(song.saleCoordinates);
  if(existing){if(key(existing.owner)!==key(owner))throw Error('Reviewed owner mismatch: '+title);stats.songsMatched++;const merged=[...new Set([...JSON.parse(existing.instruments||'["钢琴"]'),...instruments])];db.prepare('UPDATE songs SET instruments=? WHERE id=?').run(JSON.stringify(merged),id);if(existing.sale_x==null&&c)db.prepare('UPDATE songs SET sale_x=?,sale_y=?,sale_z=? WHERE id=?').run(c.x,c.y,c.z,id);}
  else{id=randomUUID();const custom=song.customPrice===true||song.price==null;if(!custom&&(!(song.price>0)||!Number.isFinite(song.price)))throw Error('Invalid price: '+title);const genre=song.genre||'未分类';if(genre==='未分类')db.prepare('INSERT OR IGNORE INTO genres(name,name_key) VALUES (?,?)').run(genre,genre);db.prepare('INSERT INTO songs(id,title,artist,price,custom_price,bars,genre,description,owner,owner_id,created_at,instruments,sale_x,sale_y,sale_z) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,title,song.artist||'未注明',custom?null:song.price,custom?1:0,song.bars||0,genre,song.description||'',owner,ownerId,Date.now(),JSON.stringify(instruments),c?.x??null,c?.y??null,c?.z??null);stats.songsCreated++;}
  for(const shopKey of song.shopKeys||[]){const shopId=shopMap.get(shopKey);if(!shopId)throw Error('Unknown reviewed shop: '+shopKey);db.prepare('INSERT OR IGNORE INTO song_shops(song_id,shop_id) VALUES (?,?)').run(id,shopId);}
  for(const source of sources){const result=db.prepare('INSERT OR IGNORE INTO import_records(source,source_id,entity_id) VALUES (?,?,?)').run(String(source.source),String(source.id),id);stats.sourcesAdded+=Number(result.changes);}
 }
 for(const [name,query] of Object.entries({users:'SELECT * FROM users ORDER BY id',images:'SELECT * FROM entity_images ORDER BY entity_type,entity_id',events:'SELECT * FROM events ORDER BY id'})){if(JSON.stringify(db.prepare(query).all())!==JSON.stringify(protectedRows[name]))throw Error('Protected existing data changed: '+name);}
 for(const old of protectedRows.songs){const now=db.prepare('SELECT id,title,artist,price,custom_price,bars,genre,description,owner,owner_id,created_at FROM songs WHERE id=?').get(old.id);if(JSON.stringify(now)!==JSON.stringify(old))throw Error('Existing song fields changed: '+old.id);}
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign-key violations');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Integrity check failed');
 const after={};for(const table of Object.keys(before))after[table]=db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
 const applied=process.argv.includes('--apply');db.exec(applied?'COMMIT':'ROLLBACK');
 const report={applied,stats,before,after,notes,reviewNotes:input.reviewNotes||[]};
 if(process.argv.includes('--report'))writeFileSync(resolve(arg('--report')),JSON.stringify(report,null,2));console.log(JSON.stringify({applied,stats,before,after},null,2));
}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
