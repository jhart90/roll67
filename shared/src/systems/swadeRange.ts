// SWADE range bands, in one place so the shooter's on-screen ruler and the
// server's to-hit penalty can never disagree about what "Medium" means.
//
// A weapon lists ONE range: its Short. Medium is twice that at −2, Long four
// times at −4, and Extreme sixteen times at −8 — and Extreme is only
// reachable while Aiming. A thrown weapon (a grenade) has no Extreme band at
// all: you cannot lob a grenade to the horizon, so past Long it is simply out
// of range.

export type SwadeBand = 'short' | 'medium' | 'long' | 'extreme' | 'out';

export interface RangeReading {
  band: SwadeBand;
  /** Modifier this band applies to the attack roll (0, −2, −4, −8). */
  penalty: number;
  /** Human label for the ruler, e.g. "Medium Range". */
  label: string;
  /** False when the shot cannot be attempted at all from here. */
  reachable: boolean;
  /** Why not, when it isn't reachable. */
  reason?: string;
}

/** Band multipliers on the weapon's listed (Short) range. */
export const SWADE_BAND_MULTIPLIER = { short: 1, medium: 2, long: 4, extreme: 16 } as const;

/**
 * Which band a shot falls in.
 *
 * `shortHexes` is the weapon's listed range in hexes. `aiming` opens the
 * Extreme band. `thrown` marks a grenade — no Extreme, ever.
 */
export function swadeRangeBand(
  distHexes: number, shortHexes: number, opts: { aiming?: boolean; thrown?: boolean } = {},
): RangeReading {
  const { aiming = false, thrown = false } = opts;
  if (!(shortHexes > 0)) {
    return { band: 'short', penalty: 0, label: 'In reach', reachable: true };
  }
  if (distHexes <= shortHexes) {
    return { band: 'short', penalty: 0, label: 'Short Range', reachable: true };
  }
  if (distHexes <= shortHexes * SWADE_BAND_MULTIPLIER.medium) {
    return { band: 'medium', penalty: -2, label: 'Medium Range', reachable: true };
  }
  if (distHexes <= shortHexes * SWADE_BAND_MULTIPLIER.long) {
    return { band: 'long', penalty: -4, label: 'Long Range', reachable: true };
  }
  if (thrown) {
    return {
      band: 'out', penalty: 0, label: 'Out of range', reachable: false,
      reason: `Too far to throw — a thrown weapon reaches Long range (${shortHexes * SWADE_BAND_MULTIPLIER.long} tiles) and no further.`,
    };
  }
  if (distHexes <= shortHexes * SWADE_BAND_MULTIPLIER.extreme) {
    return {
      band: 'extreme', penalty: -8, label: 'Extreme Range', reachable: aiming,
      ...(aiming ? {} : { reason: 'Extreme range needs a whole turn spent Aiming.' }),
    };
  }
  return { band: 'out', penalty: 0, label: 'Out of range', reachable: false, reason: 'Beyond even Extreme range.' };
}

/** The furthest a weapon can reach at all, in hexes. */
export function swadeMaxRangeHexes(shortHexes: number, opts: { aiming?: boolean; thrown?: boolean } = {}): number {
  if (!(shortHexes > 0)) return 0;
  if (opts.thrown) return shortHexes * SWADE_BAND_MULTIPLIER.long;
  return shortHexes * (opts.aiming ? SWADE_BAND_MULTIPLIER.extreme : SWADE_BAND_MULTIPLIER.long);
}
