import { body, db, endpoint, json, requireUser } from '@/lib/server/core';
import { coordinates, optionalText, requiredText } from '@/lib/server/validation';
import { decodeImage, discardImage, IMAGE_BODY_BYTES, imageInsert, imageUrl, storeImage } from '@/lib/server/images';
export async function POST(request: Request) { return endpoint(async () => {
  const user=await requireUser(request), data=await body(request, IMAGE_BODY_BYTES);
  const name=requiredText(data.name,'演出场地 名称',80), port=optionalText(data.port,'附近港口',100), {x,y,z}=coordinates(data), id=crypto.randomUUID(),createdAt=Date.now();
  const image=await storeImage(decodeImage(data.imageDataUrl));
  try { await db().batch([
    db().prepare('INSERT INTO livehouses (id,name,x,y,z,port,owner,owner_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,name,x,y,z,port,user.gameId,user.id,createdAt),
    ...(image ? [imageInsert('livehouse',id,image)] : []),
  ]); } catch (error) { await discardImage(image?.key); throw error; }
  return json({id,name,x,y,z,port,createdAt,owner:user.gameId,protected:false,imageUrl:imageUrl(image?.key)},201);
}); }
