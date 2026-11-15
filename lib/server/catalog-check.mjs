import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openDatabase} from '../../server/storage.mjs';
const dir=await mkdtemp(join(tmpdir(),'simmusic-catalog-')),base='http://127.0.0.1:3198';
const db=openDatabase(dir);
await db.prepare('INSERT INTO players(id,game_id,game_key,contact) VALUES (?,?,?,?)').bind('imported-player','Mixed_Name','mixed_name','QQ: 12345').run();
await db.prepare('INSERT INTO songs(id,title,artist,price,custom_price,bars,genre,description,owner,owner_id,created_at,instruments,sale_x,sale_y,sale_z) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind('imported-song','Existing song','Artist',100,0,0,'其他','keep me','Mixed_Name','imported-player',1,JSON.stringify(['小提琴','钢琴']),1,2,3).run();
db.close();
let output='',checks=0;
const child=spawn(process.execPath,['server.js'],{cwd:resolve('dist/standalone'),env:{...process.env,HOST:'127.0.0.1',PORT:'3198',SIMMUSIC_DATA_DIR:dir},windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
async function call(path,method='GET',body,cookie='',expected=200){const r=await fetch(base+path,{method,headers:{Origin:base,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});const result=await r.json();assert.equal(r.status,expected,`${path}: ${result.error||'unexpected status'}`);checks++;return {data:result,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const register=async name=>call('/api/auth','POST',{mode:'register',gameId:name,password:'test-password-123',confirmPassword:'test-password-123'},'',201);
const shopBody={name:'Shared shop',x:1,y:64,z:2,port:''};
try{
 for(let n=0;n<100;n++){try{if((await fetch(base+'/api/state')).ok)break;}catch{}if(child.exitCode!==null)throw Error(output);await new Promise(r=>setTimeout(r,100));}
 let state=(await call('/api/state')).data;
 assert.equal(state.artists.find(a=>a.id==='imported-player').registered,false);
 assert.equal(state.artists.find(a=>a.id==='imported-player').contact,'QQ: 12345');
 assert.deepEqual(state.songs[0].instruments,['小提琴','钢琴']);assert.deepEqual(state.songs[0].saleCoordinates,{x:1,y:2,z:3});
 const owner=await register('mIxEd_NaMe');assert.equal(owner.data.user.id,'imported-player');assert.equal(owner.data.user.contact,'QQ: 12345');
 await call('/api/auth','POST',{mode:'register',gameId:'MIXED_NAME',password:'replacement-123',confirmPassword:'replacement-123'},'',409);
 await call('/api/auth','POST',{mode:'login',gameId:'MIXED_NAME',password:'test-password-123'});
 state=(await call('/api/state','GET',undefined,owner.cookie)).data;assert.equal(state.artists[0].registered,true);assert.equal(state.songs[0].canEdit,true);
 const concurrent=await Promise.all(['Race_Name','RACE_NAME'].map((gameId,i)=>fetch(base+'/api/auth',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({mode:'register',gameId,password:'race-password-'+i,confirmPassword:'race-password-'+i})})));
 assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409]);
 const winner=concurrent.findIndex(r=>r.status===201);
 await call('/api/auth','POST',{mode:'login',gameId:'race_name',password:'race-password-'+winner});
 await call('/api/auth','POST',{mode:'login',gameId:'race_name',password:'race-password-'+(1-winner)},'',401);
 const creator=await register('Creator'),stranger=await register('Stranger');
 const shop=(await call('/api/shops','POST',{...shopBody,ownerGameId:'MIXED_NAME'},creator.cookie,201)).data;
 assert.equal(shop.creatorId,creator.data.user.id);assert.equal(shop.ownerId,owner.data.user.id);assert.equal(shop.owner,'Mixed_Name');
 await call('/api/shops/'+shop.id,'PATCH',{...shopBody,name:'Owner edit'},owner.cookie);
 await call('/api/shops/'+shop.id,'PATCH',{...shopBody,name:'Creator edit'},creator.cookie);
 await call('/api/shops/'+shop.id,'PATCH',{...shopBody,name:'Forbidden'},stranger.cookie,403);
 await call('/api/shops/'+shop.id,'PATCH',{...shopBody,ownerGameId:'Future_Owner'},creator.cookie);
 await call('/api/shops/'+shop.id,'PATCH',shopBody,owner.cookie,403);
 const future=await register('future_owner');await call('/api/shops/'+shop.id,'PATCH',shopBody,future.cookie);
 const songBody={title:'Existing song',artist:'Artist',price:100,customPrice:false,bars:null,genre:'其他',description:'keep me',shopIds:[]};
 const saved=(await call('/api/songs/imported-song','PATCH',songBody,owner.cookie)).data;
 assert.deepEqual(saved.instruments,['小提琴','钢琴']);assert.deepEqual(saved.saleCoordinates,{x:1,y:2,z:3});
 await call('/api/songs/imported-song','PATCH',{...songBody,instruments:['未定义乐器']},owner.cookie,400);
 await call('/api/songs/imported-song','PATCH',{...songBody,saleCoordinates:{x:1,y:2}},owner.cookie,400);
 const edited=(await call('/api/songs/imported-song','PATCH',{...songBody,instruments:['贝斯','鼓组'],saleCoordinates:null},owner.cookie)).data;
 assert.deepEqual(edited.instruments,['贝斯','鼓组']);assert.equal(edited.saleCoordinates,null);
 const fresh=(await call('/api/songs','POST',songBody,creator.cookie,201)).data;assert.deepEqual(fresh.instruments,['钢琴']);
 let profile=(await call('/api/profile','PATCH',{bio:'new bio'},owner.cookie)).data;assert.equal(profile.user.contact,'QQ: 12345');
 profile=(await call('/api/profile','PATCH',{bio:'new bio',contact:'New contact'},owner.cookie)).data;assert.equal(profile.user.contact,'New contact');
 const caseSensitive=await register('Mixed__Name');assert.notEqual(caseSensitive.data.user.id,owner.data.user.id);
 await call('/api/shops/'+shop.id,'DELETE',undefined,creator.cookie);
 console.log(`PASS catalog upgrade: ${checks} API calls; imported identity claim, contacts, case handling, ownership and song extras`);
}catch(error){console.error(output);throw error;}finally{
 if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});await rm(dir,{recursive:true});
}
