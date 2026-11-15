// Local HTTP checks for avatars and shop covers; credentials never leave this process.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';

const base=process.argv[2]||'http://127.0.0.1:5173';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const stamp=Date.now().toString(36),users=[],cookies=[],shops=[],songs=[];
const adminToken=randomBytes(32).toString('hex'),adminHash=createHash('sha256').update(adminToken).digest('hex');
const adminCookie=`simlive_session=${adminToken}`;
let checks=0,adminProfile,changedAdmin=false;
const q=value=>`'${String(value).replaceAll("'","''")}'`;
function sql(statement){const r=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',statement],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,'Local fixture SQL failed');}
async function call(path,{method='GET',body,cookie='',status=200,origin=base}={}){
  const r=await fetch(base+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{data={error:raw};}
  assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(data)}`);checks++;
  return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
}
async function register(label){const u=await call('/api/auth',{method:'POST',status:201,body:{mode:'register',gameId:`qa_avatar_${label}_${stamp}`,password:'local-avatar-check',confirmPassword:'local-avatar-check'}});users.push(u.data.user.id);cookies.push(u.cookie);return u;}
async function imageCheck(url,bytes){const r=await fetch(base+url);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);checks++;}
const png=await sharp({create:{width:24,height:24,channels:3,background:'#6b819e'}}).png().toBuffer();
const webp=await sharp({create:{width:24,height:24,channels:3,background:'#b16848'}}).webp().toBuffer();
const dataUrl=(bytes,type='png')=>`data:image/${type};base64,${bytes.toString('base64')}`;
const shopBody={name:`Avatar shop ${stamp}`,x:1,y:64,z:2,port:'头像测试港'};
try {
  const a=await register('a'),b=await register('b');
  assert.equal(a.data.user.avatarUrl,null);
  await call('/api/profile',{method:'PATCH',body:{bio:'',imageDataUrl:dataUrl(png)},status:401});
  await call('/api/shops',{method:'POST',body:{...shopBody,imageDataUrl:dataUrl(png)},status:401});
  const first=(await call('/api/profile',{method:'PATCH',cookie:a.cookie,body:{bio:'A avatar',userId:b.data.user.id,imageDataUrl:dataUrl(png)}})).data.user;
  await imageCheck(first.avatarUrl,png);
  assert.equal((await call('/api/state',{cookie:b.cookie})).data.user.avatarUrl,null);
  assert.equal((await call('/api/profile',{method:'PATCH',cookie:a.cookie,body:{bio:'Edited bio'}})).data.user.avatarUrl,first.avatarUrl);
  const login=await call('/api/auth',{method:'POST',body:{mode:'login',gameId:a.data.user.gameId,password:'local-avatar-check'}});cookies.push(login.cookie);
  assert.equal(login.data.user.avatarUrl,first.avatarUrl);
  await call('/api/profile',{method:'PATCH',cookie:a.cookie,body:{bio:'Must not change',imageDataUrl:'https://example.test/image.png'},status:400});
  assert.equal((await call('/api/state',{cookie:a.cookie})).data.user.bio,'Edited bio');
  await call('/api/profile',{method:'PATCH',cookie:a.cookie,body:{bio:'',imageDataUrl:dataUrl(png)},origin:'https://elsewhere.test',status:403});
  const song=(await call('/api/songs',{method:'POST',cookie:a.cookie,status:201,body:{title:`Avatar track ${stamp}`,artist:'QA',price:1,customPrice:false,bars:16,genre:'摇滚',description:'',shopIds:[]}})).data;songs.push({id:song.id,cookie:a.cookie});
  assert.equal((await call('/api/state')).data.artists.find(v=>v.id===a.data.user.id).avatarUrl,first.avatarUrl);
  const replacement=(await call('/api/profile',{method:'PATCH',cookie:a.cookie,body:{bio:'New avatar',imageDataUrl:dataUrl(webp,'webp')}})).data.user;
  await imageCheck(replacement.avatarUrl,webp);await call(first.avatarUrl,{status:404});
  await call('/api/profile',{method:'PATCH',cookie:a.cookie,body:{bio:'Removed avatar',imageDataUrl:null}});
  await call(replacement.avatarUrl,{status:404});
  assert.equal((await call('/api/state')).data.artists.find(v=>v.id===a.data.user.id).avatarUrl,null);
  const s=(await call('/api/shops',{method:'POST',cookie:a.cookie,status:201,body:{...shopBody,ownerId:b.data.user.id,imageDataUrl:dataUrl(png)}})).data;shops.push({id:s.id,cookie:a.cookie});
  assert.equal(s.ownerId,a.data.user.id);await imageCheck(s.imageUrl,png);
  assert.equal((await call('/api/state')).data.shops.find(v=>v.id===s.id).imageUrl,s.imageUrl);
  await call(`/api/shops/${s.id}`,{method:'PATCH',cookie:b.cookie,body:{...shopBody,imageDataUrl:null},status:403});
  await call(`/api/shops/${s.id}`,{method:'DELETE',cookie:b.cookie,status:403});
  const preserved=(await call(`/api/shops/${s.id}`,{method:'PATCH',cookie:a.cookie,body:{...shopBody,port:'新港'}})).data;
  assert.equal(preserved.imageUrl,s.imageUrl);
  const other=(await call('/api/shops',{method:'POST',cookie:b.cookie,status:201,body:{...shopBody,name:`Other shop ${stamp}`}})).data;shops.push({id:other.id,cookie:b.cookie});
  assert.equal(other.imageUrl,null);
  await call(`/api/shops/${s.id}`,{method:'PATCH',cookie:a.cookie,body:{...shopBody,name:other.name,imageDataUrl:dataUrl(webp,'webp')},status:409});
  const unchanged=(await call('/api/state')).data.shops.find(v=>v.id===s.id);
  assert.equal(unchanged.imageUrl,s.imageUrl);assert.equal(unchanged.name,s.name);assert.equal(unchanged.port,'新港');await imageCheck(s.imageUrl,png);
  await call('/api/shops',{method:'POST',cookie:a.cookie,status:409,body:{...shopBody,imageDataUrl:dataUrl(webp,'webp')}});
  sql(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${q(adminHash)},'system-admin',${Date.now()+600000})`);
  adminProfile=(await call('/api/state',{cookie:adminCookie})).data.user;
  if(!adminProfile.avatarUrl){
    const avatar=(await call('/api/profile',{method:'PATCH',cookie:adminCookie,body:{bio:adminProfile.bio,imageDataUrl:dataUrl(png)}})).data.user;changedAdmin=true;
    await imageCheck(avatar.avatarUrl,png);assert.equal(avatar.role,'admin');
  }
  const adminEdit=(await call(`/api/shops/${s.id}`,{method:'PATCH',cookie:adminCookie,body:{...shopBody,imageDataUrl:dataUrl(webp,'webp')}})).data;
  assert.equal(adminEdit.ownerId,a.data.user.id);await imageCheck(adminEdit.imageUrl,webp);await call(s.imageUrl,{status:404});
  await call(`/api/shops/${s.id}`,{method:'PATCH',cookie:a.cookie,body:{...shopBody,imageDataUrl:null}});
  await call(adminEdit.imageUrl,{status:404});
  const races=await Promise.all([0,1,2].map(()=>call(`/api/shops/${s.id}`,{method:'PATCH',cookie:a.cookie,body:{...shopBody,imageDataUrl:dataUrl(png)}})));
  const live=(await call('/api/state')).data.shops.find(v=>v.id===s.id).imageUrl;
  for(const result of races){const r=await fetch(base+result.data.imageUrl);assert.equal(r.status,result.data.imageUrl===live?200:404);checks++;}
  const profileRaces=await Promise.all([0,1,2].map(i=>call('/api/profile',{method:'PATCH',cookie:a.cookie,body:{bio:`Race ${i}`,imageDataUrl:dataUrl(webp,'webp')}})));
  const liveAvatar=(await call('/api/state',{cookie:a.cookie})).data.user.avatarUrl;
  for(const result of profileRaces){const r=await fetch(base+result.data.user.avatarUrl);assert.equal(r.status,result.data.user.avatarUrl===liveAvatar?200:404);checks++;}
  await call(`/api/shops/${s.id}`,{method:'DELETE',cookie:adminCookie});await call(live,{status:404});
  console.log(`PASS: ${checks} HTTP checks; avatar persistence/login/artist propagation, shop ownership, admin images, conflict atomicity, concurrent replacement and image removal.`);
} finally {
  if(changedAdmin)await call('/api/profile',{method:'PATCH',cookie:adminCookie,body:{bio:adminProfile.bio,imageDataUrl:null}});
  for(const u of users){const cookie=cookies.find((_,i)=>i===users.indexOf(u));if(cookie)await call('/api/profile',{method:'PATCH',cookie,body:{bio:'',imageDataUrl:null}});}
  for(const item of [...songs.map(v=>({...v,kind:'songs'})),...shops.map(v=>({...v,kind:'shops'}))]){const r=await fetch(`${base}/api/${item.kind}/${item.id}`,{method:'DELETE',headers:{Origin:base,Cookie:item.cookie}});assert.ok([200,404].includes(r.status));}
  const statements=[`DELETE FROM sessions WHERE token_hash=${q(adminHash)}`,...users.flatMap(id=>[`DELETE FROM sessions WHERE user_id=${q(id)}`,`DELETE FROM entity_images WHERE entity_type='profile' AND entity_id=${q(id)}`,`DELETE FROM profiles WHERE user_id=${q(id)}`,`DELETE FROM users WHERE id=${q(id)}`])];
  sql(statements.join(';'));
  console.log('Cleaned only this run’s local test records and restored the administrator profile.');
}
