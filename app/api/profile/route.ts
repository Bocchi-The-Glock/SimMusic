import { body, db, endpoint, json, requireUser } from '@/lib/server/core';
import { HttpError } from '@/lib/server/validation';
import { decodeImage, discardImage, discardImageLater, IMAGE_BODY_BYTES, imageDelete, imageInsert, imageSelect, imageUrl, storeImage } from '@/lib/server/images';

export async function PATCH(request: Request) { return endpoint(async () => {
  const user=await requireUser(request), data=await body(request,IMAGE_BODY_BYTES);
  if (typeof data.bio !== 'string' || data.bio.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data.bio)) throw new HttpError(400,'简介最多 1000 个字符');
  const bio=data.bio.trim();
  if(data.contact!==undefined && (typeof data.contact!=='string'||data.contact.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data.contact)))throw new HttpError(400,'联系方式最多 1000 个字符');
  const contact=typeof data.contact==='string'?data.contact.trim():user.contact;
  const changeImage=data.imageDataUrl!==undefined;
  const image=changeImage ? await storeImage(decodeImage(data.imageDataUrl)) : null;
  let previousKey:string|undefined;
  try {
    const [previous]=await db().batch<Record<string,unknown>>([
      imageSelect('profile',user.id),
      db().prepare('INSERT INTO profiles (user_id,bio) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio').bind(user.id,bio),
      ...(data.contact!==undefined ? [db().prepare('UPDATE players SET contact=? WHERE id=?').bind(contact,user.id)] : []),
      ...(changeImage ? [image ? imageInsert('profile',user.id,image) : imageDelete('profile',user.id)] : []),
    ]);
    previousKey=previous.results[0]?.object_key as string|undefined;
  } catch(error) { await discardImage(image?.key); throw error; }
  if(changeImage)discardImageLater(previousKey);
  return json({user:{...user,bio,contact,avatarUrl:imageUrl(changeImage?image?.key:previousKey)}});
}); }
