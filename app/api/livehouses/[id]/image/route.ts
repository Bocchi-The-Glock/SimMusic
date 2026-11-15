import { body, endpoint, getLivehouse, json, requireUser } from '@/lib/server/core';
import { IMAGE_BODY_BYTES, replaceImage } from '@/lib/server/images';
import { HttpError } from '@/lib/server/validation';
export async function PATCH(request: Request, context: {params: Promise<{id:string}>}) { return endpoint(async () => {
  const user = await requireUser(request), {id} = await context.params, house = await getLivehouse(id);
  if (!house) throw new HttpError(404, '这个 Livehouse 已不存在');
  if (user.role !== 'admin' && house.owner_id !== user.id) throw new HttpError(403, '只有所有者或管理员可以修改场地图片');
  const data = await body(request, IMAGE_BODY_BYTES);
  if (!Object.hasOwn(data, 'imageDataUrl')) throw new HttpError(400, '请选择图片');
  return json({imageUrl: await replaceImage('livehouse', id, data.imageDataUrl)});
}); }
