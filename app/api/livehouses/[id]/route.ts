import { STARRY } from '@/lib/server/constants';
import { body, checkMutationOrigin, db, endpoint, getLivehouse, json, requireUser } from '@/lib/server/core';
import { coordinates, HttpError, optionalText, requiredText } from '@/lib/server/validation';
import { decodeImage, discardImage, IMAGE_BODY_BYTES, imageInsert, imageUrl, storeImage, imageSelect, discardImageLater, imageDelete } from '@/lib/server/images';
export async function DELETE(request: Request, context: {params: Promise<{id:string}>}) { return endpoint(async () => {
  checkMutationOrigin(request);
  const user=await requireUser(request), {id}=await context.params;
  if (id===STARRY.id) throw new HttpError(403,'Starry Livehouse 是永久场地，任何人都不能删除');
  const house=await getLivehouse(id);
  if (!house) throw new HttpError(404,'这个 Livehouse 已不存在');
  if (user.role!=='admin' && house.owner_id!==user.id) throw new HttpError(403,'只有所有者或管理员可以删除这个 Livehouse');
  const [images]=await db().batch<Record<string, unknown>>([imageSelect('livehouse',id),imageDelete('livehouse',id),db().prepare('DELETE FROM events WHERE livehouse_id = ?').bind(id),db().prepare('DELETE FROM livehouses WHERE id = ?').bind(id)]);
  discardImageLater(images.results[0]?.object_key as string | undefined);
  return json({ok:true});
}); }

export async function PATCH(request: Request, context: {params: Promise<{id:string}>}) { return endpoint(async () => {
  const user=await requireUser(request), data=await body(request,IMAGE_BODY_BYTES), {id}=await context.params;
  if (id===STARRY.id) throw new HttpError(403,'默认场地的信息不能修改，可以单独更换图片');
  const house=await getLivehouse(id);
  if (!house) throw new HttpError(404,'这个 Livehouse 已不存在');
  if (user.role!=='admin' && house.owner_id!==user.id) throw new HttpError(403,'只有所有者或管理员可以编辑这个 Livehouse');
  const name=requiredText(data.name,'Livehouse 名称',80),port=optionalText(data.port,'附近港口',100),{x,y,z}=coordinates(data);
  const changeImage=data.imageDataUrl!==undefined;
  const image=changeImage ? await storeImage(decodeImage(data.imageDataUrl)) : null;
  let previousKey:string|undefined;
  try {
    const [previous,result]=await db().batch<Record<string,unknown>>([
      imageSelect('livehouse',id),
      db().prepare('UPDATE livehouses SET name=?,x=?,y=?,z=?,port=? WHERE id=?').bind(name,x,y,z,port,id),
      ...(changeImage ? [image ? imageInsert('livehouse',id,image) : imageDelete('livehouse',id)] : []),
    ]);
    if (!result.meta.changes) throw new HttpError(404,'这个 Livehouse 已不存在');
    previousKey=previous.results[0]?.object_key as string|undefined;
  } catch(error) { await discardImage(image?.key); throw error; }
  if(changeImage)discardImageLater(previousKey);
  return json({id,name,x,y,z,port,owner:house.owner,protected:false,imageUrl:imageUrl(changeImage?image?.key:previousKey)});
}); }
