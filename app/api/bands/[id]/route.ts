import { body, db, endpoint, json, requireUser } from '@/lib/server/core';
import { canManage, communityState, getBand, memberIds } from '@/lib/server/community';
import { HttpError, requiredText } from '@/lib/server/validation';
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{
 const user=await requireUser(request),data=await body(request),{id}=await context.params,band=await getBand(id);
 if(!band)throw new HttpError(404,'乐队已不存在');
 if(!canManage(user,band.captain_id))throw new HttpError(403,'只有队长或管理员可以编辑乐队');
 const name=data.name===undefined?band.name:requiredText(data.name,'乐队名字',80);
 const ids=data.memberGameIds===undefined?null:await memberIds(data.memberGameIds,band.captain_id);
 await db().batch([db().prepare('UPDATE bands SET name=? WHERE id=?').bind(name,id),...(ids===null?[]:[db().prepare('DELETE FROM band_members WHERE band_id=?').bind(id),...ids.map(playerId=>db().prepare('INSERT INTO band_members(band_id,player_id) VALUES (?,?)').bind(id,playerId))])]);
 return json((await communityState(user)).bands.find(b=>b.id===id));
});}
