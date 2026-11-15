import { body, db, endpoint, json, requireUser } from '@/lib/server/core';
import { songFields } from '@/lib/server/song-fields';
import { decodeImage, discardImage, IMAGE_BODY_BYTES, imageInsert, imageUrl, storeImage } from '@/lib/server/images';
export async function POST(request: Request) { return endpoint(async () => {
  const user=await requireUser(request), data=await body(request, IMAGE_BODY_BYTES);
  const {title,artist,bars,genre,customPrice,price,description,shopIds,instruments,saleCoordinates}=await songFields(data);
  const id=crypto.randomUUID();
  const image=await storeImage(decodeImage(data.imageDataUrl));
  try { await db().batch([
    db().prepare('INSERT INTO songs (id,title,artist,price,custom_price,bars,genre,description,owner,owner_id,created_at,instruments,sale_x,sale_y,sale_z) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,title,artist,price,customPrice?1:0,bars,genre,description,user.gameId,user.id,Date.now(),JSON.stringify(instruments),saleCoordinates?.x??null,saleCoordinates?.y??null,saleCoordinates?.z??null),
    ...shopIds.map((shopId)=>db().prepare('INSERT INTO song_shops (song_id,shop_id) VALUES (?,?)').bind(id,shopId)),
    ...(image ? [imageInsert('song',id,image)] : []),
  ]); } catch (error) { await discardImage(image?.key); throw error; }
  return json({id,title,artist,price,customPrice,bars,genre,description,instruments,saleCoordinates,owner:user.gameId,shopIds,imageUrl:imageUrl(image?.key),favoriteCount:0,isFavorited:false,canEdit:true},201);
}); }
