import type { MemberInfo } from '../types.js';

const PILL_COLORS = ['#6c9bd2', '#d26c6c', '#7ed28a', '#d2a56c', '#b06cd2', '#6cd2c8', '#d2d26c', '#d26cb0'];

/** Deterministic fallback color for a user who hasn't picked a custom one
 *  (same hash for everyone, so it's stable across clients/sessions). */
export function defaultColorFor(userId: string): string {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PILL_COLORS[hash % PILL_COLORS.length];
}

/** The color actually shown for a member: their custom pick, else the
 *  deterministic default. Single source of truth for the presence dot, chat
 *  name highlighting, the turn banner, and a new token's starting colour —
 *  which is why it lives in shared rather than the client. */
export function playerColorFor(member: Pick<MemberInfo, 'userId' | 'playerColor'>): string {
  return member.playerColor ?? defaultColorFor(member.userId);
}

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The same colour, lifted until it can be seen as INK on a dark panel.
 *
 * A token colour is chosen to read as a filled SHAPE against a lit map, where
 * near-black is a perfectly good pick. As a glyph on dark chrome it vanishes,
 * so anything under the floor gets brightened.
 *
 * Brightened by scaling the channels up together, not by blending toward
 * white: a dark red scaled becomes a bright red, whereas a dark red mixed with
 * white becomes pink-grey — the hue is the whole point of showing the colour
 * at all, and a white blend is what destroys it first.
 */
export function inkOnDark(hex: string, floor = 0.16): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  if (luminance(hex) >= floor) return hex;
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const toHex = (v: number[]) => `#${v.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
  // Black, and the near-blacks. Scaling these would magnify a chance 9-point
  // channel difference into a confident light blue — #14171d is not blue, it
  // is black with rounding on it. Nothing to preserve, so: grey.
  if (Math.max(...rgb) - Math.min(...rgb) < 20) return '#9aa1b3';
  const scaled = rgb.map((c) => Math.min(255, c * (255 / Math.max(...rgb))));
  const out = toHex(scaled);
  if (luminance(out) >= floor) return out;
  // A saturated colour whose brightest channel is still dim (a deep pure blue)
  // can top out below the floor; lift the rest of the way with white.
  const mix = Math.min(0.6, (floor - luminance(out)) / floor);
  return toHex(scaled.map((c) => c + (255 - c) * mix));
}
