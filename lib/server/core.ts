import { env } from 'cloudflare:workers';
import { ADMIN, STARRY, DEFAULT_GENRES } from './constants';
import { HttpError } from './validation';

export type User = {id: string; gameId: string; role: 'admin' | 'user'; bio: string; contact: string; avatarUrl: string | null};
export function db(): D1Database {
  if (!env.DB) throw new HttpError(503, '数据服务暂不可用，请稍后重试');
  return env.DB;
}
export function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(data, {status, headers: {'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers}});
}
export async function endpoint(run: () => Promise<Response>): Promise<Response> {
  try { return await run(); } catch (error) {
    if (error instanceof HttpError) return json({error:error.message},error.status);
    console.error('SimMusic request failed:', error instanceof Error ? error.message : 'Unknown error');
    return json({error:'暂时无法完成操作，请稍后重试'},500);
  }
}
export async function body(request: Request, maxBytes = 20000): Promise<Record<string, unknown>> {
  checkMutationOrigin(request);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, '请使用 JSON 提交');
  if (Number(request.headers.get('content-length')) > maxBytes) throw new HttpError(413, '提交内容过长');
  const reader = request.body?.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, '提交内容过长'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes);
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new HttpError(400, '提交内容格式有误'); }
  if (typeof data !== 'object' || !data || Array.isArray(data)) throw new HttpError(400, '提交内容格式有误');
  return data as Record<string, unknown>;
}
export function externalClient(request: Request) {
  return !!env.SIMMUSIC_ALLOWED_ORIGIN && request.headers.get("origin") === env.SIMMUSIC_ALLOWED_ORIGIN;
}
export function checkMutationOrigin(request: Request) {
  if (externalClient(request)) return;
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, '请求来源不被允许');
}
export async function sha256(text: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2,'0')).join('');
}
export async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const hash = await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2,'0')).join('');
}
export function equalHash(a: string,b: string) {
  let diff = a.length ^ b.length;
  for (let i=0;i<Math.max(a.length,b.length);i++) diff |= (a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0);
  return diff === 0;
}
export function randomHex(bytes = 32) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2,'0')).join('');
}
export function sessionToken(request: Request) {
  if (externalClient(request)) {
    const bearer=request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (bearer) return bearer;
  }
  return request.headers.get('cookie')?.split(';').map((s)=>s.trim()).find((s)=>s.startsWith('simlive_session='))?.slice('simlive_session='.length) ?? '';
}
export async function profileDetails(userId: string): Promise<{bio: string; contact: string; avatarUrl: string | null}> {
  const profile=await db().prepare(`SELECT COALESCE((SELECT bio FROM profiles WHERE user_id=?),'') AS bio,
    COALESCE((SELECT contact FROM players WHERE id=?),'') AS contact,
    (SELECT '/api/images/' || object_key FROM entity_images WHERE entity_type='profile' AND entity_id=?) AS avatarUrl`)
    .bind(userId,userId,userId).first<{bio:string;contact:string;avatarUrl:string|null}>();
  return profile ?? {bio:'',contact:'',avatarUrl:null};
}
export async function currentUserStatement(request: Request): Promise<D1PreparedStatement> {
  const token=sessionToken(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return db().prepare('SELECT NULL AS id WHERE 0');
  // One request-scoped lookup; revoked, expired and deleted-user sessions fail closed.
  // The fixed administrator does not have a row in users.
  return db().prepare(`SELECT s.user_id AS id,
    CASE WHEN s.user_id=? THEN ? ELSE u.game_id END AS gameId,
    CASE WHEN s.user_id=? THEN 'admin' ELSE 'user' END AS role,
    COALESCE(p.bio,'') AS bio, COALESCE(player.contact,'') AS contact, '/api/images/' || i.object_key AS avatarUrl
    FROM sessions s LEFT JOIN players player ON player.id=s.user_id LEFT JOIN users u ON u.id=s.user_id LEFT JOIN profiles p ON p.user_id=s.user_id
    LEFT JOIN entity_images i ON i.entity_type='profile' AND i.entity_id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND (s.user_id=? OR u.id IS NOT NULL)`)
    .bind(ADMIN.id,ADMIN.gameId,ADMIN.id,await sha256(token),Date.now(),ADMIN.id);
}
export async function currentUser(request: Request): Promise<User | null> {
  if (!/^[a-f0-9]{64}$/.test(sessionToken(request))) return null;
  return (await currentUserStatement(request)).first<User>();
}
export async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (!user) throw new HttpError(401,'请先登录游戏账号');
  return user;
}
export function sessionCookie(request: Request, token: string, maxAge = 1209600) {
  return `simlive_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function rateLimit(request: Request, category: string, limit: number, windowMs: number) {
  const ip=request.headers.get('cf-connecting-ip') ?? 'local';
  const key=await sha256(`${category}:${ip}`), now=Date.now();
  const row=await db().prepare('INSERT INTO rate_windows (key,count,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at <= ? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at <= ? THEN ? ELSE reset_at END RETURNING count').bind(key,now+windowMs,now,now,now+windowMs).first<{count:number}>();
  if (row && row.count > limit) throw new HttpError(429,'操作过于频繁，请稍后再试');
}
export async function getLivehouse(id: string) {
  if (id===STARRY.id) return {...STARRY,owner_id:ADMIN.id};
  return db().prepare('SELECT * FROM livehouses WHERE id = ?').bind(id).first<{id:string;name:string;owner:string;owner_id:string;x:number;y:number;z:number;port:string}>();
}
export async function getGenres() {
  const result=await db().prepare('SELECT name FROM genres ORDER BY rowid').all<{name:string}>();
  return [...DEFAULT_GENRES,...result.results.map((g)=>g.name)];
}
export async function isKnownGenre(name: string) {
  if (DEFAULT_GENRES.includes(name)) return true;
  return !!(await db().prepare('SELECT name FROM genres WHERE name=?').bind(name).first());
}
