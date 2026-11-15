import { body, db, endpoint, json, requireUser } from '@/lib/server/core';
import { coordinates, optionalText, HttpError, requiredText } from '@/lib/server/validation';
import { decodeImage, discardImage, IMAGE_BODY_BYTES, imageInsert, imageUrl, storeImage } from '@/lib/server/images';
import { ensurePlayer } from '@/lib/server/players';
export async function POST(request: Request) { return endpoint(async () => {
  const user=await requireUser(request), data=await body(request,IMAGE_BODY_BYTES);
  const name=requiredText(data.name,'商店名称',80), nameKey=name.toLocaleLowerCase(), port=optionalText(data.port,'附近港口',100), {x,y,z}=coordinates(data), id=crypto.randomUUID();
  const owner=await ensurePlayer(data.ownerGameId??user.gameId);
  const image=await storeImage(decodeImage(data.imageDataUrl));
  try {
    const [result]=await db().batch([
      db().prepare('INSERT INTO shops (id,name,name_key,x,y,z,port,created_at,owner_id,creator_id) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(name_key) DO NOTHING').bind(id,name,nameKey,x,y,z,port,Date.now(),owner.id,user.id),
      ...(image ? [imageInsert('shop',id,image)] : []),
    ]);
    if (!result.meta.changes) throw new HttpError(409,'这个商店名称已经存在，请从列表中选择');
  } catch(error) { await discardImage(image?.key); throw error; }
  return json({id,name,x,y,z,port,ownerId:owner.id,creatorId:user.id,owner:owner.gameId,coordinatesKnown:true,canManage:true,imageUrl:imageUrl(image?.key)},201);
}); }
