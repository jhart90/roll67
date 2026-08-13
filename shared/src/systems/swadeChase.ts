// SWADE chases: the Chase Card track, and what a maneuvering roll buys on it.
//
// A chase abstracts position. Instead of counting hexes between a car and the
// car it is chasing, the table lays out a row of Chase Cards and everyone
// stands on one; how many cards apart two people are, times the increment for
// that kind of chase, is the range between them. That is the whole idea, and
// it is why a chase can run over any map at any scale — the map is scenery,
// the cards are the distance.
//
// Turn order is NOT here: a chase deals ordinary Action Cards and runs on the
// initiative tracker like any other fight, which is exactly why a chase can
// contain attacks, powers, Tests and everything else a round normally holds.

import type { PlayingCard } from './cards.js';

/**
 * Yards per Chase Card, by what everyone is travelling in. The book gives
 * these as suggestions tuned to the weapons of each kind of chase — the goal
 * is that ranged weapons can reach a card or two, so distance matters without
 * making every shot impossible.
 */
export const CHASE_INCREMENTS = [
  { id: 'foot', label: 'Foot, mounted or vehicular', increment: 5 },
  { id: 'air', label: 'Airplane or sailing ship', increment: 25 },
  { id: 'jet', label: 'Jets or starships', increment: 50 },
] as const;
export type ChaseIncrementId = (typeof CHASE_INCREMENTS)[number]['id'];

/** Cards laid out to start with. Nine is the book's own comfortable default. */
export const CHASE_TRACK_DEFAULT = 9;

export interface ChaseParticipant {
  /** The initiative entry this participant IS — chases run on the tracker. */
  entryId: string;
  tokenId: string | null;
  name: string;
  /** Which Chase Card they stand on, 0 = rearmost. */
  cardIdx: number;
  /** The skill their maneuvering rolls use (Driving, Boating, Athletics…). */
  maneuverSkill: string;
  /** Top Speed for the Speed Bonus comparison; 0 for a runner on foot. */
  topSpeed: number;
  /** Already changed position this turn — the maneuver is once per turn. */
  movedThisTurn?: boolean;
  /** Evading: −2 to attacks against them, and to their own attacks. */
  evading?: boolean;
  color?: string | null;
}

export interface ChaseState {
  incrementId: ChaseIncrementId;
  /** The laid-out track: one card per position, rearmost first. */
  track: PlayingCard[];
  participants: ChaseParticipant[];
}

/** Yards per card for a chase. */
export function chaseIncrement(id: ChaseIncrementId): number {
  return CHASE_INCREMENTS.find((c) => c.id === id)?.increment ?? 5;
}

/**
 * Range in yards between two participants: the number of cards BETWEEN them —
 * not counting the attacker's own card — times the increment. Two people on
 * the same card are in each other's faces, which is why melee is only ever
 * possible there.
 */
export function chaseRangeYards(a: ChaseParticipant, b: ChaseParticipant, incrementId: ChaseIncrementId): number {
  return Math.abs(a.cardIdx - b.cardIdx) * chaseIncrement(incrementId);
}

/**
 * The Speed Bonus on a Change Position roll: +1 for being faster than the
 * quickest rival, +2 for being twice as fast. Everyone equally matched — a
 * foot chase, where nobody has a Top Speed — gets nothing, which is right:
 * it is a bonus for the better machine, not for having legs.
 */
export function speedBonus(mine: number, rivals: number[]): number {
  const fastest = rivals.length ? Math.max(...rivals) : 0;
  if (mine <= 0 || fastest <= 0) return 0;
  if (mine >= fastest * 2) return 2;
  return mine > fastest ? 1 : 0;
}

export interface ChangePositionOutcome {
  /** Cards moved: 1 on a success, 2 on a raise, 0 on a failure. */
  cards: number;
  raise: boolean;
  success: boolean;
}

/**
 * Change Position: a maneuvering roll moves you one card, two with a raise.
 * Spending your ACTION on it instead of taking it free adds +2 — which is
 * folded in by the caller, since the bonus belongs to the roll, not to this.
 */
export function changePosition(total: number): ChangePositionOutcome {
  if (total >= 8) return { cards: 2, raise: true, success: true };
  if (total >= 4) return { cards: 1, raise: false, success: true };
  return { cards: 0, raise: false, success: false };
}

/** Clamp a move to the laid-out track. */
export function clampToTrack(idx: number, trackLength: number): number {
  return Math.max(0, Math.min(trackLength - 1, idx));
}

/**
 * Fleeing: a maneuvering roll at −4, softened to −2 at five cards' distance
 * and to nothing at six or more. Getting away is easier the further ahead you
 * already are, which is what makes the last stretch of a chase tense rather
 * than arbitrary.
 */
export function fleePenalty(cardsBetween: number): number {
  if (cardsBetween >= 6) return 0;
  if (cardsBetween >= 5) return -2;
  return -4;
}

/** Can this participant try to flee at all? Four cards clear of the nearest foe. */
export function canFlee(cardsBetween: number): boolean {
  return cardsBetween >= 4;
}

/**
 * A Complication: an Action Card of Clubs means something has gone wrong —
 * an obstacle, a stall, mud. The suit of the CHASE card the character is
 * standing on sets how bad it is.
 */
export interface Complication {
  mod: number;
  /** Failing the maneuvering roll counts as a Critical Failure. */
  failureIsCritical: boolean;
  /** …and a Joker Bumps them two cards on top of everything else. */
  bumpCards: number;
  label: string;
}

export function complicationFor(chaseCard: PlayingCard): Complication {
  if (chaseCard.rank === 15) {
    return { mod: 2, failureIsCritical: false, bumpCards: 2, label: 'Joker — +2, but a failure Bumps you two cards' };
  }
  switch (chaseCard.suit) {
    case 'spades': return { mod: 0, failureIsCritical: true, bumpCards: 0, label: 'Spades — no modifier, but failure is a Critical Failure' };
    case 'hearts': return { mod: 0, failureIsCritical: false, bumpCards: 1, label: 'Hearts — no modifier; failure Bumps you' };
    case 'diamonds': return { mod: -2, failureIsCritical: false, bumpCards: 1, label: 'Diamonds — −2; failure Bumps you' };
    default: return { mod: -2, failureIsCritical: true, bumpCards: 0, label: 'Clubs — −2, and failure is a Critical Failure' };
  }
}
