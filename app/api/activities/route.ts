import { body, db, endpoint, json, rateLimit, requireUser } from '@/lib/server/core';
import { ensurePlayer } from '@/lib/server/players';
import { communityState, description, nullableVenue, requireVenueManager } from '@/lib/server/community';
import { calendarDate, HttpError, requiredText } from '@/lib/server/validation';
import { STARRY } from '@/lib/server/constants';
export async function POST(request:Request){return endpoint(async()=>{
 const user=await requireUser(request),data=await body(request);
 await rateLimit(request,'activities',60,3600000);
 const name=requiredText(data.name,'活动名字',100),date=calendarDate(data.date),intro=description(data.description),location=requiredText(data.location,'活动地点',200),livehouseId=nullableVenue(data.livehouseId);
 await requireVenueManager(user,livehouseId);
 await ensurePlayer(user.gameId);const id=crypto.randomUUID();
 const result=await db().prepare(`INSERT INTO activities(id,name,date,description,location,owner_id,livehouse_id,created_at)
 SELECT ?,?,?,?,?,?,?,? WHERE ? IS NULL OR (?=? AND ?=1)
 OR EXISTS(SELECT 1 FROM livehouses WHERE id=? AND (owner_id=? OR ?=1))
 ON CONFLICT DO NOTHING RETURNING id`).bind(id,name,date,intro,location,user.id,livehouseId,Date.now(),livehouseId,livehouseId,STARRY.id,user.role==='admin'?1:0,livehouseId,user.id,user.role==='admin'?1:0).first();
 if(!result)throw new HttpError(409,'该场地当天已有活动，或场地权限已变化');
 return json((await communityState(user)).activities.find(a=>a.id===id),201);
});}
