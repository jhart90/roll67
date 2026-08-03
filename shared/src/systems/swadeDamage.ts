// The actual SWADE damage ladder: Healthy → Shaken → Wounds → Incapacitated.
// Damage is compared to Toughness — nothing here touches an HP pool.
//
//   total < Toughness            → no effect
//   total ≥ Toughness (success)  → Shaken
//   each raise (each full +4)    → 1 Wound (and Shaken)
//   Shaken again by damage       → 1 Wound (the "double Shaken" rule)
//
// Extras drop at their first Wound. Wild Cards carry up to MAX_WOUNDS, each
// giving −1 to trait rolls (woundPenalty already reads sheet.wounds); wounds
// beyond that incapacitate. A Wild Card may spend a Benny to Soak: a Vigor
// roll where the success and each raise remove one of THIS hit's wounds, and
// soaking all of them shakes off the Shaken too.

/** Wounds a Wild Card can carry before the next one incapacitates. */
export const MAX_WOUNDS = 3;

export interface SwadeHitResult {
  /** The hit at least Shakes the target (any success). */
  shaken: boolean;
  /** Wounds dealt by THIS hit (raises, plus the double-Shaken wound). */
  woundsDealt: number;
  /** Total wounds on the target after the hit, capped at MAX_WOUNDS + 1. */
  woundsAfter: number;
  incapacitated: boolean;
  /** Chat-ready description of what the hit did. */
  summary: string;
}

export function swadeDamageOutcome(
  damageTotal: number,
  toughness: number,
  opts: { alreadyShaken: boolean; wildCard: boolean; currentWounds: number },
): SwadeHitResult {
  const margin = damageTotal - toughness;
  if (margin < 0) {
    return {
      shaken: false, woundsDealt: 0, woundsAfter: opts.currentWounds, incapacitated: false,
      summary: `no effect (${damageTotal} vs Toughness ${toughness})`,
    };
  }
  const raises = Math.floor(margin / 4);
  // A success with no raise Shakes — and re-Shaking someone already Shaken
  // with damage upgrades to a Wound.
  const woundsDealt = raises > 0 ? raises : (opts.alreadyShaken ? 1 : 0);
  const woundsAfter = Math.min(opts.currentWounds + woundsDealt, MAX_WOUNDS + 1);
  const incapacitated = opts.wildCard ? woundsAfter > MAX_WOUNDS : woundsDealt > 0;

  const parts: string[] = [];
  if (woundsDealt > 0) parts.push(`${woundsDealt} Wound${woundsDealt === 1 ? '' : 's'}`);
  else parts.push(opts.alreadyShaken ? 'Shaken (again)' : 'Shaken');
  if (woundsDealt > 0 && !incapacitated) parts.push(`now ${woundsAfter}, Shaken`);
  if (incapacitated) parts.push('INCAPACITATED');
  return {
    shaken: true, woundsDealt, woundsAfter, incapacitated,
    summary: `${parts.join(' — ')} (${damageTotal} vs Toughness ${toughness})`,
  };
}

/** Successes on a trait roll vs TN 4: the success plus one per raise. */
export function soakSuccesses(vigorTotal: number): number {
  if (vigorTotal < 4) return 0;
  return 1 + Math.floor((vigorTotal - 4) / 4);
}

/**
 * Healing a wound-model target: our heal actions roll an amount, so every
 * full 4 points restores a wound (at least one for any positive heal), and
 * any healing steadies a Shaken target.
 */
export function swadeHealOutcome(amount: number, currentWounds: number): { woundsHealed: number; woundsAfter: number } {
  if (amount <= 0 || currentWounds <= 0) return { woundsHealed: 0, woundsAfter: currentWounds };
  const healed = Math.min(currentWounds, Math.max(1, Math.floor(amount / 4)));
  return { woundsHealed: healed, woundsAfter: currentWounds - healed };
}

/** One entry from SWADE's Injury Table (d6 location, d6 sub-effect). */
export interface InjuryResult { location: string; effect: string }

/**
 * The Injury Table: where the blow landed and what it costs. `d6` supplies
 * the die faces (1–6) so the caller decides the randomness source.
 */
export function rollInjuryTable(d6: () => number): InjuryResult {
  const first = d6();
  if (first === 1) return { location: 'Unmentionables', effect: 'hit somewhere best left unmentioned — no permanent trait loss, but it hurts' };
  if (first === 2) return { location: 'Arm', effect: 'an arm is unusable until healed' };
  if (first === 3) {
    const sub = d6();
    if (sub <= 2) return { location: 'Guts (broken)', effect: 'Agility reduced a die type (minimum d4)' };
    if (sub <= 4) return { location: 'Guts (battered)', effect: 'Vigor reduced a die type (minimum d4)' };
    return { location: 'Guts (busted)', effect: 'Strength reduced a die type (minimum d4)' };
  }
  if (first === 4) return { location: 'Leg', effect: 'Pace −1 and the running die drops a die type' };
  const sub = d6();
  if (sub <= 2) return { location: 'Head (scarred)', effect: 'an ugly scar — −1 Persuasion' };
  if (sub <= 4) return { location: 'Head (blinded)', effect: 'blinded in one or both eyes — −2 on tasks needing vision' };
  return { location: 'Head (brain damage)', effect: 'Smarts reduced a die type (minimum d4)' };
}
