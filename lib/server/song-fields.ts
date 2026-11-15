import { db, isKnownGenre } from './core';
import { HttpError, integer, priceValue, requiredText, coordinates } from './validation';

import { validateInstruments, storedInstruments } from './instruments';
export type StoredSongExtras={instruments?:string;sale_x?:number|null;sale_y?:number|null;sale_z?:number|null};
export async function songFields(data: Record<string, unknown>, previous?:StoredSongExtras) {
  const title=requiredText(data.title,'作品名称',120), artist=requiredText(data.artist,'艺术家',100), bars=data.bars == null || data.bars === '' ? 0 : integer(data.bars,'小节数',1,1000000), genre=requiredText(data.genre,'音乐类型',40);
  if (!await isKnownGenre(genre)) throw new HttpError(400,'请从已有音乐类型中选择');
  if (typeof data.customPrice !== 'boolean') throw new HttpError(400,'请选择定价方式');
  const customPrice=data.customPrice, price=customPrice?null:priceValue(data.price);
  const description=typeof data.description==='string'?data.description.trim():'';
  if (description.length>5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(description)) throw new HttpError(400,'描述最多 5000 个字符');
  if (!Array.isArray(data.shopIds) || data.shopIds.length>100 || data.shopIds.some((s)=>typeof s!=='string')) throw new HttpError(400,'请正确选择商店');
  const shopIds=[...new Set(data.shopIds as string[])];
  if (shopIds.length) {
    const found=await db().prepare(`SELECT id FROM shops WHERE id IN (${shopIds.map(()=>'?').join(',')})`).bind(...shopIds).all();
    if (found.results.length!==shopIds.length) throw new HttpError(400,'所选商店已不存在，请重新选择');
  }
  const instruments=data.instruments===undefined ? storedInstruments(previous?.instruments) : validateInstruments(data.instruments);
  const saleCoordinates=data.saleCoordinates===undefined ? (previous?.sale_x!=null && previous.sale_y!=null && previous.sale_z!=null ? {x:previous.sale_x,y:previous.sale_y,z:previous.sale_z} : null) : data.saleCoordinates===null ? null : coordinates((typeof data.saleCoordinates==='object'&&!Array.isArray(data.saleCoordinates)?data.saleCoordinates:{}) as Record<string,unknown>);
  return {title,artist,bars,genre,customPrice,price,description,shopIds,instruments,saleCoordinates};
}
export function songFavoriteStatement(id: string, userId: string) {
  return db().prepare(`SELECT s.id,
    (SELECT COUNT(*) FROM favorites f WHERE f.song_id=s.id) AS favoriteCount,
    EXISTS(SELECT 1 FROM favorites f WHERE f.song_id=s.id AND f.user_id=?) AS isFavorited
    FROM songs s WHERE s.id=?`).bind(userId,id);
}
