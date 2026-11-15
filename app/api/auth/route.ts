import { ADMIN } from '@/lib/server/constants';
import { body, db, endpoint, externalClient, equalHash, json, passwordHash, profileDetails, randomHex, rateLimit, sessionCookie, sessionToken, sha256, type User } from '@/lib/server/core';
import { gameId, HttpError } from '@/lib/server/validation';
import { ensurePlayer,playerKey } from '@/lib/server/players';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) { return endpoint(async () => {
  const data=await body(request);
  if (data.mode === 'logout') {
    const old=sessionToken(request);
    if (old) await db().prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(old)).run();
    return json({user:null},200,{'Set-Cookie':sessionCookie(request,'',0)});
  }
  if (data.mode !== 'login' && data.mode !== 'register') throw new HttpError(400,'未知的登录操作');
  await rateLimit(request,'auth',50,15*60*1000);
  const name=gameId(data.gameId), key=playerKey(name);
  if (typeof data.password !== 'string' || data.password.length < 8 || data.password.length > 128) throw new HttpError(400,'密码需要 8 至 128 个字符');
  let user: User;
  if (data.mode === 'register') {
    if (typeof data.confirmPassword !== 'string' || data.confirmPassword !== data.password) throw new HttpError(400,'两次输入的密码不一致');
    if (key===ADMIN.gameId.toLowerCase()) throw new HttpError(409,'这个游戏 ID 已被注册');
    const existing=await db().prepare('SELECT id FROM users WHERE game_key = ?').bind(key).first();
    if (existing) throw new HttpError(409,'这个游戏 ID 已被注册');
    const player=await ensurePlayer(name);
    const id=player.id, salt=randomHex(16), hash=await passwordHash(data.password,salt);
    const created=await db().prepare('INSERT INTO users (id,game_id,game_key,salt,password_hash,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(game_key) DO NOTHING').bind(id,name,key,salt,hash,Date.now()).run();
    if (!created.meta.changes) throw new HttpError(409,'这个游戏 ID 已被注册');
    user={id,gameId:name,role:'user',...await profileDetails(id)};
  } else if (key===ADMIN.gameId.toLowerCase()) {
    if (!equalHash(await passwordHash(data.password,ADMIN.salt),ADMIN.passwordHash)) throw new HttpError(401,'游戏 ID 或密码不正确');
    user={id:ADMIN.id,gameId:ADMIN.gameId,role:'admin',...await profileDetails(ADMIN.id)};
  } else {
    const row=await db().prepare('SELECT id,game_id,salt,password_hash FROM users WHERE game_key = ?').bind(key).first<{id:string;game_id:string;salt:string;password_hash:string}>();
    const computed=await passwordHash(data.password,row?.salt ?? ADMIN.salt);
    if (!row || !equalHash(computed,row.password_hash)) throw new HttpError(401,'游戏 ID 或密码不正确');
    user={id:row.id,gameId:row.game_id,role:'user',...await profileDetails(row.id)};
  }
  const token=randomHex(), now=Date.now(), old=sessionToken(request);
  const statements=[db().prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha256(token),user.id,now+1209600000),db().prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now)];
  if (old) statements.push(db().prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(old)));
  await db().batch(statements);
  return json({user,...(externalClient(request)?{sessionToken:token}:{})},data.mode==='register'?201:200,{'Set-Cookie':sessionCookie(request,token)});
}); }
