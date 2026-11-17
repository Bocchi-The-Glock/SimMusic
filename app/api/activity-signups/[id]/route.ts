import { checkMutationOrigin, db, endpoint, json, requireUser } from '@/lib/server/core';
import { canCancelSignup } from '@/lib/server/community';
import { HttpError } from '@/lib/server/validation';
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{
 checkMutationOrigin(request);const user=await requireUser(request),{id}=await context.params;
 const row=await db().prepare('SELECT s.kind,s.player_id AS playerId,s.creator_id AS creatorId,a.owner_id AS ownerId FROM activity_signups s JOIN activities a ON a.id=s.activity_id WHERE s.id=?').bind(id).first<{kind:string;playerId:string;creatorId:string|null;ownerId:string}>();
 if(!row)throw new HttpError(404,'报名已不存在');
 if(!canCancelSignup(user,row))throw new HttpError(403,'不能取消其他人的报名');
 await db().prepare('DELETE FROM activity_signups WHERE id=?').bind(id).run();return json({ok:true});
});}
