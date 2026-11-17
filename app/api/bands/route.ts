import { body, db, endpoint, json, rateLimit, requireUser } from '@/lib/server/core';
import { ensurePlayer } from '@/lib/server/players';
import { communityState, memberIds } from '@/lib/server/community';
import { HttpError, requiredText } from '@/lib/server/validation';
export async function POST(request:Request){return endpoint(async()=>{
 const user=await requireUser(request),data=await body(request);
 await rateLimit(request,'bands',30,3600000);
 const name=requiredText(data.name,'乐队名字',80);
 if(await db().prepare('SELECT id FROM bands WHERE captain_id=?').bind(user.id).first())throw new HttpError(409,'每人只能创建一个乐队');
 await ensurePlayer(user.gameId);const ids=await memberIds(data.memberGameIds??[],user.id),id=crypto.randomUUID();
 const results=await db().batch([
  db().prepare('INSERT INTO bands(id,name,captain_id,created_at) VALUES (?,?,?,?) ON CONFLICT(captain_id) DO NOTHING').bind(id,name,user.id,Date.now()),
  ...ids.map(playerId=>db().prepare('INSERT INTO band_members(band_id,player_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM bands WHERE id=?)').bind(id,playerId,id)),
 ]);
 if(!results[0].meta.changes)throw new HttpError(409,'每人只能创建一个乐队');
 return json((await communityState(user)).bands.find(b=>b.id===id),201);
});}
