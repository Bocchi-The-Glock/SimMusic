import { body, checkMutationOrigin, db, endpoint, json, requireUser, type User } from '@/lib/server/core';
import { coordinates, optionalText, HttpError, requiredText } from '@/lib/server/validation';
import { decodeImage, discardImage, discardImageLater, IMAGE_BODY_BYTES, imageSelect, imageUrl, storeImage } from '@/lib/server/images';
import { ensurePlayer } from '@/lib/server/players';

type Context = {params: Promise<{id:string}>};
const accessSql="EXISTS (SELECT 1 FROM shops WHERE id=? AND (?='admin' OR creator_id=? OR owner_id=?))";
const accessArgs=(id:string,user:User)=>[id,user.role,user.id,user.id];
async function manageableShop(id: string, user: User) {
 const shop=await db().prepare('SELECT s.id,s.owner_id,s.creator_id,p.game_id AS owner FROM shops s LEFT JOIN players p ON p.id=s.owner_id WHERE s.id=?').bind(id).first<{id:string;owner_id:string|null;creator_id:string|null;owner:string|null}>();
 if(!shop)throw new HttpError(404,'商店不存在');
 if(user.role!=='admin' && shop.owner_id!==user.id && shop.creator_id!==user.id)throw new HttpError(403,'只有创建者、所有者或管理员可以管理这个商店');
 return shop;
}
export async function PATCH(request:Request,context:Context){return endpoint(async()=>{
 const user=await requireUser(request),data=await body(request,IMAGE_BODY_BYTES),{id}=await context.params;
 const shop=await manageableShop(id,user);
 const name=requiredText(data.name,'商店名称',80),nameKey=name.toLowerCase(),port=optionalText(data.port,'附近港口',100),{x,y,z}=coordinates(data);
 const owner=data.ownerGameId===undefined?{id:shop.owner_id,gameId:shop.owner}:await ensurePlayer(data.ownerGameId);
 const changeImage=data.imageDataUrl!==undefined,image=changeImage?await storeImage(decodeImage(data.imageDataUrl)):null;
 let previousKey:string|undefined;
 try {
  // Recheck access inside every write in the transaction. Transferring ownership
  // cannot authorize an already-in-flight request from the previous owner.
  const access=accessArgs(id,user);
  const results=await db().batch<Record<string,unknown>>([
   imageSelect('shop',id),
   ...(changeImage?[image?
    db().prepare(`INSERT INTO entity_images(entity_type,entity_id,object_key,mime_type,size_bytes) SELECT 'shop',?,?,?,? WHERE ${accessSql} ON CONFLICT(entity_type,entity_id) DO UPDATE SET object_key=excluded.object_key,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes`).bind(id,image.key,image.mime,image.size,...access):
    db().prepare(`DELETE FROM entity_images WHERE entity_type='shop' AND entity_id=? AND ${accessSql}`).bind(id,...access)]:[]),
   db().prepare(`UPDATE shops SET name=?,name_key=?,x=?,y=?,z=?,port=?,owner_id=?,coordinates_known=1 WHERE id=? AND ${accessSql}`).bind(name,nameKey,x,y,z,port,owner.id,id,...access),
  ]);
  if(!results.at(-1)!.meta.changes)throw new HttpError(403,'商店已不存在或你已无管理权限');
  previousKey=results[0].results[0]?.object_key as string|undefined;
 }catch(error){
  await discardImage(image?.key);
  if(error instanceof Error&&error.message.includes('UNIQUE constraint failed: shops.name_key'))throw new HttpError(409,'这个商店名称已经存在');
  throw error;
 }
 if(changeImage)discardImageLater(previousKey);
 return json({id,name,x,y,z,port,ownerId:owner.id,creatorId:shop.creator_id,owner:owner.gameId,coordinatesKnown:true,canManage:user.role==='admin'||user.id===shop.creator_id||user.id===owner.id,imageUrl:imageUrl(changeImage?image?.key:previousKey)});
});}
export async function DELETE(request:Request,context:Context){return endpoint(async()=>{
 checkMutationOrigin(request);
 const user=await requireUser(request),{id}=await context.params;
 await manageableShop(id,user);
 const access=accessArgs(id,user);
 const results=await db().batch<Record<string,unknown>>([
  imageSelect('shop',id),
  db().prepare(`DELETE FROM entity_images WHERE entity_type='shop' AND entity_id=? AND ${accessSql}`).bind(id,...access),
  db().prepare(`DELETE FROM song_shops WHERE shop_id=? AND ${accessSql}`).bind(id,...access),
  db().prepare(`DELETE FROM shops WHERE id=? AND ${accessSql}`).bind(id,...access),
 ]);
 if(!results[3].meta.changes)throw new HttpError(403,'商店已不存在或你已无管理权限');
 discardImageLater(results[0].results[0]?.object_key as string|undefined);
 return json({ok:true});
});}
