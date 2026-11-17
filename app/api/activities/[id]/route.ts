import { body, checkMutationOrigin, db, endpoint, getLivehouse, json, requireUser } from '@/lib/server/core';
import { canManage, communityState, description, getActivity, nullableVenue, requireVenueManager } from '@/lib/server/community';
import { calendarDate, HttpError, requiredText } from '@/lib/server/validation';
import { STARRY } from '@/lib/server/constants';
import { decodeImage, discardImage, discardImageLater, IMAGE_BODY_BYTES, imageDelete, imageInsert, imageSelect, storeImage } from '@/lib/server/images';
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{
 const user=await requireUser(request),data=await body(request,IMAGE_BODY_BYTES),{id}=await context.params,activity=await getActivity(id);
 if(!activity)throw new HttpError(404,'活动已不存在');
 if(!canManage(user,activity.owner_id))throw new HttpError(403,'只有创建者或管理员可以编辑活动');
 const livehouseId=data.livehouseId===undefined?activity.livehouse_id:nullableVenue(data.livehouseId),date=data.date===undefined?activity.date:calendarDate(data.date);
 const scheduleChanged=livehouseId!==activity.livehouse_id||date!==activity.date;
 if(scheduleChanged){await requireVenueManager(user,activity.livehouse_id);if(livehouseId!==activity.livehouse_id)await requireVenueManager(user,livehouseId);}
 if(livehouseId&&!await getLivehouse(livehouseId))throw new HttpError(404,'演出场地已不存在');
 const name=data.name===undefined?activity.name:requiredText(data.name,'活动名字',100),intro=data.description===undefined?activity.description:description(data.description),location=data.location===undefined?activity.location:requiredText(data.location,'活动地点',200);
 const changeImage=data.imageDataUrl!==undefined,image=changeImage?await storeImage(decodeImage(data.imageDataUrl)):null;
 let previousKey:string|undefined;
 try{
  const [previous,result]=await db().batch<Record<string,unknown>>([
   imageSelect('activity',id),
   db().prepare(`UPDATE OR IGNORE activities SET name=?,date=?,description=?,location=?,livehouse_id=?
   WHERE id=? AND date=? AND livehouse_id IS ?
   AND (? IS NULL OR ?=? OR EXISTS(SELECT 1 FROM livehouses WHERE id=?))
   AND (?=0 OR ?=1 OR (
    (? IS NULL OR EXISTS(SELECT 1 FROM livehouses WHERE id=? AND owner_id=?))
    AND (? IS NULL OR EXISTS(SELECT 1 FROM livehouses WHERE id=? AND owner_id=?))
   ))`).bind(name,date,intro,location,livehouseId,id,activity.date,activity.livehouse_id,livehouseId,livehouseId,STARRY.id,livehouseId,scheduleChanged?1:0,user.role==='admin'?1:0,activity.livehouse_id,activity.livehouse_id,user.id,livehouseId,livehouseId,user.id),
   ...(changeImage?[image?imageInsert('activity',id,image,true):imageDelete('activity',id,true)]:[]),
  ]);
  if(!result.meta.changes)throw new HttpError(409,'活动安排已变化或该日期已有活动，请刷新后重试');
  previousKey=previous.results[0]?.object_key as string|undefined;
 }catch(error){await discardImage(image?.key);throw error;}
 if(changeImage)discardImageLater(previousKey);
 return json((await communityState(user)).activities.find(a=>a.id===id));
});}
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{
 checkMutationOrigin(request);const user=await requireUser(request),{id}=await context.params,activity=await getActivity(id);
 if(!activity)throw new HttpError(404,'活动已不存在');
 if(!canManage(user,activity.owner_id))throw new HttpError(403,'只有创建者或管理员可以删除活动');
 const [previous]=await db().batch<Record<string,unknown>>([
  imageSelect('activity',id),imageDelete('activity',id),db().prepare('DELETE FROM activities WHERE id=?').bind(id),
 ]);
 discardImageLater(previous.results[0]?.object_key as string|undefined);
 return json({ok:true});
});}
