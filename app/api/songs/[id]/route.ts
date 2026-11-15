import { songFields, songFavoriteStatement } from '@/lib/server/song-fields';
import { body, checkMutationOrigin, db, endpoint, json, requireUser } from '@/lib/server/core';
import { HttpError } from '@/lib/server/validation';
import { decodeImage, discardImage, IMAGE_BODY_BYTES, imageInsert, imageUrl, storeImage, imageSelect, discardImageLater, imageDelete } from '@/lib/server/images';
export async function DELETE(request: Request, context: {params: Promise<{id:string}>}) { return endpoint(async () => {
  checkMutationOrigin(request);
  const user=await requireUser(request), {id}=await context.params;
  const song=await db().prepare('SELECT owner_id FROM songs WHERE id = ?').bind(id).first<{owner_id:string}>();
  if (!song) throw new HttpError(404,'这首乐曲已不存在');
  if (user.role!=='admin' && song.owner_id!==user.id) throw new HttpError(403,'只有收录者或管理员可以删除这首乐曲');
  const [images]=await db().batch<Record<string, unknown>>([imageSelect('song',id),imageDelete('song',id),db().prepare('DELETE FROM favorites WHERE song_id = ?').bind(id),db().prepare('DELETE FROM song_shops WHERE song_id = ?').bind(id),db().prepare('DELETE FROM songs WHERE id = ?').bind(id)]);
  discardImageLater(images.results[0]?.object_key as string | undefined);
  return json({ok:true});
}); }

export async function PATCH(request: Request, context: {params: Promise<{id:string}>}) { return endpoint(async () => {
  const user=await requireUser(request), data=await body(request,IMAGE_BODY_BYTES), {id}=await context.params;
  const song=await db().prepare('SELECT owner,owner_id FROM songs WHERE id=?').bind(id).first<{owner:string;owner_id:string}>();
  if (!song) throw new HttpError(404,'这首乐曲已不存在');
  if (user.role!=='admin' && song.owner_id!==user.id) throw new HttpError(403,'只有收录者或管理员可以编辑这首乐曲');
  const fields=await songFields(data);
  const {title,artist,price,customPrice,bars,genre,description,shopIds}=fields;
  const changeImage=data.imageDataUrl!==undefined;
  const image=changeImage ? await storeImage(decodeImage(data.imageDataUrl)) : null;
  let previousKey:string|undefined;
  let favoriteCount=0,isFavorited=false;
  try {
    const results=await db().batch<Record<string,unknown>>([
      imageSelect('song',id),
      db().prepare('UPDATE songs SET title=?,artist=?,price=?,custom_price=?,bars=?,genre=?,description=? WHERE id=?').bind(title,artist,price,customPrice?1:0,bars,genre,description,id),
      db().prepare('DELETE FROM song_shops WHERE song_id=?').bind(id),
      ...shopIds.map(shopId=>db().prepare('INSERT INTO song_shops (song_id,shop_id) VALUES (?,?)').bind(id,shopId)),
      ...(changeImage ? [image ? imageInsert('song',id,image) : imageDelete('song',id)] : []),
      songFavoriteStatement(id,user.id),
    ]);
    if (!results[1].meta.changes) throw new HttpError(404,'这首乐曲已不存在');
    previousKey=results[0].results[0]?.object_key as string|undefined;
    const favorite=results.at(-1)!.results[0];
    favoriteCount=Number(favorite.favoriteCount);isFavorited=!!favorite.isFavorited;
  } catch(error) { await discardImage(image?.key); throw error; }
  if(changeImage)discardImageLater(previousKey);
  return json({id,...fields,owner:song.owner,imageUrl:imageUrl(changeImage?image?.key:previousKey),favoriteCount,isFavorited,canEdit:true});
}); }
