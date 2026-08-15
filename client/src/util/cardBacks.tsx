import type { CSSProperties } from 'react';
import type { CardBackSpec } from 'shared';
import { normalizeCardBack } from 'shared';

/**
 * What a card back looks like.
 *
 * The STRUCTURE — which pattern, which border, which colors — lives in shared
 * and rides the wire with every deal, validated by the server. This file is
 * the paint: each GEOMETRY is a function of the spec's three colors, each
 * border a function of one, so the same spec renders identically on every
 * screen at the table and a player's "endless choices" are still only ever
 * five colors and two ids deep. The sixteen designs in shared are palettes
 * over these seven geometries — fewer looms, more cloth.
 *
 * Every design keeps the same geometry (96×134, border inside the box, the
 * classic drop shadow) so a hand of mixed backs still reads as one deck of
 * cards — different jackets, same book.
 */
type C3 = { p: string; s: string; a: string };

/**
 * The seven geometries, each painted with the whole palette. Layers are
 * listed top-first; the last entry is the ground color, so every design has
 * something under it whatever the overlays do.
 */
const PATTERN_CSS: Record<string, (c: C3) => string> = {
  // Diagonal stripes in the two main colors, tied off with a thin accent
  // pinstripe — the classic card back, which was always more than two colors.
  stripes: ({ p, s, a }) =>
    `repeating-linear-gradient(45deg, transparent 0 20px, ${hexA(a, 0.85)} 20px 22px, transparent 22px 24px),`
    + ` repeating-linear-gradient(45deg, ${p} 0 6px, ${s} 6px 12px), ${p}`,
  // A tartan: broad secondary bands both ways, a thin accent thread through
  // them, over the primary ground.
  plaid: ({ p, s, a }) =>
    `repeating-linear-gradient(0deg, transparent 0 16px, ${hexA(a, 0.8)} 16px 17px, transparent 17px 26px),`
    + ` repeating-linear-gradient(90deg, transparent 0 16px, ${hexA(a, 0.8)} 16px 17px, transparent 17px 26px),`
    + ` repeating-linear-gradient(0deg, transparent 0 4px, ${hexA(s, 0.7)} 4px 12px, transparent 12px 26px),`
    + ` repeating-linear-gradient(90deg, transparent 0 4px, ${hexA(s, 0.7)} 4px 12px, transparent 12px 26px), ${p}`,
  // Pearls on a ground: secondary dots in ranks, smaller accent dots between.
  dots: ({ p, s, a }) =>
    `radial-gradient(circle, ${hexA(a, 0.75)} 0 1.5px, transparent 1.5px 100%) 9px 9px / 18px 18px,`
    + ` radial-gradient(circle, ${hexA(s, 0.85)} 0 3.5px, transparent 3.5px 100%) 0 0 / 18px 18px, ${p}`,
  // A rose window: accent hub, ringed and rayed, over rippling rings of the
  // two main colors. The one design that is a PICTURE rather than a fabric.
  medallion: ({ p, s, a }) =>
    `radial-gradient(circle at 50% 44%, ${a} 0 7px, transparent 7px 100%),`
    + ` radial-gradient(circle at 50% 44%, transparent 0 12px, ${hexA(a, 0.9)} 12px 14px, transparent 14px 24px, ${hexA(a, 0.55)} 24px 25px, transparent 25px 100%),`
    + ` repeating-conic-gradient(from 0deg at 50% 44%, ${hexA(a, 0.28)} 0deg 6deg, transparent 6deg 30deg),`
    + ` repeating-radial-gradient(circle at 50% 44%, ${s} 0 5px, ${p} 5px 14px), ${p}`,
  // A sunburst from just above centre, banded by an accent halo.
  rays: ({ p, s, a }) =>
    `radial-gradient(circle at 50% 42%, transparent 0 24px, ${hexA(a, 0.9)} 24px 26px, transparent 26px 46px, ${hexA(a, 0.45)} 46px 47px, transparent 47px 100%),`
    + ` radial-gradient(circle at 50% 42%, ${a} 0 5px, transparent 5px 100%),`
    + ` repeating-conic-gradient(from 8deg at 50% 42%, ${p} 0deg 15deg, ${s} 15deg 30deg), ${p}`,
  // Diamond checks with an accent thread on the diagonal.
  harlequin: ({ p, s, a }) =>
    `repeating-linear-gradient(45deg, transparent 0 16px, ${hexA(a, 0.7)} 16px 17px, transparent 17px 18px),`
    + ` repeating-conic-gradient(from 45deg, ${p} 0deg 90deg, ${s} 90deg 180deg) 0 0 / 18px 18px, ${p}`,
  // All three colors in one wash, with a sheen across the top corner.
  sweep: ({ p, s, a }) =>
    `linear-gradient(205deg, ${hexA('#ffffff', 0.14)} 0%, transparent 38%),`
    + ` linear-gradient(160deg, ${p} 0%, ${s} 45%, ${a} 100%)`,
};

/** Border geometry, given its resolved color. Kept inside the same box
 *  (border-box) so a Heavy card and a Hairline card stay the same size. */
const BORDER_CSS: Record<string, (c: string) => CSSProperties> = {
  clean: (c) => ({ border: `3px solid ${c}` }),
  hairline: (c) => ({ border: `1px solid ${c}` }),
  heavy: (c) => ({ border: `6px solid ${c}` }),
  double: (c) => ({ border: `5px double ${c}` }),
  dashed: (c) => ({ border: `3px dashed ${c}` }),
  dotted: (c) => ({ border: `3px dotted ${c}` }),
  ridge: (c) => ({ border: `5px ridge ${c}` }),
  groove: (c) => ({ border: `5px groove ${c}` }),
  frame: (c) => ({ border: `2px solid ${c}`, boxShadow: `inset 0 0 0 4px transparent, inset 0 0 0 6px ${c}` }),
  twinframe: (c) => ({ border: `2px solid ${c}`, boxShadow: `inset 0 0 0 4px transparent, inset 0 0 0 5px ${c}, inset 0 0 0 9px transparent, inset 0 0 0 10px ${c}` }),
  glow: (c) => ({ border: `2px solid ${c}`, boxShadow: `0 0 10px 2px ${hexA(c, 0.75)}` }),
  bevel: (c) => ({ border: `5px outset ${c}` }),
  stitched: (c) => ({ border: `3px solid ${c}`, boxShadow: `inset 0 0 0 2px transparent, inset 0 0 0 3px ${hexA(c, 0.55)}` }),
  deco: (c) => ({ border: `3px solid ${c}`, boxShadow: `inset 0 0 0 5px transparent, inset 0 0 0 7px ${c}, inset 0 0 0 8px transparent`, borderRadius: 2 }),
  rounded: (c) => ({ border: `3px solid ${c}`, borderRadius: 18 }),
  sharp: (c) => ({ border: `3px solid ${c}`, borderRadius: 0 }),
};

/** "#rrggbb" + alpha → rgba(), so patterns can wash without a color table. */
function hexA(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

/**
 * The whole look for a spec (or anything older that stood where one should
 * be). This is the ONLY place a spec becomes CSS, so the picker's minis, the
 * Bio tab's preview, the deck button and every face-down card at the table
 * can never disagree about what a back looks like.
 */
export function cardBackCss(raw: unknown): CSSProperties {
  const spec: CardBackSpec = normalizeCardBack(raw);
  const paint = PATTERN_CSS[spec.pattern] ?? PATTERN_CSS.stripes;
  const frame = BORDER_CSS[spec.border] ?? BORDER_CSS.clean;
  const borderColor = spec.borderColor || spec.primary;
  return {
    background: paint({ p: spec.primary, s: spec.secondary, a: spec.accent }),
    boxSizing: 'border-box',
    ...frame(borderColor),
  };
}

/** A face-down card wearing the given back. Extra classes ride through so the
 *  flip and deck-button styling keep working unchanged. */
export function CardBackView({ back, className }: { back?: unknown; className?: string }) {
  return <div className={className ?? 'card-back'} style={cardBackCss(back)} />;
}
