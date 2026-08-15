import type { CSSProperties } from 'react';
import { CARD_BACKS } from 'shared';

/**
 * What each of the sixteen card backs looks like.
 *
 * The ids and names live in shared — the server speaks them, because a back
 * rides with every deal so the table can tell whose card is whose while it is
 * still face down. The LOOKS live here: a pattern is CSS gradients and a
 * border, and the server has no more use for that than for a die's color.
 *
 * Every design keeps the same geometry as the classic (96×134, 3px light
 * border, the same drop shadow) so a hand of mixed backs still reads as one
 * deck of cards — different jackets, same book.
 */
const LOOKS: Record<string, CSSProperties> = {
  classic: {
    borderColor: '#e8e2d2',
    background: 'repeating-linear-gradient(45deg, #7c1f28 0 6px, #641820 6px 12px), #7c1f28',
  },
  midnight: {
    borderColor: '#cdd6ea',
    background: 'repeating-linear-gradient(-45deg, #1d2c52 0 6px, #162240 6px 12px), #1d2c52',
  },
  forest: {
    borderColor: '#d8e6d0',
    background:
      'repeating-linear-gradient(60deg, transparent 0 9px, rgba(255,255,255,0.08) 9px 10px),'
      + ' repeating-linear-gradient(-60deg, transparent 0 9px, rgba(0,0,0,0.22) 9px 10px), #1f4d2c',
  },
  royal: {
    borderColor: '#e4d3f0',
    background:
      'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.12) 0 3px, transparent 3px 100%) 0 0 / 16px 16px,'
      + ' #4a2170',
  },
  goldfil: {
    borderColor: '#f2e3b2',
    background:
      'repeating-linear-gradient(0deg, transparent 0 7px, rgba(240,208,110,0.35) 7px 8px),'
      + ' repeating-linear-gradient(90deg, transparent 0 7px, rgba(240,208,110,0.35) 7px 8px), #5a4210',
  },
  steel: {
    borderColor: '#dfe3e8',
    background: 'repeating-linear-gradient(90deg, #4c545e 0 3px, #3d444d 3px 6px), #454c55',
  },
  ember: {
    borderColor: '#f4d6bc',
    background:
      'repeating-linear-gradient(45deg, #8a3b10 0 8px, #6d2b0a 8px 16px),'
      + ' repeating-linear-gradient(-45deg, transparent 0 8px, rgba(255,170,60,0.18) 8px 16px), #8a3b10',
  },
  ocean: {
    borderColor: '#cfe6ea',
    // Overlapping half-circles: fish scales.
    background:
      'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.14) 0 6px, transparent 6px 100%) 0 0 / 14px 14px,'
      + ' radial-gradient(circle at 0% 50%, rgba(0,0,0,0.18) 0 6px, transparent 6px 100%) 0 0 / 14px 14px, #14536b',
  },
  rose: {
    borderColor: '#f3d9de',
    background:
      'repeating-linear-gradient(45deg, transparent 0 10px, rgba(255,255,255,0.10) 10px 11px),'
      + ' repeating-linear-gradient(-45deg, transparent 0 10px, rgba(255,255,255,0.10) 10px 11px), #8c2f49',
  },
  jade: {
    borderColor: '#d5ead9',
    background: 'repeating-linear-gradient(0deg, #14624a 0 5px, #0f5340 5px 10px), #14624a',
  },
  onyx: {
    borderColor: '#c9c9d4',
    // A sparse starfield: two offset dot grids on near-black.
    background:
      'radial-gradient(circle, rgba(255,255,255,0.5) 0 1px, transparent 1px 100%) 0 0 / 22px 26px,'
      + ' radial-gradient(circle, rgba(255,255,255,0.28) 0 1px, transparent 1px 100%) 11px 13px / 22px 26px, #14141c',
  },
  copper: {
    borderColor: '#eed9c8',
    background:
      'repeating-linear-gradient(45deg, #7a4a24 0 5px, #64391a 5px 10px) 0 0 / 20px 20px,'
      + ' repeating-linear-gradient(-45deg, rgba(0,0,0,0.12) 0 5px, transparent 5px 10px), #7a4a24',
  },
  ivory: {
    borderColor: '#b8a988',
    background:
      'radial-gradient(circle at 50% 50%, rgba(148,124,80,0.25) 0 4px, transparent 4px 100%) 0 0 / 18px 18px,'
      + ' radial-gradient(circle at 0% 0%, rgba(148,124,80,0.18) 0 4px, transparent 4px 100%) 9px 9px / 18px 18px, #ede3cc',
  },
  neon: {
    borderColor: '#d8f6ff',
    background:
      'repeating-linear-gradient(0deg, transparent 0 11px, rgba(0,255,214,0.4) 11px 12px),'
      + ' repeating-linear-gradient(90deg, transparent 0 11px, rgba(255,0,190,0.35) 11px 12px), #101024',
  },
  blood: {
    borderColor: '#e7cdd0',
    // Diamond harlequin in two reds.
    background:
      'repeating-conic-gradient(from 45deg, #5c0e16 0deg 90deg, #8c1b26 90deg 180deg) 0 0 / 18px 18px, #5c0e16',
  },
  aurora: {
    borderColor: '#d9e8ef',
    background: 'linear-gradient(160deg, #123c46 0%, #1c6b57 35%, #3f5f9e 70%, #57306e 100%)',
  },
};

/** The classic look, for an id we do not recognise (older server, bad data). */
const FALLBACK = LOOKS.classic;

export const CARD_BACK_CHOICES = CARD_BACKS;

/** A face-down card wearing the given back. Extra classes ride through so the
 *  flip and deck-button styling keep working unchanged. */
export function CardBackView({ back, className }: { back?: string | null; className?: string }) {
  return <div className={className ?? 'card-back'} style={LOOKS[back ?? ''] ?? FALLBACK} />;
}

/** Style pair for elements that must BE the card back (the deck button). */
export function cardBackStyle(back?: string | null): CSSProperties {
  return LOOKS[back ?? ''] ?? FALLBACK;
}
