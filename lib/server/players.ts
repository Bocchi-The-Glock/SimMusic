import { db } from './core';
import { ADMIN } from './constants';
import { gameId } from './validation';
export type Player = {id:string;gameId:string;gameKey:string;contact:string};
export function playerKey(value: string) { return value.trim().toLowerCase(); }
export async function ensurePlayer(value: unknown): Promise<Player> {
 const name=gameId(value),key=playerKey(name);
 const id=key===playerKey(ADMIN.gameId)?ADMIN.id:crypto.randomUUID();
 await db().prepare('INSERT INTO players (id,game_id,game_key) VALUES (?,?,?) ON CONFLICT(game_key) DO NOTHING').bind(id,key===playerKey(ADMIN.gameId)?ADMIN.gameId:name,key).run();
 const player=await db().prepare('SELECT id,game_id AS gameId,game_key AS gameKey,contact FROM players WHERE game_key=?').bind(key).first<Player>();
 if(!player)throw new Error('Unable to resolve player identity');
 return player;
}
