import { body, db, endpoint, getGenres, json, requireUser } from '@/lib/server/core';
import { HttpError, requiredText } from '@/lib/server/validation';
export async function POST(request: Request) { return endpoint(async () => {
  const data=await body(request), user=await requireUser(request);
  if (user.role!=='admin') throw new HttpError(403,'只有管理员可以新建音乐类型');
  const name=requiredText(data.name,'音乐类型',40), nameKey=name.toLocaleLowerCase();
  if ((await getGenres()).some((g)=>g.toLocaleLowerCase()===nameKey)) throw new HttpError(409,'这个音乐类型已经存在');
  const result=await db().prepare('INSERT INTO genres (name,name_key) VALUES (?,?) ON CONFLICT(name_key) DO NOTHING').bind(name,nameKey).run();
  if (!result.meta.changes) throw new HttpError(409,'这个音乐类型已经存在');
  return json({name},201);
}); }
