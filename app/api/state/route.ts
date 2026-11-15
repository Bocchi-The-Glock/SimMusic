import { ADMIN, DEFAULT_GENRES, STARRY } from '@/lib/server/constants';
import { currentUserStatement, db, endpoint, json, sessionToken, sha256, type User } from '@/lib/server/core';
import { imageUrl } from '@/lib/server/images';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) { return endpoint(async () => {
  // A single D1 round trip also gives these related lists a consistent transaction snapshot.
  const [auth, genreRows, houses, events, songs, shopRows, linkRows, artists, imageRows, favoriteRows]=await db().batch<Record<string, unknown>>([
    await currentUserStatement(request),db().prepare('SELECT name FROM genres ORDER BY rowid'),
    db().prepare('SELECT id,name,x,y,z,port,owner,owner_id FROM livehouses ORDER BY created_at,id'),
    db().prepare('SELECT id,livehouse_id AS livehouseId,date,hour,player_id AS playerId,title,created_at AS createdAt,creator_id FROM events ORDER BY date,hour,id'),
    db().prepare('SELECT s.id,s.title,s.artist,s.price,s.custom_price AS customPrice,s.bars,s.genre,s.description,s.owner,s.owner_id,(SELECT COUNT(*) FROM favorites f WHERE f.song_id=s.id) AS favoriteCount FROM songs s ORDER BY s.created_at DESC,s.id'),
    db().prepare('SELECT s.id,s.name,s.x,s.y,s.z,s.port,s.owner_id AS ownerId,u.game_id AS owner FROM shops s LEFT JOIN users u ON u.id=s.owner_id ORDER BY s.name_key'),
    db().prepare('SELECT song_id,shop_id FROM song_shops'),
    db().prepare('SELECT s.owner_id AS id,CASE WHEN s.owner_id=? THEN ? ELSE u.game_id END AS gameId,COALESCE(p.bio,\'\') AS bio,COUNT(*) AS songCount FROM songs s LEFT JOIN users u ON u.id=s.owner_id LEFT JOIN profiles p ON p.user_id=s.owner_id WHERE s.owner_id=? OR u.id IS NOT NULL GROUP BY s.owner_id,u.game_id,p.bio ORDER BY songCount DESC,gameId COLLATE NOCASE').bind(ADMIN.id,ADMIN.gameId,ADMIN.id),
    db().prepare('SELECT entity_type,entity_id,object_key FROM entity_images'),
    db().prepare('SELECT song_id FROM favorites WHERE user_id=(SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?)').bind(await sha256(sessionToken(request)),Date.now()),
  ]);
  const user=(auth.results[0] as User | undefined)??null;
  const selectedFavorites=new Set(user ? favoriteRows.results.map(f=>String(f.song_id)) : []);
  const genres=[...DEFAULT_GENRES,...genreRows.results.map(g=>String(g.name))];
  const shops=shopRows as D1Result<{id:string;name:string;x:number;y:number;z:number;port:string;ownerId:string|null;owner:string|null}>;
  const links=linkRows as D1Result<{song_id:string;shop_id:string}>;
  const images=imageRows as D1Result<{entity_type:string;entity_id:string;object_key:string}>;
  const imageMap=new Map(images.results.map(i=>[`${i.entity_type}:${i.entity_id}`,imageUrl(i.object_key)]));
  const shopMap=new Map<string,string[]>();
  for (const link of links.results) shopMap.set(link.song_id,[...(shopMap.get(link.song_id)||[]),link.shop_id]);
  const venueOwners=new Map(houses.results.map((h)=>[String(h.id),String(h.owner_id)]));
  venueOwners.set(STARRY.id,ADMIN.id);
  return json({user,genres,artists:artists.results.map(a=>({...a,avatarUrl:imageMap.get(`profile:${a.id}`)||null})),livehouses:[{...STARRY,imageUrl:imageMap.get(`livehouse:${STARRY.id}`)||null},...houses.results.map(({owner_id: _ownerId,...h})=>({...h,protected:false,imageUrl:imageMap.get(`livehouse:${h.id}`)||null}))],
    events:events.results.map(({creator_id,...e})=>({...e,id:String(e.id),canDelete:!!user && (user.role==='admin' || creator_id===user.id || venueOwners.get(String(e.livehouseId))===user.id)})),
    shops:shops.results.map((s)=>({...s,owner:s.ownerId===ADMIN.id?ADMIN.gameId:s.owner,canManage:!!user && (user.role==='admin' || user.id===s.ownerId),imageUrl:imageMap.get(`shop:${s.id}`)||null})),
    songs:songs.results.map(({owner_id,...s})=>({...s,customPrice:!!s.customPrice,shopIds:shopMap.get(String(s.id))||[],imageUrl:imageMap.get(`song:${s.id}`)||null,favoriteCount:Number(s.favoriteCount),isFavorited:selectedFavorites.has(String(s.id)),canEdit:!!user&&(user.role==='admin'||user.id===owner_id)}))});
}); }
