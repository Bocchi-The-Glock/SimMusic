import { body, checkMutationOrigin, db, endpoint, json, requireUser, type User } from '@/lib/server/core';
import { communityState } from '@/lib/server/community';
import { playerKey } from '@/lib/server/players';
import { HttpError, requiredText } from '@/lib/server/validation';
function permission(user:User, deleting=false) {
 const sql=`(?=1 OR (kind='individual' AND lower(player_id)=?) OR (kind='band' AND EXISTS(SELECT 1 FROM bands b WHERE b.id=activity_signups.band_id AND (b.captain_id=? OR EXISTS(SELECT 1 FROM band_members m WHERE m.band_id=b.id AND m.player_id=?))))${deleting?' OR creator_id=? OR EXISTS(SELECT 1 FROM activities a WHERE a.id=activity_signups.activity_id AND a.owner_id=?)':''})`;
 return {sql,args:[user.role==='admin'?1:0,playerKey(user.gameId),user.id,user.id,...(deleting?[user.id,user.id]:[])]};
}
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{
 const user=await requireUser(request),data=await body(request),{id}=await context.params;
 const row=await db().prepare('SELECT activity_id FROM activity_signups WHERE id=?').bind(id).first<{activity_id:string}>();
 if(!row)throw new HttpError(404,'节目已不存在');
 if(data.move!==undefined){
  if(user.role!=='admin')throw new HttpError(403,'只有管理员可以调整节目顺序');
  if(data.move!=='up'&&data.move!=='down')throw new HttpError(400,'请选择上移或下移');
  const delta=data.move==='up'?-1:1;
  await db().prepare(`WITH ranked AS MATERIALIZED (SELECT id,ROW_NUMBER() OVER(ORDER BY COALESCE(sort_order,id),id) AS n FROM activity_signups WHERE activity_id=?), target AS (SELECT n FROM ranked WHERE id=?)
   UPDATE activity_signups SET sort_order=(SELECT CASE WHEN ranked.n=(SELECT n FROM target) THEN CASE WHEN EXISTS(SELECT 1 FROM ranked r WHERE r.n=(SELECT n FROM target)+?) THEN ranked.n+? ELSE ranked.n END WHEN ranked.n=(SELECT n FROM target)+? THEN ranked.n-? ELSE ranked.n END FROM ranked WHERE ranked.id=activity_signups.id) WHERE activity_id=?`).bind(row.activity_id,id,delta,delta,delta,delta,row.activity_id).run();
 }else{
  const name=requiredText(data.programName,'节目名称',120),auth=permission(user);
  const result=await db().prepare(`UPDATE activity_signups SET program_name=? WHERE id=? AND ${auth.sql}`).bind(name,id,...auth.args).run();
  if(!result.meta.changes)throw new HttpError(403,'只能编辑自己或所属乐队的节目');
 }
 return json({activitySignups:(await communityState(user)).activitySignups.filter(s=>s.activityId===row.activity_id)});
});}
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{
 checkMutationOrigin(request);const user=await requireUser(request),{id}=await context.params,auth=permission(user,true);
 if(!await db().prepare('SELECT 1 FROM activity_signups WHERE id=?').bind(id).first())throw new HttpError(404,'节目已不存在');
 const result=await db().prepare(`DELETE FROM activity_signups WHERE id=? AND ${auth.sql}`).bind(id,...auth.args).run();
 if(!result.meta.changes)throw new HttpError(403,'不能删除其他人的节目');
 return json({ok:true});
});}
