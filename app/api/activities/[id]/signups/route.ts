import { body, currentUser, db, endpoint, json, rateLimit } from '@/lib/server/core';
import { communityState, getActivity, getBand } from '@/lib/server/community';
import { playerKey } from '@/lib/server/players';
import { gameId, HttpError, requiredText } from '@/lib/server/validation';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return endpoint(async()=>{
 const data=await body(request),user=await currentUser(request),{id}=await context.params;
 await rateLimit(request,'activity-signups',120,3600000);
 if(!await getActivity(id))throw new HttpError(404,'活动已不存在');
 if(data.kind!=='individual'&&data.kind!=='band')throw new HttpError(400,'请选择个人或乐队报名');
 const programName=requiredText(data.programName,'节目名称',120);
 const kind=data.kind,playerId=user?.gameId??(kind==='individual'?gameId(data.playerId):''),bandId=kind==='band'?requiredText(data.bandId,'乐队',80):null;
 if(kind==='band'){
  if(!user)throw new HttpError(401,'乐队报名需要先登录');
  const band=await getBand(bandId!);
  if(!band)throw new HttpError(404,'乐队已不存在');
  if(band.captain_id!==user.id&&!await db().prepare('SELECT 1 FROM band_members WHERE band_id=? AND player_id=?').bind(bandId,user.id).first())throw new HttpError(403,'只能代表自己所属的乐队报名');
 }
 const participantKey=kind==='band'?'band:'+bandId:'individual:'+playerKey(playerId);
 // Membership and activity existence are checked again inside the insertion statement.
 const result=await db().prepare(`INSERT INTO activity_signups(activity_id,kind,player_id,band_id,creator_id,participant_key,created_at,program_name)
 SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM activities WHERE id=?) AND (?='individual' OR EXISTS(SELECT 1 FROM bands b WHERE b.id=? AND (b.captain_id=? OR EXISTS(SELECT 1 FROM band_members m WHERE m.band_id=b.id AND m.player_id=?))))
 ON CONFLICT(activity_id,participant_key) DO NOTHING RETURNING id`).bind(id,kind,playerId,bandId,user?.id??null,participantKey,Date.now(),programName,id,kind,bandId,user?.id??null,user?.id??null).first<{id:number}>();
 if(!result)throw new HttpError(409,'已报名，或活动/乐队成员信息已变化，请刷新确认');
 return json((await communityState(user)).activitySignups.find(s=>s.id===String(result.id)),201);
});}
