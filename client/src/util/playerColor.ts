import type { MemberInfo } from 'shared';

const PILL_COLORS = ['#6c9bd2', '#d26c6c', '#7ed28a', '#d2a56c', '#b06cd2', '#6cd2c8', '#d2d26c', '#d26cb0'];

/** Deterministic fallback color for a user who hasn't picked a custom one
 *  (same hash for everyone, so it's stable across clients/sessions). */
export function defaultColorFor(userId: string): string {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PILL_COLORS[hash % PILL_COLORS.length];
}

/** The color actually shown for a member: their custom pick, else the
 *  deterministic default. Single source of truth for the presence dot AND
 *  chat name highlighting, so they always agree. */
export function playerColorFor(member: Pick<MemberInfo, 'userId' | 'playerColor'>): string {
  return member.playerColor ?? defaultColorFor(member.userId);
}
