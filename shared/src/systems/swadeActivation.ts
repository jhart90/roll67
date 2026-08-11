/**
 * SWADE power activation, and everything that can go wrong afterwards.
 *
 * The book's rule in one line: a character activates a power by picking a
 * target in Range and making an arcane skill roll, and a roll under 4 means
 * the power does not activate. What made this worth its own module is the
 * cost, which is not symmetric:
 *
 *   success  — the power activates and consumes ALL the Power Points allocated
 *              to it, even if it then misses (bolt) or the defender resists
 *   failure  — the power does not activate, and the caster still spends ONE
 *              Power Point
 *
 * Everything here is pure. The server decides when to roll; this decides what
 * the roll meant and what it cost.
 */

import type { DieRoll, SheetData } from '../types.js';
import { num, rows, str } from './types.js';
import { swadeCritFail } from './swade.js';

/** Every arcane skill roll is against this, whatever the power. */
export const ACTIVATION_TN = 4;
/** A failed activation still costs this much, whatever the power's cost. */
export const FAILED_ACTIVATION_PP = 1;
/** A hero recovers this many Power Points per hour of rest. */
export const PP_PER_HOUR_REST = 5;
/** Holding a power open past its Duration costs this, per target. */
export const MAINTAIN_PP = 1;
/** …and buys this many more rounds. */
export const MAINTAIN_ROUNDS = 5;

export type ActivationVerdict = 'raise' | 'success' | 'failure' | 'backlash';

export interface ActivationOutcome {
  verdict: ActivationVerdict;
  /** True when the power goes off at all. */
  activated: boolean;
  /** Power Points actually spent. */
  ppSpent: number;
  /** A Critical Failure while activating: Backlash. */
  backlash: boolean;
  /** One line for the chat card. */
  summary: string;
}

export interface ActivationInput {
  /** The arcane skill roll's total. */
  total: number;
  /** Its dice, for the Critical Failure test. */
  dice: DieRoll[];
  wildCard: boolean;
  /** The power's listed cost. */
  cost: number;
  /** Points the caster chose to pay, when Shorting. Defaults to the cost. */
  paid?: number;
}

/**
 * Shorting: a caster may pay fewer Power Points than a power requires — even
 * none — by making the roll harder, at −1 per point short.
 */
export function shortingPenalty(cost: number, paid: number): number {
  const short = Math.max(0, Math.round(cost) - Math.max(0, Math.round(paid)));
  // Negating zero gives -0, which formats as "-0" wherever this is shown.
  return short === 0 ? 0 : -short;
}

/** Is this cast shorted? Shorting changes what a failure means. */
export function isShorted(cost: number, paid: number): boolean {
  return shortingPenalty(cost, paid) < 0;
}

/**
 * What the activation roll meant, and what it cost.
 *
 * A shorted cast that fails is not merely a failure: the book makes it a
 * Critical Failure, which means Backlash and no Benny reroll. That is the
 * whole risk of Shorting, so it must not be silently dropped.
 */
export function activationOutcome(input: ActivationInput): ActivationOutcome {
  const cost = Math.max(0, Math.round(input.cost));
  const paid = Math.max(0, Math.round(input.paid ?? cost));
  const shorted = isShorted(cost, paid);
  const critFail = swadeCritFail(input.dice, input.wildCard);
  const activated = input.total >= ACTIVATION_TN;

  if (!activated) {
    // Backlash on a Critical Failure — or on ANY failed shorted cast.
    const backlash = critFail || shorted;
    return {
      verdict: backlash ? 'backlash' : 'failure',
      activated: false,
      ppSpent: Math.min(paid, FAILED_ACTIVATION_PP),
      backlash,
      summary: backlash
        ? `Backlash! The power fails${shorted && !critFail ? ' — a shorted cast that misses counts as a Critical Failure' : ''}.`
        : `The power doesn’t activate (${input.total} vs ${ACTIVATION_TN}).`,
    };
  }
  const raise = input.total >= ACTIVATION_TN + 4;
  return {
    verdict: raise ? 'raise' : 'success',
    activated: true,
    ppSpent: paid,
    backlash: false,
    summary: raise
      ? `Activates with a raise (${input.total} vs ${ACTIVATION_TN}).`
      : `Activates (${input.total} vs ${ACTIVATION_TN}).`,
  };
}

/** A Benny cannot buy back a shorted cast that failed. */
export function canRerollActivation(cost: number, paid: number, activated: boolean): boolean {
  if (activated) return false;
  return !isShorted(cost, paid);
}

/**
 * Backlash: a level of Fatigue, and every power the caster currently has
 * running ends at once. Returns the sheet patch that does both.
 */
export function backlashPatch(sheet: SheetData): SheetData {
  return {
    fatigue: Math.min(2, num(sheet, 'fatigue', 0) + 1),
    activePowers: [],
    armorActive: false,
    protectionActive: false,
    deflectionActive: false,
    smiteActive: false,
  };
}

/**
 * Disruption: taking a knock while powers are running threatens them all.
 *
 * The book asks for a Smarts roll when a character with active powers is
 * Shaken, Stunned or Wounded, and ends every one of their powers on a
 * failure. It matters who cast them, not who they are on — a mage whose
 * enchantments sit on his allies still loses them when HE is hurt.
 */
export const DISRUPTING_CONDITIONS = ['shaken', 'stunned'] as const;

/** Does this character have anything for a disruption to threaten? */
export function hasActivePowers(sheet: SheetData): boolean {
  if (rows(sheet, 'activePowers').some((r) => str(r, 'name', '').trim() !== '' && num(r, 'rounds', 0) > 0)) return true;
  return ['armorActive', 'protectionActive', 'deflectionActive', 'smiteActive'].some((k) => sheet[k] === true);
}

/**
 * Arcane Devices are the exception the book names: the USER rolls Smarts to
 * keep a device working, so a wand doesn't wink out because its owner was
 * grazed. Marked on the sheet, since nothing else can tell.
 */
export function usesArcaneDevice(sheet: SheetData): boolean {
  return /device/i.test(str(sheet, 'arcaneBackground', ''));
}

/** Everything a failed disruption roll ends. */
export function disruptionPatch(): SheetData {
  return {
    activePowers: [],
    armorActive: false,
    protectionActive: false,
    deflectionActive: false,
    smiteActive: false,
  };
}

/** Power Points recovered by resting this many hours, capped at the maximum. */
export function restRecovery(sheet: SheetData, hours: number): number {
  const max = num(sheet, 'maxPp', 10);
  const cur = num(sheet, 'pp', 0);
  const gained = Math.max(0, Math.floor(hours)) * PP_PER_HOUR_REST;
  return Math.max(0, Math.min(max, cur + gained) - cur);
}

/**
 * Casting Requirements: the caster must be able to see the target and must
 * not be Bound. Returns why they cannot cast, or null if they can.
 */
export function castingBlocker(conditions: readonly string[]): string | null {
  if (conditions.includes('bound')) return 'Bound — cannot cast.';
  if (conditions.includes('blinded')) return 'Blinded — cannot see the target to cast at it.';
  return null;
}
