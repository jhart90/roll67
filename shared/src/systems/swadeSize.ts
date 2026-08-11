/**
 * SWADE Size and Scale.
 *
 * A creature's Size is a single number (−4 for a mouse up to 20 for a kaiju).
 * Everything else on the book's Size Table follows from it:
 *
 *   Size          Scale   Extra Wounds   Band
 *   −4            −6      0              Tiny
 *   −3            −4      0              Very Small
 *   −2            −2      0              Small
 *   −1 … 3         0      0              Normal
 *    4 … 7        +2      1              Large
 *    8 … 11       +4      2              Huge
 *   12 … 20       +6      3              Gargantuan
 *
 * Size is also the Toughness bonus, which is why the table's first column is
 * headed "Size / Toughness Bonus".
 */

export interface ScaleBand {
  /** Lowest Size in the band. */
  min: number;
  scale: number;
  label: string;
  /** Wounds this band carries beyond the normal three. */
  extraWounds: number;
}

/** Highest band first, so the first match wins. */
export const SCALE_BANDS: ScaleBand[] = [
  { min: 12, scale: 6, label: 'Gargantuan', extraWounds: 3 },
  { min: 8, scale: 4, label: 'Huge', extraWounds: 2 },
  { min: 4, scale: 2, label: 'Large', extraWounds: 1 },
  { min: -1, scale: 0, label: 'Normal', extraWounds: 0 },
  { min: -2, scale: -2, label: 'Small', extraWounds: 0 },
  { min: -3, scale: -4, label: 'Very Small', extraWounds: 0 },
  { min: -4, scale: -6, label: 'Tiny', extraWounds: 0 },
];

/** The band a Size falls in. Sizes past either end clamp to the extremes. */
export function scaleBand(size: number): ScaleBand {
  const n = Number.isFinite(size) ? Math.round(size) : 0;
  return SCALE_BANDS.find((b) => n >= b.min) ?? SCALE_BANDS[SCALE_BANDS.length - 1];
}

export const scaleFor = (size: number): number => scaleBand(size).scale;
export const scaleLabel = (size: number): string => scaleBand(size).label;
export const extraWoundsFor = (size: number): number => scaleBand(size).extraWounds;

/**
 * The attacker's to-hit modifier for the Scale difference between them.
 *
 * The book states it as two rules — the smaller creature ADDS the difference,
 * the larger SUBTRACTS it — which is the single expression
 * `targetScale − attackerScale`:
 *
 *   Tiny fairy (−6) hurling a bolt at a Huge dragon (+4): 4 − (−6) = +10.
 *   Very Small eagle (−4) attacking that Tiny fairy (−6): −6 − (−4) = −2.
 *
 * Same Scale is 0, so anything human-ish fighting anything human-ish is
 * unaffected, which is almost every roll at almost every table.
 */
export function sizeAttackMod(attackerSize: number, targetSize: number): number {
  return scaleFor(targetSize) - scaleFor(attackerSize);
}

/** Chat tag for the modifier, or null when there is nothing to say. */
export function sizeAttackTag(attackerSize: number, targetSize: number): string | null {
  const mod = sizeAttackMod(attackerSize, targetSize);
  if (mod === 0) return null;
  const from = scaleLabel(attackerSize);
  const to = scaleLabel(targetSize);
  return `${mod > 0 ? '+' : '−'}${Math.abs(mod)} Scale (${from} vs ${to})`;
}

/**
 * How many Wounds a creature carries before it goes down.
 *
 * Base is the book's three for a Wild Card and none for an Extra — an Extra
 * drops at its first Wound. Size adds on top: Large +1, Huge +2, Gargantuan
 * +3, which is what lets a Huge Extra soak two Wounds before dropping.
 *
 * A sheet may override the whole thing with `maxWoundsOverride`, so a DM can
 * hand a boss five Wounds without pretending it is Gargantuan. Zero or blank
 * means "no override" rather than "no Wounds", because a blank number field
 * reads as 0 and nobody means "dies instantly" by leaving a box empty.
 */
export function swadeWoundCap(opts: {
  wildCard: boolean;
  size: number;
  override?: number;
}): number {
  if (opts.override && opts.override > 0) return Math.floor(opts.override);
  return (opts.wildCard ? 3 : 0) + extraWoundsFor(opts.size);
}
