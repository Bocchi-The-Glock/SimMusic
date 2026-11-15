// Local regression checks for batched state/auth and concurrent image replacement.
import assert from 'node:assert/strict';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
const base=process.argv[2]||'http://127.0.0.1:5173';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
assert.ok(process.env.SIMLIVE_ADMIN_TEST_PASSWORD,'Set SIMLIVE_ADMIN_TEST_PASSWORD');
const stamp=Date.now().toString(36),users=[],cookies=[],sessionHashes=[],houses=[];
let count=0;
const q=value=>`'${String(value).replaceAll("'","''")}'`;
function sql(statement){const r=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',statement],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr||r.stdout);}
async function call(path,{method='GET',body,cookie='',status=200}={}){
  const r=await fetch(base+path,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await r.json();assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(data)}`);count++;
  return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
}
async function register(label){const user=await call('/api/auth',{method:'POST',status:201,body:{mode:'register',gameId:`qa_perf_${label}_${stamp}`,password:'test-performance-123',confirmPassword:'test-performance-123'}});users.push(user.data.user.id);cookies.push(user.cookie);return user;}
function extraSession(userId,expiry){const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');sessionHashes.push(hash);sql(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${q(hash)},${q(userId)},${expiry})`);return `simlive_session=${token}`;}
try {
  const a=await register('a'),b=await register('b');
  const admin=await call('/api/auth',{method:'POST',body:{mode:'login',gameId:'Bocchi_TheGlock',password:process.env.SIMLIVE_ADMIN_TEST_PASSWORD}});cookies.push(admin.cookie);
  await call('/api/profile',{method:'PATCH',cookie:a.cookie,body:{bio:'Performance bio A'}});
  await call('/api/profile',{method:'PATCH',cookie:b.cookie,body:{bio:'Performance bio B'}});
  const [sa,sb,sc,sg]=await Promise.all([a.cookie,b.cookie,admin.cookie,''].map(cookie=>call('/api/state',{cookie})));
  assert.equal(sa.data.user.id,a.data.user.id);assert.equal(sa.data.user.bio,'Performance bio A');assert.equal(sa.data.user.role,'user');
  assert.equal(sb.data.user.id,b.data.user.id);assert.equal(sb.data.user.bio,'Performance bio B');
  assert.equal(sc.data.user.gameId,'Bocchi_TheGlock');assert.equal(sc.data.user.role,'admin');assert.equal(sg.data.user,null);
  for(const cookie of [extraSession(a.data.user.id,Date.now()-1000),extraSession(randomUUID(),Date.now()+60000),'simlive_session=invalid']) {
    assert.equal((await call('/api/state',{cookie})).data.user,null);
    await call('/api/profile',{method:'PATCH',cookie,body:{bio:'must fail'},status:401});
  }
  const house=(await call('/api/livehouses',{method:'POST',cookie:a.cookie,status:201,body:{name:`Performance ${stamp}`,x:1,y:64,z:2,port:'测试港'}})).data;
  houses.push({id:house.id,cookie:a.cookie});
  const show={livehouseId:house.id,date:'2026-11-14',hour:20,title:'Performance test',playerId:'Guest'};
  assert.equal((await call('/api/events',{method:'POST',body:show,status:201})).data.canDelete,false);
  assert.equal((await call('/api/events',{method:'POST',cookie:a.cookie,body:show,status:201})).data.canDelete,true);
  const pixels=await sharp({create:{width:16,height:16,channels:3,background:'#689adc'}}).webp().toBuffer();
  const imageDataUrl=`data:image/webp;base64,${pixels.toString('base64')}`;
  const replacements=await Promise.all([0,1,2].map(()=>call(`/api/livehouses/${house.id}/image`,{method:'PATCH',cookie:a.cookie,body:{imageDataUrl}})));
  const live=(await call('/api/state')).data.livehouses.find(item=>item.id===house.id).imageUrl;
  for(const {data} of replacements) {
    const r=await fetch(base+data.imageUrl);assert.equal(r.status,data.imageUrl===live?200:404);count++;
  }
  const raced=await Promise.all([
    fetch(`${base}/api/livehouses/${house.id}/image`,{method:'PATCH',headers:{Origin:base,Cookie:a.cookie,'Content-Type':'application/json'},body:JSON.stringify({imageDataUrl})}),
    fetch(`${base}/api/livehouses/${house.id}`,{method:'DELETE',headers:{Origin:base,Cookie:a.cookie}}),
  ]);
  assert.ok([200,404].includes(raced[0].status));assert.equal(raced[1].status,200);count+=2;
  assert.ok(!(await call('/api/state')).data.livehouses.some(item=>item.id===house.id));
  if(raced[0].status===200){const uploaded=(await raced[0].json()).imageUrl;assert.equal((await fetch(base+uploaded)).status,404);count++;}
  console.log(`PASS: ${count} HTTP checks; joined identity, cross-user isolation, expired/missing sessions, event permissions, concurrent replacement/deletion.`);
} finally {
  for(const h of houses)await fetch(`${base}/api/livehouses/${h.id}`,{method:'DELETE',headers:{Origin:base,Cookie:h.cookie}});
  for(const cookie of cookies)await call('/api/auth',{method:'POST',cookie,body:{mode:'logout'}});
  const statements=[...sessionHashes.map(h=>`DELETE FROM sessions WHERE token_hash=${q(h)}`),...users.flatMap(id=>[`DELETE FROM sessions WHERE user_id=${q(id)}`,`DELETE FROM profiles WHERE user_id=${q(id)}`,`DELETE FROM users WHERE id=${q(id)}`])];
  if(statements.length)sql(statements.join(';'));
  console.log('Cleaned exact test entities, profiles and sessions.');
}
