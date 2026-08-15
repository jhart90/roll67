import type { CSSProperties } from 'react';
import type { CardBackSpec } from 'shared';
import { normalizeCardBack } from 'shared';

/**
 * What a card back looks like.
 *
 * The STRUCTURE — which pattern, which border, which colors — lives in shared
 * and rides the wire with every deal, validated by the server. This file is
 * the paint: each pattern is a function of the spec's three colors, each
 * border a function of one, so the same spec renders identically on every
 * screen at the table and a player's "endless choices" are still only ever
 * five colors and two ids deep.
 *
 * Every design keeps the same geometry (96×134, border inside the box, the
 * classic drop shadow) so a hand of mixed backs still reads as one deck of
 * cards — different jackets, same book.
 */
type C3 = { p: string; s: string; a: string };

const PATTERN_CSS: Record<string, (c: C3) => string> = {
  classic: ({ p, s }) => `repeating-linear-gradient(45deg, ${p} 0 6px, ${s} 6px 12px), ${p}`,
  midnight: ({ p, s }) => `repeating-linear-gradient(-45deg, ${p} 0 6px, ${s} 6px 12px), ${p}`,
  forest: ({ p, s, a }) =>
    `repeating-linear-gradient(60deg, transparent 0 9px, ${hexA(a, 0.14)} 9px 10px),`
    + ` repeating-linear-gradient(-60deg, transparent 0 9px, ${hexA(s, 0.55)} 9px 10px), ${p}`,
  royal: ({ p, s }) =>
    `radial-gradient(circle at 50% 50%, ${hexA(s, 0.35)} 0 3px, transparent 3px 100%) 0 0 / 16px 16px, ${p}`,
  goldfil: ({ p, s }) =>
    `repeating-linear-gradient(0deg, transparent 0 7px, ${hexA(s, 0.4)} 7px 8px),`
    + ` repeating-linear-gradient(90deg, transparent 0 7px, ${hexA(s, 0.4)} 7px 8px), ${p}`,
  steel: ({ p, s }) => `repeating-linear-gradient(90deg, ${p} 0 3px, ${s} 3px 6px), ${p}`,
  ember: ({ p, s, a }) =>
    `repeating-linear-gradient(45deg, ${p} 0 8px, ${s} 8px 16px),`
    + ` repeating-linear-gradient(-45deg, transparent 0 8px, ${hexA(a, 0.2)} 8px 16px), ${p}`,
  ocean: ({ p, s, a }) =>
    `radial-gradient(circle at 50% 0%, ${hexA(a, 0.18)} 0 6px, transparent 6px 100%) 0 0 / 14px 14px,`
    + ` radial-gradient(circle at 0% 50%, ${hexA(s, 0.5)} 0 6px, transparent 6px 100%) 0 0 / 14px 14px, ${p}`,
  rose: ({ p, a }) =>
    `repeating-linear-gradient(45deg, transparent 0 10px, ${hexA(a, 0.16)} 10px 11px),`
    + ` repeating-linear-gradient(-45deg, transparent 0 10px, ${hexA(a, 0.16)} 10px 11px), ${p}`,
  jade: ({ p, s }) => `repeating-linear-gradient(0deg, ${p} 0 5px, ${s} 5px 10px), ${p}`,
  onyx: ({ p, s, a }) =>
    `radial-gradient(circle, ${hexA(s, 0.5)} 0 1px, transparent 1px 100%) 0 0 / 22px 26px,`
    + ` radial-gradient(circle, ${hexA(a, 0.35)} 0 1px, transparent 1px 100%) 11px 13px / 22px 26px, ${p}`,
  copper: ({ p, s }) =>
    `repeating-linear-gradient(45deg, ${p} 0 5px, ${s} 5px 10px) 0 0 / 20px 20px,`
    + ` repeating-linear-gradient(-45deg, ${hexA('#000000', 0.12)} 0 5px, transparent 5px 10px), ${p}`,
  ivory: ({ p, s }) =>
    `radial-gradient(circle at 50% 50%, ${hexA(s, 0.28)} 0 4px, transparent 4px 100%) 0 0 / 18px 18px,`
    + ` radial-gradient(circle at 0% 0%, ${hexA(s, 0.2)} 0 4px, transparent 4px 100%) 9px 9px / 18px 18px, ${p}`,
  neon: ({ p, s, a }) =>
    `repeating-linear-gradient(0deg, transparent 0 11px, ${hexA(s, 0.45)} 11px 12px),`
    + ` repeating-linear-gradient(90deg, transparent 0 11px, ${hexA(a, 0.4)} 11px 12px), ${p}`,
  blood: ({ p, s }) => `repeating-conic-gradient(from 45deg, ${p} 0deg 90deg, ${s} 90deg 180deg) 0 0 / 18px 18px, ${p}`,
  aurora: ({ p, s, a }) => `linear-gradient(160deg, ${p} 0%, ${s} 45%, ${a} 100%)`,
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
  const paint = PATTERN_CSS[spec.pattern] ?? PATTERN_CSS.classic;
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
