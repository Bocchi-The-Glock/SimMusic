// Local preview verification only. Run with SIMLIVE_ADMIN_TEST_PASSWORD set.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base = process.argv[2] || 'http://127.0.0.1:5173';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname), 'This check only runs on a local preview');
const adminPassword=process.env.SIMLIVE_ADMIN_TEST_PASSWORD;
assert.ok(adminPassword,'Set SIMLIVE_ADMIN_TEST_PASSWORD before running this check');
const stamp=Date.now().toString(36);
let checked=0;
const created={users:[],livehouses:[],events:[],shops:[],songs:[],sessions:[]};
async function call(path, {method='GET',body,cookie='',status=200}={}) {
  if (body?.mode==='register') body={...body,confirmPassword:body.password};
  const response=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),Origin:base},body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data)}`); checked++;
  if(response.ok&&method==='POST') {
    if(path==='/api/auth'&&body?.mode==='register')created.users.push(data.user.id);
    const kind=path.slice('/api/'.length);
    if(['livehouses','events','shops','songs'].includes(kind)&&data.id)created[kind].push(data.id);
    const token=response.headers.get('set-cookie')?.match(/simlive_session=([a-f0-9]{64})/)?.[1];
    if(token)created.sessions.push(createHash('sha256').update(token).digest('hex'));
  }
  return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
}
try {
const initial=(await call('/api/state')).data;
assert.equal(initial.user,null); assert.equal(initial.livehouses.find(h=>h.id==='starry').protected,true);
assert.ok(initial.genres.includes('摇滚') && initial.genres.includes('古典'));
await call('/api/livehouses',{method:'POST',body:{name:'guest'},status:401});
await call('/api/songs',{method:'POST',body:{},status:401});
await call('/api/auth',{method:'POST',body:{mode:'register',gameId:'bocchi_theglock',password:'reserved-account'},status:409});
const a=await call('/api/auth',{method:'POST',body:{mode:'register',gameId:`verify_a_${stamp}`,password:'local-verify-123',role:'admin'},status:201});
const b=await call('/api/auth',{method:'POST',body:{mode:'register',gameId:`verify_b_${stamp}`,password:'local-verify-456'},status:201});
assert.equal(a.data.user.role,'user');
await call('/api/genres',{method:'POST',cookie:a.cookie,body:{name:'Forbidden'},status:403});
await call('/api/auth',{method:'POST',body:{mode:'login',gameId:`verify_a_${stamp}`,password:'wrong-password'},status:401});
const admin=await call('/api/auth',{method:'POST',body:{mode:'login',gameId:'Bocchi_TheGlock',password:adminPassword}});
assert.equal(admin.data.user.role,'admin');
await call('/api/livehouses/starry',{method:'DELETE',cookie:admin.cookie,status:403});
await call('/api/livehouses/starry',{method:'DELETE',cookie:a.cookie,status:403});
const house=(await call('/api/livehouses',{method:'POST',cookie:a.cookie,body:{name:`QA ${stamp}`,x:-50,y:64,z:80,port:'验证港',owner:'Bocchi_TheGlock'},status:201})).data;
assert.equal(house.owner,a.data.user.gameId);
await call(`/api/livehouses/${house.id}`,{method:'DELETE',cookie:b.cookie,status:403});
await call('/api/events',{method:'POST',body:{livehouseId:house.id,date:'2026-02-30',hour:20,playerId:'Guest',title:'bad date'},status:400});
await call('/api/events',{method:'POST',body:{livehouseId:house.id,date:'2026-11-14',hour:20.5,playerId:'Guest',title:'bad hour'},status:400});
const eventBody={livehouseId:house.id,date:'2026-11-14',hour:20,playerId:'Guest',title:'first'};
const first=(await call('/api/events',{method:'POST',body:eventBody,status:201})).data;
const second=(await call('/api/events',{method:'POST',cookie:a.cookie,body:{...eventBody,title:'second',playerId:'Spoofed'},status:201})).data;
assert.equal(second.playerId,a.data.user.gameId);
await call('/api/events',{method:'POST',body:{...eventBody,hour:19,title:'earlier'},status:201});
await call(`/api/events/${first.id}`,{method:'DELETE',cookie:b.cookie,status:403});
const shop1=(await call('/api/shops',{method:'POST',cookie:a.cookie,body:{name:`Shop 1 ${stamp}`,x:1,y:2,z:3,port:'港口'},status:201})).data;
const shop2=(await call('/api/shops',{method:'POST',cookie:b.cookie,body:{name:`Shop 2 ${stamp}`,x:4,y:5,z:6,port:'港口'},status:201})).data;
const songBody={title:`Song ${stamp}`,artist:'Artist',price:100,customPrice:false,bars:32,genre:'摇滚',description:'Persistent song',shopIds:[shop1.id,shop2.id]};
await call('/api/songs',{method:'POST',cookie:a.cookie,body:{...songBody,genre:'Arbitrary type'},status:400});
await call('/api/songs',{method:'POST',cookie:a.cookie,body:{...songBody,price:0},status:400});
const song=(await call('/api/songs',{method:'POST',cookie:a.cookie,body:songBody,status:201})).data;
const custom=(await call('/api/songs',{method:'POST',cookie:a.cookie,body:{...songBody,customPrice:true,price:null,shopIds:[]},status:201})).data;
assert.equal(custom.price,null); assert.deepEqual(custom.shopIds,[]);
await call(`/api/songs/${song.id}`,{method:'DELETE',cookie:b.cookie,status:403});
const saved=(await call('/api/state',{cookie:a.cookie})).data;
assert.equal(saved.user.gameId,a.data.user.gameId);
assert.deepEqual(saved.events.filter(e=>e.livehouseId===house.id).map(e=>e.title),['earlier','first','second']);
assert.deepEqual(new Set(saved.songs.find(s=>s.id===song.id).shopIds),new Set([shop1.id,shop2.id]));
await call(`/api/songs/${song.id}`,{method:'DELETE',cookie:a.cookie});
await call(`/api/songs/${custom.id}`,{method:'DELETE',cookie:admin.cookie});
await call(`/api/livehouses/${house.id}`,{method:'DELETE',cookie:a.cookie});
assert.ok(!(await call('/api/state')).data.events.some(e=>e.livehouseId===house.id));
await call('/api/auth',{method:'POST',cookie:a.cookie,body:{mode:'logout'}});
assert.equal((await call('/api/state',{cookie:a.cookie})).data.user,null);
console.log(`PASS: ${checked} API requests; authentication, ownership, permanent venue, date/hour validation, ordering, price validation, and many-to-many stores verified.`);
} finally {
  const q=value=>`'${String(value).replaceAll("'","''")}'`;
  const statements=[
    ...created.songs.map(id=>`DELETE FROM song_shops WHERE song_id=${q(id)}`),
    ...created.shops.map(id=>`DELETE FROM song_shops WHERE shop_id=${q(id)}`),
    ...['songs','events','livehouses','shops'].flatMap(table=>created[table].map(id=>`DELETE FROM ${table} WHERE id=${q(id)}`)),
    ...created.sessions.map(hash=>`DELETE FROM sessions WHERE token_hash=${q(hash)}`),
    ...created.users.flatMap(id=>[`DELETE FROM sessions WHERE user_id=${q(id)}`,`DELETE FROM profiles WHERE user_id=${q(id)}`,`DELETE FROM users WHERE id=${q(id)}`]),
  ];
  if(statements.length){const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',statements.join(';')],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr||result.stdout);}
  console.log('Cleaned only this run’s local records and sessions.');
}
