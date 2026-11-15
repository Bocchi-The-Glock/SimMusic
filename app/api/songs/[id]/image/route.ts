import { body, db, endpoint, json, requireUser } from '@/lib/server/core';
import { IMAGE_BODY_BYTES, replaceImage } from '@/lib/server/images';
import { HttpError } from '@/lib/server/validation';
export async function PATCH(request: Request, context: {params: Promise<{id:string}>}) { return endpoint(async () => {
  const user = await requireUser(request), {id} = await context.params;
  const song = await db().prepare('SELECT owner_id FROM songs WHERE id=?').bind(id).first<{owner_id:string}>();
  if (!song) throw new HttpError(404, '这首乐曲已不存在');
  if (user.role !== 'admin' && song.owner_id !== user.id) throw new HttpError(403, '只有收录者或管理员可以修改乐曲图片');
  const data = await body(request, IMAGE_BODY_BYTES);
  if (!Object.hasOwn(data, 'imageDataUrl')) throw new HttpError(400, '请选择图片');
  return json({imageUrl: await replaceImage('song', id, data.imageDataUrl)});
}); }
