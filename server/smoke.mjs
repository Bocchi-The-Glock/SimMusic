import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const data=await mkdtemp(join(tmpdir(),'simmusic-smoke-'));
const base='http://127.0.0.1:3197';
const pagesOrigin='https://simmc-music.github.io';
let child,logs='',count=0;
function start(){child=spawn(process.execPath,['server.js'],{cwd:resolve('dist/standalone'),env:{...process.env,HOST:'127.0.0.1',PORT:'3197',SIMMUSIC_DATA_DIR:data,SIMMUSIC_ALLOWED_ORIGIN:pagesOrigin},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);}
async function stop(){if(child.exitCode!==null)return;await new Promise(r=>{child.once('exit',r);child.kill();});}
async function ready(){for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/state');if(r.ok)return;}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}throw Error(logs);}
async function call(path,method='GET',body,cookie='',status=200){const r=await fetch(base+path,{method,headers:{Origin:base,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});const json=await r.json();assert.equal(r.status,status,JSON.stringify(json));count++;return {json,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
try{
 start();await ready();
 const initial=(await call('/api/state')).json;assert.equal(initial.livehouses[0].id,'starry');
 const external=await fetch(base+'/api/auth',{method:'POST',headers:{Origin:pagesOrigin,'Content-Type':'application/json'},body:JSON.stringify({mode:'register',gameId:'PagesTest',password:'test-only-12345',confirmPassword:'test-only-12345'})});
 assert.equal(external.status,201);const externalData=await external.json();assert.match(externalData.sessionToken,/^[a-f0-9]{64}$/);
 const authHeaders={Origin:pagesOrigin,Authorization:'Bearer '+externalData.sessionToken};
 assert.equal((await (await fetch(base+'/api/state',{headers:authHeaders})).json()).user.gameId,'PagesTest');
 const blocked=await fetch(base+'/api/auth',{method:'POST',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:JSON.stringify({mode:'logout'})});assert.equal(blocked.status,403);
 await fetch(base+'/api/auth',{method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},body:JSON.stringify({mode:'logout'})});
 assert.equal((await (await fetch(base+'/api/state',{headers:authHeaders})).json()).user,null);
 const user=await call('/api/auth','POST',{mode:'register',gameId:'AliyunTest',password:'test-only-12345',confirmPassword:'test-only-12345'},'',201);
 const cookie=user.cookie;assert.equal(user.json.user.role,'user');
 const other=await call('/api/auth','POST',{mode:'register',gameId:'OtherTest',password:'test-only-12345',confirmPassword:'test-only-12345'},'',201);
 const shop=(await call('/api/shops','POST',{name:'test shop',x:1,y:2,z:3,port:''},cookie,201)).json;
 const song=(await call('/api/songs','POST',{title:'test music',artist:'artist',price:10,customPrice:false,bars:null,genre:'摇滚',description:'',shopIds:[shop.id]},cookie,201)).json;
 await call(`/api/songs/${song.id}`,'DELETE',undefined,other.cookie,403);
 await call(`/api/songs/${song.id}/favorite`,'PUT',{},cookie);
 const venue=(await call('/api/livehouses','POST',{name:'test venue',x:1,y:2,z:3,port:''},cookie,201)).json;
 await call('/api/events','POST',{livehouseId:venue.id,date:'2026-11-15',hour:20,playerId:'Guest',title:'test show'},'',201);
 await call('/api/livehouses/starry','DELETE',undefined,cookie,403);
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
 await call(`/api/songs/${song.id}/image`,'PATCH',{imageDataUrl:image},cookie);
 let state=(await call('/api/state','GET',undefined,cookie)).json;
 const saved=state.songs.find(s=>s.id===song.id);assert.equal(saved.favoriteCount,1);assert.ok(saved.imageUrl);
 const cover=await fetch(base+saved.imageUrl);assert.equal(cover.status,200);assert.equal(cover.headers.get('content-type'),'image/png');
 await stop();start();await ready();
 state=(await call('/api/state','GET',undefined,cookie)).json;assert.ok(state.songs.find(s=>s.id===song.id).isFavorited);
 assert.equal((await fetch(base+saved.imageUrl)).status,200);
 await call(`/api/songs/${song.id}`,'DELETE',undefined,cookie);
 await call(`/api/shops/${shop.id}`,'DELETE',undefined,cookie);
 await call(`/api/livehouses/${venue.id}`,'DELETE',undefined,cookie);
 await call('/api/auth','POST',{mode:'logout'},cookie);
 assert.equal((await call('/api/state','GET',undefined,cookie)).json.user,null);
 console.log(`PASS ${count} API checks; images and restart persistence verified`);
}catch(e){console.error(logs);throw e;}finally{if(child)await stop();await rm(data,{recursive:true});}
