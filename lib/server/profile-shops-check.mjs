// Real HTTP verification for a local preview; cleans only IDs created by this run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const base=process.argv[2]||'http://127.0.0.1:5173';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
assert.ok(process.env.SIMLIVE_ADMIN_TEST_PASSWORD,'Set SIMLIVE_ADMIN_TEST_PASSWORD');
const stamp=Date.now().toString(36), users=[], songs=[], shops=[], cookies=[];
let checks=0,admin,oldAdminBio;
const sqlQuote=(value)=>`'${String(value).replaceAll("'","''")}'`;
function localSql(sql) {
  const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',sql],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
}
async function call(path,{method='GET',body,cookie='',status=200,origin=base}={}) {
  const response=await fetch(base+path,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  const text=await response.text();
  let data;try{data=JSON.parse(text);}catch{data={error:text};}
  assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data)}`);checks++;
  return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
}
async function register(label) {
  const result=await call('/api/auth',{method:'POST',status:201,body:{mode:'register',gameId:`qa_profile_${label}_${stamp}`,password:'local-profile-test',confirmPassword:'local-profile-test'}});
  users.push(result.data.user.id);cookies.push(result.cookie);return result;
}
async function createShop(user,name) {
  const result=(await call('/api/shops',{method:'POST',cookie:user.cookie,status:201,body:{name:`${name} ${stamp}`,x:10,y:64,z:20,port:'测试港',ownerId:'somebody-else'}})).data;
  shops.push(result.id);return result;
}
async function createSong(user,shopIds=[]) {
  const result=(await call('/api/songs',{method:'POST',cookie:user.cookie,status:201,body:{title:`Profile check ${stamp}`,artist:'Unregistered credit name',price:40,customPrice:false,bars:32,genre:'摇滚',description:'',shopIds}})).data;
  songs.push(result.id);return result;
}
try {
  await call('/api/auth',{method:'POST',status:400,body:{mode:'register',gameId:`qa_missing_${stamp}`,password:'local-profile-test'}});
  await call('/api/auth',{method:'POST',status:400,body:{mode:'register',gameId:`qa_mismatch_${stamp}`,password:'local-profile-test',confirmPassword:'different-password'}});
  await call('/api/profile',{method:'PATCH',status:401,body:{bio:'guest'}});
  await call('/api/shops',{method:'POST',status:401,body:{name:'guest'}});
  const a=await register('a'),b=await register('b');
  assert.equal(a.data.user.bio,'');
  assert.ok(!(await call('/api/state')).data.artists.some(v=>v.id===a.data.user.id));
  await call('/api/profile',{method:'PATCH',cookie:a.cookie,body:{bio:'第一行\n第二行',userId:b.data.user.id}});
  await call('/api/profile',{method:'PATCH',cookie:a.cookie,status:400,body:{bio:'x'.repeat(1001)}});
  const own=(await call('/api/state',{cookie:a.cookie})).data;
  assert.equal(own.user.bio,'第一行\n第二行');
  assert.equal((await call('/api/state',{cookie:b.cookie})).data.user.bio,'');
  await call('/api/profile',{method:'PATCH',cookie:a.cookie,origin:'https://unrelated.example',status:403,body:{bio:'no'}});
  const s1=await createShop(a,'Profile store A'),s2=await createShop(b,'Profile store B');
  assert.equal(s1.ownerId,a.data.user.id);assert.equal(s1.owner,a.data.user.gameId);assert.equal(s1.canManage,true);
  assert.equal((await call('/api/state')).data.shops.find(s=>s.id===s1.id).canManage,false);
  assert.equal((await call('/api/state',{cookie:b.cookie})).data.shops.find(s=>s.id===s1.id).canManage,false);
  const change={name:`Updated store ${stamp}`,x:-100,y:70,z:88,port:'更新港'};
  await call(`/api/shops/${s1.id}`,{method:'PATCH',cookie:b.cookie,status:403,body:change});
  await call(`/api/shops/${s1.id}`,{method:'DELETE',cookie:b.cookie,status:403});
  await call(`/api/shops/${s1.id}`,{method:'PATCH',cookie:a.cookie,status:400,body:{...change,x:1.5}});
  await call(`/api/shops/${s1.id}`,{method:'PATCH',cookie:a.cookie,status:409,body:{...change,name:s2.name.toUpperCase()}});
  const edit=(await call(`/api/shops/${s1.id}`,{method:'PATCH',cookie:a.cookie,body:{...change,ownerId:b.data.user.id}})).data;
  assert.equal(edit.ownerId,a.data.user.id);assert.equal(edit.x,-100);
  const song1=await createSong(a,[s1.id,s2.id]),song2=await createSong(a);
  let state=(await call('/api/state')).data;
  assert.deepEqual(state.artists.find(v=>v.id===a.data.user.id),{id:a.data.user.id,gameId:a.data.user.gameId,bio:'第一行\n第二行',songCount:2,avatarUrl:null});
  assert.ok(!state.artists.some(v=>v.gameId==='Unregistered credit name'||v.id===b.data.user.id));
  await call(`/api/shops/${s1.id}`,{method:'DELETE',cookie:a.cookie});
  state=(await call('/api/state')).data;
  assert.deepEqual(state.songs.find(v=>v.id===song1.id).shopIds,[s2.id]);
  assert.equal(state.artists.find(v=>v.id===a.data.user.id).songCount,2);
  admin=await call('/api/auth',{method:'POST',body:{mode:'login',gameId:'Bocchi_TheGlock',password:process.env.SIMLIVE_ADMIN_TEST_PASSWORD}});cookies.push(admin.cookie);oldAdminBio=admin.data.user.bio;
  assert.equal((await call('/api/state',{cookie:admin.cookie})).data.shops.find(s=>s.id===s2.id).canManage,true);
  await call(`/api/shops/${s2.id}`,{method:'PATCH',cookie:admin.cookie,body:{...change,name:`Admin updated ${stamp}`}});
  await call('/api/profile',{method:'PATCH',cookie:admin.cookie,body:{bio:`Admin profile check ${stamp}`}});
  const adminSong=await createSong(admin);
  state=(await call('/api/state')).data;
  assert.equal(state.artists.find(v=>v.id===admin.data.user.id).bio,`Admin profile check ${stamp}`);
  assert.equal(state.artists.find(v=>v.id===admin.data.user.id).gameId,'Bocchi_TheGlock');
  await call(`/api/songs/${adminSong.id}`,{method:'DELETE',cookie:admin.cookie});
  const legacyId=randomUUID();shops.push(legacyId);
  localSql(`INSERT INTO shops (id,name,name_key,x,y,z,port,created_at) VALUES (${sqlQuote(legacyId)},${sqlQuote('Legacy '+stamp)},${sqlQuote('legacy '+stamp)},0,64,0,'旧港',${Date.now()})`);
  const legacy=(await call('/api/state',{cookie:a.cookie})).data.shops.find(s=>s.id===legacyId);
  assert.equal(legacy.ownerId,null);assert.equal(legacy.owner,null);assert.equal(legacy.canManage,false);
  await call(`/api/shops/${legacyId}`,{method:'PATCH',cookie:a.cookie,status:403,body:change});
  await call(`/api/shops/${legacyId}`,{method:'PATCH',cookie:admin.cookie,body:{...change,name:`Legacy updated ${stamp}`}});
  await call(`/api/shops/${legacyId}`,{method:'DELETE',cookie:admin.cookie});
  await call(`/api/shops/${s2.id}`,{method:'DELETE',cookie:admin.cookie});
  state=(await call('/api/state')).data;
  assert.deepEqual(state.songs.find(v=>v.id===song1.id).shopIds,[]);
  await call(`/api/songs/${song1.id}`,{method:'DELETE',cookie:a.cookie});
  assert.equal((await call('/api/state')).data.artists.find(v=>v.id===a.data.user.id).songCount,1);
  await call(`/api/songs/${song2.id}`,{method:'DELETE',cookie:a.cookie});
  assert.ok(!(await call('/api/state')).data.artists.some(v=>v.id===a.data.user.id));
  console.log(`PASS: ${checks} HTTP checks; password confirmation, profiles, artist membership/counts, shop ownership, legacy ownership and linked-song preservation.`);
} finally {
  if(admin&&oldAdminBio!==undefined)await call('/api/profile',{method:'PATCH',cookie:admin.cookie,body:{bio:oldAdminBio}});
  for(const cookie of cookies)await call('/api/auth',{method:'POST',cookie,body:{mode:'logout'}});
  const commands=[];
  for(const id of songs)commands.push(`DELETE FROM song_shops WHERE song_id=${sqlQuote(id)}`,`DELETE FROM songs WHERE id=${sqlQuote(id)}`);
  for(const id of shops)commands.push(`DELETE FROM song_shops WHERE shop_id=${sqlQuote(id)}`,`DELETE FROM shops WHERE id=${sqlQuote(id)}`);
  for(const id of users)commands.push(`DELETE FROM sessions WHERE user_id=${sqlQuote(id)}`,`DELETE FROM profiles WHERE user_id=${sqlQuote(id)}`,`DELETE FROM users WHERE id=${sqlQuote(id)}`);
  if(commands.length)localSql(commands.join(';'));
  console.log('Local test records cleaned.');
}
