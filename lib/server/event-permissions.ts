import type { User } from './core';

// Keep the visible delete control and the mutation endpoint on the same rule.
// A player can reclaim a guest booking made with their game ID after signing in.
export function canDeleteEvent(
  user: User | null,
  event: { creatorId: string | null; playerId: string },
  venueOwnerId?: string,
) {
  if (!user) return false;
  return user.role === 'admin'
    || event.creatorId === user.id
    || venueOwnerId === user.id
    || (!!event.playerId.trim() && event.playerId.trim().toLowerCase() === user.gameId.trim().toLowerCase());
}
