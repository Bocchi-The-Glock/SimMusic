// Isolated local HTTP checks; never run against a hosted site.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
const base=process.argv[2]||'http://127.0.0.1:5173';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const stamp=Date.now().toString(36),users=[],records=[];
const adminToken=randomBytes(32).toString('hex'),adminHash=createHash('sha256').update(adminToken).digest('hex'),adminCookie=`simlive_session=${adminToken}`;
const q=v=>`'${String(v).replaceAll("'","''")}'`;
let checks=0;
function sql(statement){const r=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',statement],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,'Local fixture SQL failed');}
async function call(path,{method='GET',body,cookie='',status=200,origin=base}={}){
 const r=await fetch(base+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{data={error:raw};}
 assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(data)}`);checks++;
 return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
}
async function register(label){const u=await call('/api/auth',{method:'POST',body:{mode:'register',gameId:`qa_music_${label}_${stamp}`,password:'local-music-test',confirmPassword:'local-music-test'},status:201});users.push(u);return u;}
const png=await sharp({create:{width:30,height:30,channels:3,background:'#426b9c'}}).png().toBuffer();
const jpg=await sharp({create:{width:30,height:30,channels:3,background:'#ad593e'}}).jpeg().toBuffer();
const imageDataUrl=`data:image/png;base64,${png.toString('base64')}`;
const songBody={title:'A New Song',artist:'Original Artist',price:20,customPrice:false,bars:24,genre:'流行',description:'Original',shopIds:[]};
const venueBody={name:`Music house ${stamp}`,x:1,y:64,z:2};
const shopBody={name:`Music shop ${stamp}`,x:2,y:65,z:3};
try{
 const a=await register('a'),b=await register('b');
 sql(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${q(adminHash)},'system-admin',${Date.now()+600000})`);
 const shop=(await call('/api/shops',{method:'POST',cookie:a.cookie,body:shopBody,status:201})).data;records.push({kind:'shops',id:shop.id});assert.equal(shop.port,'');
 const house=(await call('/api/livehouses',{method:'POST',cookie:a.cookie,body:{...venueBody,port:'   ',imageDataUrl},status:201})).data;records.push({kind:'livehouses',id:house.id});assert.equal(house.port,'');
 for(const port of [42,null,{},'x'.repeat(101)]){
  await call('/api/shops',{method:'POST',cookie:a.cookie,body:{...shopBody,port},status:400});
  await call('/api/livehouses',{method:'POST',cookie:a.cookie,body:{...venueBody,port},status:400});
 }
 const s=(await call('/api/songs',{method:'POST',cookie:a.cookie,body:{...songBody,shopIds:[shop.id],imageDataUrl},status:201})).data;records.push({kind:'songs',id:s.id});
 assert.equal(s.favoriteCount,0);assert.equal(s.isFavorited,false);assert.equal(s.canEdit,true);
 const path=`/api/songs/${s.id}`,favorite=path+'/favorite';
 await call(favorite,{method:'PUT',status:401});await call(favorite,{method:'DELETE',status:401});
 await call(path,{method:'PATCH',body:songBody,status:401});await call(path,{method:'PATCH',body:songBody,cookie:b.cookie,status:403});
 await call(favorite,{method:'PUT',cookie:b.cookie,origin:'https://unrelated.test',status:403});
 const one=(await call(favorite,{method:'PUT',cookie:b.cookie,body:{userId:a.data.user.id}})).data;
 assert.deepEqual(one,{id:s.id,favoriteCount:1,isFavorited:true});
 for(const result of await Promise.all(Array.from({length:5},()=>call(favorite,{method:'PUT',cookie:b.cookie}))))assert.equal(result.data.favoriteCount,1);
 let publicSong=(await call('/api/state')).data.songs.find(song=>song.id===s.id);assert.equal(publicSong.favoriteCount,1);assert.equal(publicSong.isFavorited,false);assert.equal(publicSong.canEdit,false);assert.equal('owner_id' in publicSong,false);
 assert.equal((await call('/api/state',{cookie:a.cookie})).data.songs.find(song=>song.id===s.id).isFavorited,false);
 assert.equal((await call('/api/state',{cookie:b.cookie})).data.songs.find(song=>song.id===s.id).isFavorited,true);
 assert.equal((await call(favorite,{method:'PUT',cookie:a.cookie})).data.favoriteCount,2);
 assert.equal((await call(favorite,{method:'PUT',cookie:adminCookie})).data.favoriteCount,3);
 assert.equal((await call(favorite,{method:'DELETE',cookie:b.cookie})).data.favoriteCount,2);
 assert.equal((await call(favorite,{method:'DELETE',cookie:b.cookie})).data.favoriteCount,2);
 const changed={...songBody,title:'Edited Title',artist:'New Artist',customPrice:true,price:null,bars:48,genre:'摇滚',description:'New description',shopIds:[]};
 const edited=(await call(path,{method:'PATCH',cookie:adminCookie,body:{...changed,owner:b.data.user.gameId,owner_id:b.data.user.id}})).data;
 assert.equal(edited.owner,a.data.user.gameId);assert.equal(edited.favoriteCount,2);assert.equal(edited.isFavorited,true);assert.equal(edited.imageUrl,s.imageUrl);assert.deepEqual(edited.shopIds,[]);assert.equal(edited.title,changed.title);
 const mine=(await call('/api/state',{cookie:a.cookie})).data.songs.find(song=>song.id===s.id);assert.equal(mine.canEdit,true);assert.equal(mine.isFavorited,true);assert.equal(mine.artist,'New Artist');
 const stranger=(await call('/api/state',{cookie:b.cookie})).data.songs.find(song=>song.id===s.id);assert.equal(stranger.canEdit,false);assert.equal(stranger.isFavorited,false);
 await call(path,{method:'PATCH',cookie:a.cookie,body:{...songBody,price:0},status:400});
 await call(path,{method:'PATCH',cookie:a.cookie,body:{...songBody,shopIds:['missing']},status:400});
 assert.equal((await call('/api/state')).data.songs.find(song=>song.id===s.id).title,changed.title);
 const own=(await call(path,{method:'PATCH',cookie:a.cookie,body:{...songBody,shopIds:[shop.id],imageDataUrl:`data:image/jpeg;base64,${jpg.toString('base64')}`}})).data;
 assert.notEqual(own.imageUrl,s.imageUrl);await call(s.imageUrl,{status:404});
 const removed=(await call(path,{method:'PATCH',cookie:a.cookie,body:{...songBody,imageDataUrl:null}})).data;assert.equal(removed.imageUrl,null);await call(own.imageUrl,{status:404});
 assert.equal(removed.favoriteCount,2);
 const hpath=`/api/livehouses/${house.id}`;
 await call(hpath,{method:'PATCH',cookie:b.cookie,body:venueBody,status:403});
 const hp=(await call(hpath,{method:'PATCH',cookie:a.cookie,body:{...venueBody,name:'Edited house',port:'A port',owner:b.data.user.gameId}})).data;
 assert.equal(hp.owner,a.data.user.gameId);assert.equal(hp.imageUrl,house.imageUrl);assert.equal(hp.port,'A port');
 const ha=(await call(hpath,{method:'PATCH',cookie:adminCookie,body:{...venueBody,name:'Admin house',imageDataUrl:null}})).data;assert.equal(ha.port,'');assert.equal(ha.imageUrl,null);assert.equal(ha.owner,a.data.user.gameId);await call(house.imageUrl,{status:404});
 await call('/api/livehouses/starry',{method:'PATCH',cookie:adminCookie,body:venueBody,status:403});
 const sp=(await call(`/api/shops/${shop.id}`,{method:'PATCH',cookie:a.cookie,body:{...shopBody,port:'  '}})).data;assert.equal(sp.port,'');
 await call(`/api/shops/${shop.id}`,{method:'PATCH',cookie:a.cookie,body:{...shopBody,port:123},status:400});
 await call('/api/songs/missing/favorite',{method:'PUT',cookie:a.cookie,status:404});await call('/api/songs/missing/favorite',{method:'DELETE',cookie:a.cookie,status:404});
 await call(path,{method:'DELETE',cookie:a.cookie});
 await call(favorite,{method:'PUT',cookie:a.cookie,status:404});await call(favorite,{method:'DELETE',cookie:b.cookie,status:404});
 assert.ok(!(await call('/api/state',{cookie:adminCookie})).data.songs.some(song=>song.id===s.id));
 console.log(`PASS: ${checks} HTTP checks; favorite idempotency/account isolation/counts, owner/admin editing, image preservation/removal, optional ports and protected Starry.`);
}finally{
 for(const item of records.filter(r=>r.kind==='songs').concat(records.filter(r=>r.kind!=='songs'))){const r=await fetch(`${base}/api/${item.kind}/${item.id}`,{method:'DELETE',headers:{Origin:base,Cookie:adminCookie}});assert.ok([200,404].includes(r.status));}
 sql([`DELETE FROM sessions WHERE token_hash=${q(adminHash)}`,...users.flatMap(u=>[`DELETE FROM favorites WHERE user_id=${q(u.data.user.id)}`,`DELETE FROM sessions WHERE user_id=${q(u.data.user.id)}`,`DELETE FROM profiles WHERE user_id=${q(u.data.user.id)}`,`DELETE FROM users WHERE id=${q(u.data.user.id)}`])].join(';'));
 console.log('Cleaned only this run’s local users, sessions, favorites and content.');
}
