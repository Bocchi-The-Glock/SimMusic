import { STARRY } from '@/lib/server/constants';
import { body, currentUser, db, endpoint, getLivehouse, json, rateLimit } from '@/lib/server/core';
import { calendarDate, gameId, HttpError, integer, requiredText } from '@/lib/server/validation';
export async function POST(request: Request) { return endpoint(async () => {
  const data=await body(request), user=await currentUser(request);
  await rateLimit(request,'events',120,60*60*1000);
  const livehouseId=requiredText(data.livehouseId,'演出场地',80), date=calendarDate(data.date), hour=integer(data.hour,'演出小时',0,23), title=requiredText(data.title,'节目名',120);
  const playerId=user?.gameId ?? gameId(data.playerId), createdAt=Date.now();
  if (!await getLivehouse(livehouseId)) throw new HttpError(404,'这个 演出场地 已不存在');
  // The SELECT guards against another request deleting a custom venue after validation.
  const result=await db().prepare('INSERT INTO events (livehouse_id,date,hour,player_id,creator_id,title,created_at) SELECT ?,?,?,?,?,?,? WHERE (? = ? OR EXISTS (SELECT 1 FROM livehouses WHERE id = ?)) AND NOT EXISTS(SELECT 1 FROM activities WHERE livehouse_id=? AND date=?) RETURNING id').bind(livehouseId,date,hour,playerId,user?.id??null,title,createdAt,livehouseId,STARRY.id,livehouseId,livehouseId,date).first<{id:number}>();
  if (!result) throw new HttpError(409,'该日期已有活动，或 演出场地 已不存在');
  return json({id:String(result.id),livehouseId,date,hour,playerId,title,createdAt,canDelete:!!user},201);
}); }
