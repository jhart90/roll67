// SWADE vehicles: the stat block, and what damage does to a machine.
//
// A vehicle is not a creature wearing a hull. It is never Shaken — metal has
// no nerve to rattle — so a hit that would Shake a person instead threatens
// control of the thing, and its Wounds arrive with Critical Hits: the wheels,
// the engine, the crew inside. It carries three Wounds before it is Wrecked,
// more for the big ones, which is the same ladder Size already grants a
// Wild Card — one of the places the book quietly reuses its own arithmetic.

import type { SheetData } from '../types.js';
import { num, str } from './types.js';
import { extraWoundsFor } from './swadeSize.js';

/** A sheet that is a machine, not a creature. Set by the vehicle compendium
 *  entries and by the DM ticking the box; flips the sheet to the vehicle tab
 *  set and damage onto the vehicle ladder. */
export function isVehicle(sheet: SheetData): boolean {
  return sheet.vehicle === true;
}

/**
 * Wounds a vehicle takes before it is Wrecked: three, plus what its Size band
 * grants — Large 4, Huge 5, Gargantuan 6, the book's own Wrecked table. This
 * is exactly the Wild Card cap, which is why it reuses that arithmetic.
 */
export function vehicleWoundCap(sheet: SheetData): number {
  const override = num(sheet, 'maxWoundsOverride', 0);
  if (override > 0) return Math.floor(override);
  return 3 + extraWoundsFor(num(sheet, 'size', 0));
}

/**
 * Effective Handling: the plated number, minus one per Wound (to −4), minus
 * one per Guidance/Traction critical hit taken. This is the modifier on every
 * maneuvering roll the driver makes.
 */
export function vehicleHandling(sheet: SheetData): number {
  const base = num(sheet, 'handling', 0);
  const wounds = Math.max(0, num(sheet, 'wounds', 0));
  const guidance = Math.max(0, num(sheet, 'guidanceHits', 0));
  return Math.max(-4, base - wounds - guidance);
}

/** Top Speed after Locomotion critical hits: −10% of the base per hit. */
export function vehicleTopSpeed(sheet: SheetData): number {
  const base = num(sheet, 'topSpeed', 0);
  const hits = Math.max(0, num(sheet, 'locomotionHits', 0));
  return Math.max(0, Math.round(base - base * 0.1 * hits));
}

/**
 * A vehicle's Parry: 2, plus half the die its DRIVER manoeuvres with.
 *
 * A machine has no Fighting skill of its own — what makes a car hard to hit
 * at speed is the person at the wheel, so the number moves with them. An
 * empty parked one is Parry 2, which is what makes a stationary vehicle a
 * barn door, correctly.
 *
 * Takes the die's SIDES rather than the driver's sheet, because this module
 * is imported by the SWADE schema and must not reach back into it.
 */
export function vehicleParry(driverManeuverDie: number): number {
  return 2 + Math.floor(Math.max(0, driverManeuverDie) / 2);
}

/** "1+5" — crew, then the passengers it can carry beyond them. */
export function vehicleSeats(sheet: SheetData): number {
  return Math.max(1, num(sheet, 'crew', 1) + num(sheet, 'passengers', 0));
}

/** The maneuvering skill this kind of vehicle answers to. */
export const VEHICLE_KINDS = ['ground', 'watercraft', 'aircraft', 'spacecraft'] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];
export function maneuveringSkillFor(sheet: SheetData): string {
  const kind = str(sheet, 'vehicleKind', 'ground');
  return kind === 'watercraft' ? 'Boating'
    : kind === 'aircraft' || kind === 'spacecraft' ? 'Piloting'
      : 'Driving';
}

// ---------- the two 2d6 tables ----------

export interface OutOfControlResult {
  roll: number;
  label: string;
  effect: string;
  /** Wounds the vehicle takes (rolled where the table says d4). */
  vehicleWounds: number;
  /** Rolls on the Vehicle Critical Hits table this result adds. */
  crits: number;
  /** Condition landed on the vehicle AND everyone aboard. */
  condition?: 'distracted' | 'vulnerable';
}

/**
 * Out of Control (2d6). Damage from one of these never triggers another —
 * the caller must not feed the collision Wounds back through the ladder.
 */
export function rollOutOfControl(rng: () => number = Math.random): OutOfControlResult {
  const d6 = () => 1 + Math.floor(rng() * 6);
  const roll = d6() + d6();
  if (roll === 2) {
    return {
      roll, label: 'Major Collision', vehicleWounds: 1 + Math.floor(rng() * 4), crits: 1, condition: 'distracted',
      effect: 'Everyone in the vehicle is Distracted. It takes d4 Wounds and one Critical Hit.',
    };
  }
  if (roll <= 4) {
    return {
      roll, label: 'Minor Collision', vehicleWounds: 1, crits: 1,
      effect: 'The vehicle takes a Wound and a Critical Hit.',
    };
  }
  if (roll <= 9) {
    return {
      roll, label: 'Distracted', vehicleWounds: 0, crits: 0, condition: 'distracted',
      effect: 'The vehicle spins, skids or stalls — everyone on board is Distracted until the end of their next turn.',
    };
  }
  if (roll <= 11) {
    return {
      roll, label: 'Vulnerable', vehicleWounds: 0, crits: 0, condition: 'vulnerable',
      effect: 'The vehicle and everyone on board are Vulnerable until the end of their next turn.',
    };
  }
  return {
    roll, label: 'Glitch', vehicleWounds: 0, crits: 1,
    effect: 'Something is jarred loose — the vehicle suffers a Critical Hit (Crew results are rerolled).',
  };
}

export interface VehicleCritResult {
  roll: number;
  label: string;
  effect: string;
  /** The sheet field this crit accumulates on, if any. */
  patchField?: 'guidanceHits' | 'locomotionHits';
  /** The remainder of the damage lands on a crew member (GM adjudicates who). */
  crewHit?: boolean;
  /** A random weapon is destroyed (falls back to Chassis when unarmed). */
  weaponHit?: boolean;
}

/** Vehicle Critical Hits (2d6) — one roll per Wound-dealing hit, not per Wound. */
export function rollVehicleCrit(rng: () => number = Math.random, opts: { rerollCrew?: boolean } = {}): VehicleCritResult {
  const d6 = () => 1 + Math.floor(rng() * 6);
  let roll = d6() + d6();
  // The Glitch result jars systems loose but hurts nobody: Crew rerolls.
  while (opts.rerollCrew && roll >= 9 && roll <= 10) roll = d6() + d6();
  if (roll === 2) return { roll, label: 'Scratch and Dent', effect: 'The hit scratches paint and passes clean through — no permanent damage.' };
  if (roll === 3) return { roll, label: 'Guidance / Traction', effect: 'Wheels, tracks or rudder hit: Handling −1 (to a maximum of −4).', patchField: 'guidanceHits' };
  if (roll <= 5) return { roll, label: 'Locomotion', effect: 'The engine, sails or drive is hit: Top Speed −10% of base.', patchField: 'locomotionHits' };
  if (roll <= 8) return { roll, label: 'Chassis', effect: 'The vehicle takes a hit in the body — no special effect.' };
  if (roll <= 10) return { roll, label: 'Crew', effect: 'The hit finds someone inside: subtract the vehicle’s Armor, the remainder lands on a crew member (GM picks or randomizes who).', crewHit: true };
  if (roll === 11) return { roll, label: 'Weapon', effect: 'A random weapon is destroyed (Chassis instead if it has none).', weaponHit: true };
  return { roll, label: 'System', effect: 'An electronic or auxiliary system is knocked out (Chassis if it has none worth naming).' };
}

// ---------- wrecks, and putting them back together ----------

/**
 * What a wreck does to the people inside it. A machine coming apart around
 * you is violence like any other, so it goes through the ordinary damage
 * ladder — Soak, Bennies, Toughness and all — rather than being a special
 * kind of death that ignores everything a character has.
 */
export const WRECK_DAMAGE = '2d6';

/**
 * Hours of work to mend one Wound on a vehicle. Repairs are not a rest: a
 * hull does not knit itself overnight, somebody has to be under it with a
 * spanner, and the time is what makes a wrecked getaway car a problem for
 * the story rather than a bill.
 */
export const REPAIR_HOURS_PER_WOUND = 2;

/** How many repair attempts a stretch of downtime affords. */
export function repairAttempts(hours: number, wounds: number): number {
  return Math.max(0, Math.min(Math.floor(hours / REPAIR_HOURS_PER_WOUND), Math.max(0, wounds)));
}

/** A Repair roll: a success mends one Wound, a raise two. */
export function repairOutcome(total: number): number {
  if (total >= 8) return 2;
  return total >= 4 ? 1 : 0;
}
