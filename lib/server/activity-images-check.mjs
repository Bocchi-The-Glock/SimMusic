import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../../server/storage.mjs';

const directory=await mkdtemp(join(tmpdir(),'simmusic-activity-images-')),base='http://127.0.0.1:3202';
const token=randomBytes(32).toString('hex'),admin=`simlive_session=${token}`;
const db=openDatabase(directory);
await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(createHash('sha256').update(token).digest('hex'),'system-admin',Date.now()+300000).run();
await db.prepare('INSERT INTO players VALUES (?,?,?,?)').bind('legacy-player','LegacyPlayer','legacyplayer','').run();
await db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?,?,?)').bind('legacy-activity','Legacy activity','2026-12-01','Before programme names','Old location','legacy-player',null,1).run();
await db.prepare('INSERT INTO activity_signups(activity_id,kind,player_id,participant_key,created_at) VALUES (?,?,?,?,?)').bind('legacy-activity','individual','LegacyGuest','individual:legacyguest',2).run();
db.close();
const child=spawn(process.execPath,['server.js'],{cwd:resolve('dist/standalone'),env:{...process.env,HOST:'127.0.0.1',PORT:'3202',SIMMUSIC_DATA_DIR:directory},windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='',checks=0;child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
async function call(path,method='GET',body,cookie='',expected=200){
 const response=await fetch(base+path,{method,headers:{Origin:base,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 const data=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(data)}`);checks++;
 return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
const register=async gameId=>call('/api/auth','POST',{mode:'register',gameId,password:'test-activity-images',confirmPassword:'test-activity-images'},'',201);
const state=async()=>(await call('/api/state')).data;
const png=await sharp({create:{width:24,height:24,channels:3,background:'#6b819e'}}).png().toBuffer();
const webp=await sharp({create:{width:24,height:24,channels:3,background:'#b16848'}}).webp().toBuffer();
const dataUrl=(bytes,type='png')=>`data:image/${type};base64,${bytes.toString('base64')}`;
function paddedPng(size){
 const payload=Buffer.alloc(size-png.length-12,65);payload.write('padding\0');
 const chunk=Buffer.alloc(payload.length+12);chunk.writeUInt32BE(payload.length);chunk.write('tEXt',4);payload.copy(chunk,8);
 let crc=0xffffffff;for(const byte of chunk.subarray(4,-4)){crc^=byte;for(let i=0;i<8;i++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;}
 chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
 return Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]);
}
async function imageCheck(url,bytes){
 assert.match(url,/^\/api\/images\/[a-f0-9-]{36}\.(png|webp)$/);
 const response=await fetch(base+url);assert.equal(response.status,200);assert.ok(Number(response.headers.get('content-length'))<=100000);
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);checks++;
}
async function filesEqual(urls){
 const expected=urls.map(url=>url.split('/').at(-1)).sort();
 for(let i=0;i<50;i++){
  const actual=await readdir(join(directory,'images','covers')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  if(JSON.stringify(actual.sort())===JSON.stringify(expected)){checks++;return;}
  if(i===49)assert.deepEqual(actual,expected,'Detached or rejected image objects must be removed');
  await new Promise(r=>setTimeout(r,20));
 }
}
const activityBody={name:'Cover activity',date:'2026-12-02',description:'Activity cover checks',location:'Test location'};
try{
 let ready=false;for(let i=0;i<150;i++){try{if((await fetch(base+'/api/state')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(output);await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 let snapshot=await state();assert.equal(snapshot.activities.find(a=>a.id==='legacy-activity').imageUrl,null);assert.equal(snapshot.activitySignups[0].programName,'');
 const owner=await register('CoverOwner'),other=await register('OtherOwner');
 const venue=(await call('/api/livehouses','POST',{name:'Cover venue',x:1,y:64,z:2,port:''},owner.cookie,201)).data;
 await call('/api/activities','POST',{...activityBody,imageDataUrl:dataUrl(png)},'',401);
 await call('/api/activities','POST',{...activityBody,livehouseId:venue.id,imageDataUrl:dataUrl(png)},other.cookie,403);
 await filesEqual([]);
 const activity=(await call('/api/activities','POST',{...activityBody,livehouseId:venue.id,imageDataUrl:dataUrl(png)},owner.cookie,201)).data;
 const path=`/api/activities/${activity.id}`;await imageCheck(activity.imageUrl,png);await filesEqual([activity.imageUrl]);
 assert.equal((await state()).activities.find(a=>a.id===activity.id).imageUrl,activity.imageUrl);
 await call(path,'PATCH',{imageDataUrl:dataUrl(webp,'webp')},other.cookie,403);
 await call(path,'DELETE',undefined,other.cookie,403);
 const preserved=(await call(path,'PATCH',{description:'Text edit keeps cover'},owner.cookie)).data;assert.equal(preserved.imageUrl,activity.imageUrl);
 await call(path,'PATCH',{name:'Must not save',imageDataUrl:'https://example.test/cover.png'},owner.cookie,400);
 await call(path,'PATCH',{imageDataUrl:'data:image/svg+xml;base64,PHN2Zy8+'},owner.cookie,400);
 await call(path,'PATCH',{imageDataUrl:dataUrl(paddedPng(100001))},owner.cookie,413);
 await call('/api/activities','POST',{...activityBody,imageDataUrl:dataUrl(paddedPng(100001))},owner.cookie,413);
 assert.equal((await state()).activities.find(a=>a.id===activity.id).name,activity.name);await filesEqual([activity.imageUrl]);
 const blocked=(await call('/api/activities','POST',{...activityBody,date:'2026-12-03',livehouseId:venue.id},owner.cookie,201)).data;assert.equal(blocked.imageUrl,null);
 await call('/api/activities','POST',{...activityBody,livehouseId:venue.id,imageDataUrl:dataUrl(webp,'webp')},owner.cookie,409);
 await call(path,'PATCH',{date:'2026-12-03',name:'Rejected replacement',imageDataUrl:dataUrl(webp,'webp')},owner.cookie,409);
 await call(path,'PATCH',{date:'2026-12-03',imageDataUrl:null},owner.cookie,409);
 snapshot=await state();const unchanged=snapshot.activities.find(a=>a.id===activity.id);
 assert.equal(unchanged.imageUrl,activity.imageUrl);assert.equal(unchanged.name,activity.name);assert.equal(unchanged.date,activity.date);
 await imageCheck(activity.imageUrl,png);await filesEqual([activity.imageUrl]);
 const boundary=(await call(path,'PATCH',{imageDataUrl:dataUrl(paddedPng(100000))},owner.cookie)).data;
 await imageCheck(boundary.imageUrl,paddedPng(100000));await call(activity.imageUrl,'GET',undefined,'',404);await filesEqual([boundary.imageUrl]);
 const adminEdit=(await call(path,'PATCH',{imageDataUrl:dataUrl(webp,'webp')},admin)).data;
 await imageCheck(adminEdit.imageUrl,webp);await call(boundary.imageUrl,'GET',undefined,'',404);await filesEqual([adminEdit.imageUrl]);
 const cleared=(await call(path,'PATCH',{imageDataUrl:null},owner.cookie)).data;assert.equal(cleared.imageUrl,null);await call(adminEdit.imageUrl,'GET',undefined,'',404);await filesEqual([]);
 await Promise.all([1,2,3].map(()=>call(path,'PATCH',{imageDataUrl:dataUrl(png)},owner.cookie)));
 const live=(await state()).activities.find(a=>a.id===activity.id).imageUrl;await imageCheck(live,png);await filesEqual([live]);
 await call(`${path}/signups`,'POST',{kind:'individual',playerId:'Visitor',programName:'Cover show'},'',201);
 await call(path,'DELETE',undefined,admin);await call(live,'GET',undefined,'',404);await filesEqual([]);
 assert.equal((await state()).activitySignups.filter(s=>s.activityId===activity.id).length,0);
 console.log(`PASS ${checks} activity image/legacy signup checks; 100 KB boundary, permissions, failed-save atomicity, concurrent cleanup and deletion`);
}catch(error){console.error(output);throw error;}
finally{if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});await rm(directory,{recursive:true});}
