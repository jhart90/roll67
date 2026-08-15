// Central permission rules. Server handlers call these; the client uses the
// same functions to decide what UI to show.

import type { Character, Role, Token } from './types.js';

export function isDm(role: Role): boolean {
  return role === 'dm';
}

/** Players may move only tokens bound to a character they own; DM moves anything. */
/**
 * `locked` is the DM's table-wide movement lock: while it is on, nobody but
 * the DM moves anything. It is a parameter here — rather than a check at each
 * call site — because this function IS the answer to "may this person move
 * this token", and a lock that half the callers forgot to ask about would be
 * a lock in name only.
 */
export function canMoveToken(role: Role, userId: string, token: Token, character: Character | undefined, locked = false): boolean {
  if (isDm(role)) return true;
  if (locked) return false;
  if (token.layer === 'gm') return false;
  return !!character && character.ownerUserId === userId && token.characterId === character.id;
}

export function canEditMap(role: Role): boolean {
  return isDm(role);
}

export function canEditCharacter(role: Role, userId: string, character: Character): boolean {
  if (isDm(role)) return true;
  return character.ownerUserId === userId;
}

/** NPC characters (no owner) are DM-only. */
export function canControlCharacter(role: Role, userId: string, character: Character): boolean {
  if (isDm(role)) return true;
  return character.ownerUserId === userId;
}

export function canToggleDoor(role: Role): boolean {
  // Players may toggle doors too (server additionally checks adjacency).
  return true;
}
