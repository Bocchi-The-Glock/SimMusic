import { checkMutationOrigin, db, endpoint, getLivehouse, json, requireUser } from '@/lib/server/core';
import { HttpError } from '@/lib/server/validation';
export async function DELETE(request: Request, context: {params: Promise<{id:string}>}) { return endpoint(async () => {
  checkMutationOrigin(request);
  const user=await requireUser(request), {id}=await context.params;
  const event=await db().prepare('SELECT creator_id,livehouse_id FROM events WHERE id = ?').bind(id).first<{creator_id:string|null;livehouse_id:string}>();
  if (!event) throw new HttpError(404,'这场演出已不存在');
  const house=await getLivehouse(event.livehouse_id);
  if (user.role!=='admin' && event.creator_id!==user.id && house?.owner_id!==user.id) throw new HttpError(403,'只有演出创建者、场地所有者或管理员可以取消演出');
  await db().prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  return json({ok:true});
}); }
