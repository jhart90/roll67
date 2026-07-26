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

/**
 * Black or white text, whichever stays legible on the given background.
 * Uses relative luminance rather than a naive brightness average, so a
 * saturated yellow correctly gets black text and a mid blue gets white.
 */
export function readableOn(hex: string): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // 0.40 rather than a true contrast-ratio crossover (~0.18): it keeps white
  // on the mid blues and reds, where white reads better than the raw ratio
  // suggests, while still flipping the pale tans and yellows to black.
  return L > 0.40 ? '#10131a' : '#ffffff';
}
