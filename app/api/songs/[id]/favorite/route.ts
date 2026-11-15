import { checkMutationOrigin, db, endpoint, json, requireUser } from '@/lib/server/core';
import { HttpError } from '@/lib/server/validation';
import { songFavoriteStatement } from '@/lib/server/song-fields';
type Context = {params: Promise<{id:string}>};
async function favorite(request: Request, context: Context, selected: boolean) { return endpoint(async () => {
  checkMutationOrigin(request);
  const user=await requireUser(request), {id}=await context.params;
  const mutation=selected
    ? db().prepare('INSERT INTO favorites (song_id,user_id,created_at) SELECT id,?,? FROM songs WHERE id=? ON CONFLICT(song_id,user_id) DO NOTHING').bind(user.id,Date.now(),id)
    : db().prepare('DELETE FROM favorites WHERE song_id=? AND user_id=?').bind(id,user.id);
  // The unique key and this transaction make repeated requests and races idempotent.
  const [,result]=await db().batch<Record<string,unknown>>([mutation,songFavoriteStatement(id,user.id)]);
  const row=result.results[0];
  if (!row) throw new HttpError(404,'这首乐曲已不存在');
  return json({id,favoriteCount:Number(row.favoriteCount),isFavorited:!!row.isFavorited});
}); }
export function PUT(request: Request, context: Context) { return favorite(request,context,true); }
export function DELETE(request: Request, context: Context) { return favorite(request,context,false); }
