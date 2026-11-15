import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/storage.mjs';
const dir=await mkdtemp(join(tmpdir(),'simmusic-import-'));
try {
 const files=(await readdir('drizzle')).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
 const sql=(await Promise.all(files.map(n=>readFile(join('drizzle',n),'utf8')))).join('\n');
 const dump=join(dir,'source.sql');await writeFile(dump,sql+"\nINSERT INTO genres VALUES ('migration check','migration check');");
 const target=join(dir,'imported');
 const run=()=>spawnSync(process.execPath,['scripts/import-cloudflare.mjs',dump,'https://example.invalid',target],{encoding:'utf8',windowsHide:true});
 const first=run();assert.equal(first.status,0,first.stdout+first.stderr);
 const db=openDatabase(target);assert.equal(await db.prepare('SELECT name FROM genres').first('name'),'migration check');db.close();
 assert.notEqual(run().status,0,'must refuse an existing destination');
 console.log('PASS migration roundtrip and existing-data protection');
}finally{await rm(dir,{recursive:true});}
