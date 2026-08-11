import { scaleFor } from './swadeSize.js';
/**
 * SWADE Called Shots.
 *
 * The penalty comes from the SCALE OF THE TARGET ITSELF, not of the creature
 * it belongs to — a hand is a hand whether it is on a goblin or an ogre. So
 * these are fixed numbers off the Scale Modifiers table rather than anything
 * derived from the defender's Size.
 *
 * The book's worked example: destroying the eye of a Huge dragon is a Called
 * Shot against the eye, not against the dragon. If the eye is about the size
 * of a car, that is Large — +2, a BONUS — because a car is a big thing to hit
 * even if the creature carrying it is bigger still.
 */
export interface CalledShotTarget {
  id: string;
  label: string;
  /**
   * How far the part sits below its owner's own Scale, in Scale points.
   * A head is a head: on a person (Scale 0) it is -4, and on a Huge creature
   * (Scale +4) that same -4 offset lands on 0, because a Huge creature's head
   * is the size of a small car.
   *
   * For a `fixed` target this is the absolute modifier instead — a pistol is
   * pistol-sized whoever is holding it.
   */
  penalty: number;
  /** True when the thing is its own object rather than part of the creature,
   *  so its Scale does not grow with whatever is carrying it. */
  fixed?: boolean;
  /** Added to the damage total on a hit. */
  damageBonus?: number;
  /** What it does beyond the numbers, for the prompt and the chat tag. */
  note?: string;
}

export const CALLED_SHOTS: CalledShotTarget[] = [
  { id: 'head', label: 'Head or vitals', penalty: -4, damageBonus: 4,
    note: 'Hitting the head or vital organs of a living creature adds +4 damage.' },
  { id: 'face', label: 'Face (open-faced helm)', penalty: -5,
    note: 'Targeting the face of someone in an open-faced helmet bypasses the helmet’s Armor.' },
  { id: 'hand', label: 'Hand', penalty: -4,
    note: 'The target may be Disarmed.' },
  { id: 'limb', label: 'Limb', penalty: -2,
    note: 'No extra effect — limb damage is already covered by Wound and Pace penalties.' },
  { id: 'itemPistol', fixed: true, label: 'Item — pistol-sized', penalty: -4,
    note: 'Use the dimensions on the Scale table: a pistol is Very Small.' },
  { id: 'itemSword', fixed: true, label: 'Item — sword-sized (3′)', penalty: -2,
    note: 'A 3-foot sword is Small on the Scale table.' },
  { id: 'unarmoredTiny', label: 'Unarmored gap — Tiny (eye slit)', penalty: -6,
    note: 'The unprotected area of an armored target. A helmet’s eye slit is Tiny.' },
  { id: 'unarmoredVerySmall', label: 'Unarmored gap — Very Small', penalty: -4,
    note: 'A missing scale on a Huge dragon, say — the gap’s own Scale, not the creature’s.' },
];

/**
 * The actual modifier for aiming at this part of a creature of this Size.
 *
 * The book is explicit that a Called Shot uses the Scale of the TARGET PART,
 * "not the creature it's part of" — so this REPLACES the usual Scale
 * difference rather than stacking with it. Attacking a Huge creature normally
 * is +4; aiming at its limb is +2, which is still easier than a person's limb
 * at -2 but harder than just hitting the creature.
 */
export function calledShotPenalty(target: CalledShotTarget, defenderSize: number): number {
  if (target.fixed) return clampCalledShotPenalty(target.penalty);
  return clampCalledShotPenalty(scaleFor(defenderSize) + target.penalty);
}

export function calledShotById(id: string): CalledShotTarget | undefined {
  return CALLED_SHOTS.find((c) => c.id === id);
}

/** What the chat card says about a Called Shot. */
export function calledShotTag(label: string, penalty: number): string {
  const sign = penalty >= 0 ? '+' : '−';
  return `${sign}${Math.abs(penalty)} Called Shot (${label})`;
}

/** Clamp a hand-entered modifier to the Scale table's own range. */
export function clampCalledShotPenalty(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-8, Math.min(6, Math.round(n)));
}
