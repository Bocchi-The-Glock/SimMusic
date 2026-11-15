// Local-only end-to-end cover tests. Uses the image encoder bundled with Wrangler.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
const base = process.argv[2] || 'http://127.0.0.1:5173';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
assert.ok(process.env.SIMLIVE_ADMIN_TEST_PASSWORD, 'Set SIMLIVE_ADMIN_TEST_PASSWORD');
const stamp = Date.now().toString(36), users = [], cookies = [], created = [];
let checks = 0, admin, originalStarry, changedStarry = false;
const image = sharp({create:{width:48,height:32,channels:3,background:'#568ac9'}});
const png = await image.clone().png().toBuffer(), webp = await image.clone().webp().toBuffer(), jpeg = await image.clone().jpeg().toBuffer();
const dataUrl = (buffer, type='png') => `data:image/${type};base64,${buffer.toString('base64')}`;
const crcTable = Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function paddedPng(length){const extra=Buffer.alloc(length-png.length);extra.writeUInt32BE(extra.length-12,0);extra.write('tEXt',4);extra.writeUInt32BE(crc32(extra.subarray(4,-4)),extra.length-4);return Buffer.concat([png.subarray(0,-12),extra,png.subarray(-12)]);}
async function call(path,{method='GET',body,cookie='',status=200,origin=base}={}) {
  const response=await fetch(base+path,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data={error:raw};}
  assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data)}`);checks++;
  return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
}
async function cover(url, expected, type) {
  const r=await fetch(base+url);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),`image/${type}`);
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()),expected);checks++;
}
async function register(label) {
  const r=await call('/api/auth',{method:'POST',status:201,body:{mode:'register',gameId:`qa_image_${label}_${stamp}`,password:'local-image-test',confirmPassword:'local-image-test'}});
  users.push(r.data.user.id);cookies.push(r.cookie);return r;
}
const venueBody={name:`Image house ${stamp}`,x:1,y:64,z:2,port:'图片测试港'};
const songBody={title:`Image song ${stamp}`,artist:'QA',price:30,customPrice:false,bars:32,genre:'摇滚',description:'',shopIds:[]};
try {
  const a=await register('a'), b=await register('b');
  admin=await call('/api/auth',{method:'POST',body:{mode:'login',gameId:'Bocchi_TheGlock',password:process.env.SIMLIVE_ADMIN_TEST_PASSWORD}});cookies.push(admin.cookie);
  originalStarry=(await call('/api/state')).data.livehouses.find(h=>h.id==='starry').imageUrl;
  if(originalStarry){const r=await fetch(base+originalStarry);originalStarry=`data:${r.headers.get('content-type')};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;}
  await call('/api/livehouses',{method:'POST',body:{...venueBody,imageDataUrl:dataUrl(png)},status:401});
  for(const value of ['https://elsewhere.test/image.png','data:image/svg+xml;base64,PHN2Zy8+',dataUrl(Buffer.from('not a PNG')),dataUrl(png,'jpeg'),dataUrl(paddedPng(100001))]) {
    const status=value.length>133000?413:400;
    await call('/api/livehouses',{method:'POST',cookie:a.cookie,body:{...venueBody,imageDataUrl:value},status});
  }
  const corrupt=Buffer.from(png);corrupt[33]^=1;
  await call('/api/livehouses',{method:'POST',cookie:a.cookie,body:{...venueBody,imageDataUrl:dataUrl(corrupt)},status:400});
  await call('/api/livehouses',{method:'POST',cookie:a.cookie,body:{...venueBody,imageDataUrl:'x'.repeat(160001)},status:413});
  assert.ok(!(await call('/api/state')).data.livehouses.some(h=>h.name===venueBody.name));
  const house=(await call('/api/livehouses',{method:'POST',cookie:a.cookie,body:{...venueBody,imageDataUrl:dataUrl(png)},status:201})).data;created.push({kind:'livehouses',id:house.id,cookie:a.cookie});
  await cover(house.imageUrl,png,'png');
  const song=(await call('/api/songs',{method:'POST',cookie:a.cookie,body:{...songBody,imageDataUrl:dataUrl(jpeg,'jpeg')},status:201})).data;created.push({kind:'songs',id:song.id,cookie:a.cookie});
  await cover(song.imageUrl,jpeg,'jpeg');
  let state=(await call('/api/state')).data;
  assert.equal(state.livehouses.find(h=>h.id===house.id).imageUrl,house.imageUrl);
  assert.equal(state.songs.find(s=>s.id===song.id).imageUrl,song.imageUrl);
  for(const [kind,id] of [['livehouses',house.id],['songs',song.id],['livehouses','starry']]) {
    await call(`/api/${kind}/${id}/image`,{method:'PATCH',body:{imageDataUrl:null},status:401});
    await call(`/api/${kind}/${id}/image`,{method:'PATCH',cookie:b.cookie,body:{imageDataUrl:dataUrl(webp,'webp')},status:403});
  }
  await call(`/api/livehouses/${house.id}/image`,{method:'PATCH',cookie:a.cookie,body:{},status:400});
  await call(`/api/livehouses/${house.id}/image`,{method:'PATCH',cookie:a.cookie,body:{imageDataUrl:dataUrl(webp,'webp')},origin:'https://unrelated.test',status:403});
  let next=(await call(`/api/livehouses/${house.id}/image`,{method:'PATCH',cookie:a.cookie,body:{imageDataUrl:dataUrl(webp,'webp')}})).data;
  await cover(next.imageUrl,webp,'webp');await call(house.imageUrl,{status:404});
  const atLimit=paddedPng(100000);
  next=(await call(`/api/songs/${song.id}/image`,{method:'PATCH',cookie:admin.cookie,body:{imageDataUrl:dataUrl(atLimit)}})).data;
  await cover(next.imageUrl,atLimit,'png');await call(song.imageUrl,{status:404});
  await call(`/api/songs/${song.id}/image`,{method:'PATCH',cookie:a.cookie,body:{imageDataUrl:dataUrl(paddedPng(100001))},status:413});
  assert.equal((await call('/api/state')).data.songs.find(s=>s.id===song.id).imageUrl,next.imageUrl);
  await call(`/api/songs/${song.id}/image`,{method:'PATCH',cookie:a.cookie,body:{imageDataUrl:null}});
  await call(next.imageUrl,{status:404});
  assert.equal((await call('/api/state')).data.songs.find(s=>s.id===song.id).imageUrl,null);
  next=(await call('/api/livehouses/starry/image',{method:'PATCH',cookie:admin.cookie,body:{imageDataUrl:dataUrl(webp,'webp')}})).data;changedStarry=true;
  await cover(next.imageUrl,webp,'webp');
  await call('/api/livehouses/starry',{method:'DELETE',cookie:admin.cookie,status:403});
  const houseUrl=(await call('/api/state')).data.livehouses.find(h=>h.id===house.id).imageUrl;
  await call(`/api/livehouses/${house.id}`,{method:'DELETE',cookie:a.cookie});
  await call(houseUrl,{status:404});
  await call(`/api/livehouses/${house.id}/image`,{method:'PATCH',cookie:a.cookie,body:{imageDataUrl:dataUrl(png)},status:404});
  console.log(`PASS: ${checks} HTTP checks; cover formats, exact 100 KB limit, ownership, Starry protection, replacement/removal, image serving and failed-create atomicity.`);
} finally {
  if(admin&&changedStarry)await call('/api/livehouses/starry/image',{method:'PATCH',cookie:admin.cookie,body:{imageDataUrl:originalStarry||null}});
  for(const item of created){const response=await fetch(`${base}/api/${item.kind}/${item.id}`,{method:'DELETE',headers:{Cookie:item.cookie,Origin:base}});assert.ok([200,404].includes(response.status));}
  for(const cookie of cookies)await call('/api/auth',{method:'POST',cookie,body:{mode:'logout'}});
  const quote=value=>`'${value.replaceAll("'","''")}'`;
  const sql=users.flatMap(id=>[`DELETE FROM sessions WHERE user_id=${quote(id)}`,`DELETE FROM profiles WHERE user_id=${quote(id)}`,`DELETE FROM users WHERE id=${quote(id)}`]).join(';');
  if(sql){const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',sql],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr||result.stdout);}
  console.log('Restored original Starry image and cleaned this run’s local records.');
}
