// The color helpers now live in shared, so the server can pick a new token's
// starting color with the same rule the client renders it by. Re-exported
// here to keep the many existing client imports pointing at one place.
export { defaultColorFor, inkOnDark, playerColorFor } from 'shared';

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
