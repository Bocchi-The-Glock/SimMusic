import { db, getLivehouse, type User } from './core';
import { ADMIN } from './constants';
import { ensurePlayer, playerKey } from './players';
import { gameId, HttpError, requiredText } from './validation';

export type BandRow={id:string;name:string;captain_id:string;created_at:number};
export type ActivityRow={id:string;name:string;date:string;description:string;location:string;owner_id:string;livehouse_id:string|null;created_at:number};
export const getBand=(id:string)=>db().prepare('SELECT * FROM bands WHERE id=?').bind(id).first<BandRow>();
export const getActivity=(id:string)=>db().prepare('SELECT * FROM activities WHERE id=?').bind(id).first<ActivityRow>();
export function canManage(user:User|null, ownerId:string) { return !!user&&(user.role==='admin'||user.id===ownerId); }
export function canCancelSignup(user:User|null, row:{kind:string;playerId:string;creatorId:string|null;ownerId:string}) {
 return !!user&&(canManage(user,row.ownerId)||row.creatorId===user.id||(row.kind==='individual'&&playerKey(row.playerId)===playerKey(user.gameId)));
}
export async function memberIds(value:unknown,captainId:string) {
 if(!Array.isArray(value)||value.length>200)throw new HttpError(400,'成员 ID 需为列表，最多 200 人');
 const names=[...new Map(value.map(v=>{const name=gameId(v);return [playerKey(name),name] as const;})).values()];
 const ids:string[]=[];
 for(const name of names){const p=await ensurePlayer(name);if(p.id!==captainId)ids.push(p.id);}
 return ids;
}
export function description(value:unknown) {
 if(typeof value!=='string'||!value.trim()||value.length>5000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new HttpError(400,'请填写活动介绍，最多 5000 个字符');
 return value.trim();
}
export function nullableVenue(value:unknown) { return value==null||value===''?null:requiredText(value,'演出场地',80); }
export async function requireVenueManager(user:User,venueId:string|null) {
 if(!venueId)return;
 const venue=await getLivehouse(venueId);
 if(!venue)throw new HttpError(404,'演出场地已不存在');
 if(!canManage(user,venue.owner_id))throw new HttpError(403,'只有场地负责人或管理员可以安排该演出场地的活动');
}
export async function communityState(user:User|null) {
 const [bands,members,activities,signups]=await db().batch<Record<string,unknown>>([
  db().prepare('SELECT b.id,b.name,b.captain_id AS captainId,p.game_id AS captainName,b.created_at AS createdAt FROM bands b JOIN players p ON p.id=b.captain_id ORDER BY b.created_at DESC,b.id'),
  db().prepare('SELECT m.band_id AS bandId,p.id,p.game_id AS gameId,(u.id IS NOT NULL OR p.id=?) AS registered FROM band_members m JOIN players p ON p.id=m.player_id LEFT JOIN users u ON u.id=p.id ORDER BY p.game_key').bind(ADMIN.id),
  db().prepare('SELECT a.id,a.name,a.date,a.description,a.location,a.owner_id AS ownerId,p.game_id AS ownerName,a.livehouse_id AS livehouseId,a.created_at AS createdAt,(SELECT COUNT(*) FROM activity_signups s WHERE s.activity_id=a.id) AS signupCount FROM activities a JOIN players p ON p.id=a.owner_id ORDER BY a.date DESC,a.created_at DESC,a.id'),
  db().prepare(`SELECT s.id,s.activity_id AS activityId,s.kind,s.player_id AS playerId,s.band_id AS bandId,s.creator_id AS creatorId,s.created_at AS createdAt,a.owner_id AS ownerId,CASE WHEN s.kind='band' THEN b.name ELSE s.player_id END AS displayName FROM activity_signups s JOIN activities a ON a.id=s.activity_id LEFT JOIN bands b ON b.id=s.band_id ORDER BY s.id`),
 ]);
 return {
  bands:bands.results.map(b=>{const list=members.results.filter(m=>m.bandId===b.id).map(({bandId,...m})=>({...m,id:String(m.id),gameId:String(m.gameId),registered:!!m.registered}));return {...b,id:String(b.id),members:list,isMember:!!user&&(b.captainId===user.id||list.some(m=>m.id===user.id)),canManage:canManage(user,String(b.captainId))};}),
  activities:activities.results.map(a=>({...a,id:String(a.id),signupCount:Number(a.signupCount),canManage:canManage(user,String(a.ownerId))})),
  activitySignups:signups.results.map(({creatorId,ownerId,...s})=>({...s,id:String(s.id),canDelete:canCancelSignup(user,{kind:String(s.kind),playerId:String(s.playerId),creatorId:creatorId==null?null:String(creatorId),ownerId:String(ownerId)})})),
 };
}
