import { body, checkMutationOrigin, db, endpoint, getLivehouse, json, requireUser } from '@/lib/server/core';
import { canManage, communityState, description, getActivity, nullableVenue } from '@/lib/server/community';
import { calendarDate, HttpError, requiredText } from '@/lib/server/validation';
import { STARRY } from '@/lib/server/constants';
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{
 const user=await requireUser(request),data=await body(request),{id}=await context.params,activity=await getActivity(id);
 if(!activity)throw new HttpError(404,'活动已不存在');
 if(!canManage(user,activity.owner_id))throw new HttpError(403,'只有创建者或管理员可以编辑活动');
 const livehouseId=data.livehouseId===undefined?activity.livehouse_id:nullableVenue(data.livehouseId),date=data.date===undefined?activity.date:calendarDate(data.date);
 if(user.role!=='admin'&&(livehouseId!==activity.livehouse_id||(activity.livehouse_id&&date!==activity.date)))throw new HttpError(403,'只有管理员可以安排 Livehouse 活动日期');
 if(livehouseId&&!await getLivehouse(livehouseId))throw new HttpError(404,'Livehouse 已不存在');
 const name=data.name===undefined?activity.name:requiredText(data.name,'活动名字',100),intro=data.description===undefined?activity.description:description(data.description),location=data.location===undefined?activity.location:requiredText(data.location,'活动地点',200);
 const result=await db().prepare('UPDATE OR IGNORE activities SET name=?,date=?,description=?,location=?,livehouse_id=? WHERE id=? AND date=? AND livehouse_id IS ? AND (? IS NULL OR ?=? OR EXISTS(SELECT 1 FROM livehouses WHERE id=?)) RETURNING id').bind(name,date,intro,location,livehouseId,id,activity.date,activity.livehouse_id,livehouseId,livehouseId,STARRY.id,livehouseId).first();
 if(!result)throw new HttpError(409,'活动安排已变化或该日期已有活动，请刷新后重试');
 return json((await communityState(user)).activities.find(a=>a.id===id));
});}
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{
 checkMutationOrigin(request);const user=await requireUser(request),{id}=await context.params,activity=await getActivity(id);
 if(!activity)throw new HttpError(404,'活动已不存在');
 if(!canManage(user,activity.owner_id))throw new HttpError(403,'只有创建者或管理员可以删除活动');
 await db().prepare('DELETE FROM activities WHERE id=?').bind(id).run();return json({ok:true});
});}
