import type { Socket } from 'socket.io';
import { campaigns } from '../db/repos.js';
import { emitError, sdata } from './hub.js';

/**
 * The DM's two freezes, and who they land on.
 *
 * Each lock exists at two scopes: the whole table, and one player. They are
 * stored separately and combined here, never at a call site — "am I frozen"
 * has to have exactly one answer, or lifting the table-wide lock would
 * quietly release someone the DM had singled out.
 *
 * The DM is never frozen by either. A DM who locked themselves out of their
 * own board would have no way back in.
 */
export function moveLockedFor(campaignId: string, userId: string): boolean {
  return campaigns.moveLocked(campaignId) || campaigns.memberLock(campaignId, userId, 'move');
}

export function rollLockedFor(campaignId: string, userId: string): boolean {
  return campaigns.rollLocked(campaignId) || campaigns.memberLock(campaignId, userId, 'roll');
}

/**
 * Ask before throwing dice. Returns false — and tells the player why — when
 * the DM is holding their dice.
 *
 * This guards the PLAYER'S OWN roll requests, at the socket handlers a player
 * can trigger. It deliberately does not guard rolls the server makes as a
 * consequence of something else (poison ticking on a turn start, a mishap, an
 * NPC's own attack): those are the world acting, not the player rolling, and
 * silently dropping one mid-sequence would leave damage applied with no card
 * to show for it.
 */
export function rollGate(socket: Socket): boolean {
  const d = sdata(socket);
  if (!d.campaignId) return false;
  if (d.role === 'dm') return true;
  if (!rollLockedFor(d.campaignId, d.userId)) return true;
  emitError(socket, '🎲 The DM is holding the dice — you cannot roll right now.');
  return false;
}
