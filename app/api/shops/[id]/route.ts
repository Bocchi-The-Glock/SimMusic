import { ADMIN } from '@/lib/server/constants';
import { body, checkMutationOrigin, db, endpoint, json, requireUser, type User } from '@/lib/server/core';
import { coordinates, optionalText, HttpError, requiredText } from '@/lib/server/validation';
import { decodeImage, discardImage, discardImageLater, IMAGE_BODY_BYTES, imageDelete, imageInsert, imageSelect, imageUrl, storeImage } from '@/lib/server/images';

type Context = {params: Promise<{id:string}>};
async function manageableShop(id: string, user: User) {
  const shop=await db().prepare('SELECT id,owner_id FROM shops WHERE id = ?').bind(id).first<{id:string;owner_id:string|null}>();
  if (!shop) throw new HttpError(404,'商店不存在');
  if (user.role !== 'admin' && shop.owner_id !== user.id) throw new HttpError(403,'只有创建者或管理员可以管理这个商店');
  return shop;
}

export async function PATCH(request: Request, context: Context) { return endpoint(async () => {
  const user=await requireUser(request), data=await body(request,IMAGE_BODY_BYTES), {id}=await context.params;
  const shop=await manageableShop(id,user);
  const name=requiredText(data.name,'商店名称',80), nameKey=name.toLocaleLowerCase(), port=optionalText(data.port,'附近港口',100), {x,y,z}=coordinates(data);
  const owner=shop.owner_id===ADMIN.id ? ADMIN.gameId : shop.owner_id ? (await db().prepare('SELECT game_id FROM users WHERE id=?').bind(shop.owner_id).first<{game_id:string}>())?.game_id??null : null;
  const changeImage=data.imageDataUrl!==undefined;
  const image=changeImage ? await storeImage(decodeImage(data.imageDataUrl)) : null;
  let previousKey:string|undefined;
  try {
    // A unique-name conflict rolls back both the shop edit and image association.
    const [previous,result]=await db().batch<Record<string,unknown>>([
      imageSelect('shop',id),
      db().prepare('UPDATE shops SET name=?,name_key=?,x=?,y=?,z=?,port=? WHERE id=?').bind(name,nameKey,x,y,z,port,id),
      ...(changeImage ? [image ? imageInsert('shop',id,image) : imageDelete('shop',id)] : []),
    ]);
    if(!result.meta.changes)throw new HttpError(404,'商店不存在');
    previousKey=previous.results[0]?.object_key as string|undefined;
  } catch(error) {
    await discardImage(image?.key);
    if(error instanceof Error && error.message.includes('UNIQUE constraint failed: shops.name_key'))throw new HttpError(409,'这个商店名称已经存在');
    throw error;
  }
  if(changeImage)discardImageLater(previousKey);
  return json({id,name,x,y,z,port,ownerId:shop.owner_id,owner,canManage:true,imageUrl:imageUrl(changeImage?image?.key:previousKey)});
}); }

export async function DELETE(request: Request, context: Context) { return endpoint(async () => {
  checkMutationOrigin(request);
  const user=await requireUser(request), {id}=await context.params;
  await manageableShop(id,user);
  const [images]=await db().batch<Record<string,unknown>>([
    imageSelect('shop',id),
    imageDelete('shop',id),
    db().prepare('DELETE FROM song_shops WHERE shop_id = ?').bind(id),
    db().prepare('DELETE FROM shops WHERE id = ?').bind(id),
  ]);
  discardImageLater(images.results[0]?.object_key as string|undefined);
  return json({ok:true});
}); }
