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
import { scaleFor, scaleLabel } from './swadeSize.js';

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
  /** Already spent this turn's ACTION on a chase maneuver. */
  actedThisTurn?: boolean;
  /** Evading: −2 to attacks against them, and to their own attacks. */
  evading?: boolean;
  /** Their driver held the vehicle steady: no Unstable Platform aboard. */
  steadied?: boolean;
  /** Dealt a Club: trouble waiting to be rolled for at the start of their turn. */
  complication?: Complication;
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

// ---------- what else you can do with a turn in a chase ----------

/**
 * The chase maneuvers, beyond gaining ground.
 *
 * Every one of them costs the turn's ACTION (Change Position is the only
 * free one, which is why it lives apart from these), and each is a different
 * answer to the only question a chase asks: the gap. Evade widens nothing but
 * makes you hard to hit; Force and Ram spend the gap you have; Flee ends the
 * whole thing; Board throws a body across it.
 */
export const CHASE_ACTIONS = [
  {
    id: 'evade', label: 'Evade', icon: '〰️',
    /** How many Chase Cards may lie between actor and target, or null for none. */
    reach: null,
    hint: 'Drive evasively: −2 to attacks against you until your next turn — and −2 to your own.',
  },
  {
    id: 'holdSteady', label: 'Hold Steady', icon: '🎯',
    reach: null,
    hint: 'Spend the wheel on smooth driving: everyone aboard sheds the −2 for shooting from a moving vehicle.',
  },
  {
    id: 'force', label: 'Force', icon: '↔️',
    reach: 1,
    hint: 'Crowd someone within a card: opposed maneuvering. Win and they lose ground and fight for control.',
  },
  {
    id: 'ram', label: 'Ram', icon: '💥',
    reach: 0,
    hint: 'Hit something on your own card. Both of you take the other machine, and Scale decides who regrets it.',
  },
  {
    id: 'board', label: 'Board', icon: '🪝',
    reach: 0,
    hint: 'Leap across to a vehicle on your card. Athletics at −2; a Critical Failure is the road.',
  },
  {
    id: 'flee', label: 'Flee', icon: '🏳️',
    reach: null,
    hint: 'Break off entirely. Needs four cards of daylight, and the further ahead the easier.',
  },
] as const;
export type ChaseActionId = (typeof CHASE_ACTIONS)[number]['id'];

export function chaseAction(id: ChaseActionId) {
  return CHASE_ACTIONS.find((a) => a.id === id) ?? null;
}

/** Evading cuts both ways: −2 to attacks against them AND to their own. */
export const EVADE_MOD = -2;

/**
 * Unstable Platform: shooting from a moving vehicle is −2, because a car is
 * not a firing range. Hold Steady is the driver's answer — a turn spent on
 * nothing but smooth driving, which is why it costs an action nobody gets
 * back.
 */
export const UNSTABLE_PLATFORM_MOD = -2;

/** Boarding is a −2 Athletics roll: a moving vehicle is a poor place to jump from. */
export const BOARD_MOD = -2;

export interface OpposedOutcome { success: boolean; raise: boolean }

/**
 * An opposed maneuvering roll — Force and Ram both live on it. The book's
 * general rule for opposed rolls: the actor must BEAT the defender, ties go
 * to the defender, and four over is a raise.
 */
export function opposedManeuver(mine: number, theirs: number): OpposedOutcome {
  return { success: mine > theirs, raise: mine >= theirs + 4 };
}

export interface RamResult {
  /** Damage the rammed thing takes. */
  toTarget: number;
  /** …and what the rammer takes for its trouble. */
  toRammer: number;
  scaleGap: number;
  tag: string | null;
}

/**
 * Ramming: each machine takes the other one, and Scale decides who regrets
 * it. The damage a collision does is how solid the thing that hit you was —
 * its Toughness — shifted by the difference in Scale between them, added to
 * what the bigger one deals and taken off what it suffers.
 *
 * That is why a lorry may drive through a bicycle and barely notice, and why
 * ramming something enormous is a way to kill yourself. A ram is never free:
 * even the winner takes a hit.
 */
export function ramDamage(
  rammer: { toughness: number; size: number },
  target: { toughness: number; size: number },
): RamResult {
  const gap = scaleFor(rammer.size) - scaleFor(target.size);
  return {
    toTarget: Math.max(0, Math.round(rammer.toughness + gap)),
    toRammer: Math.max(0, Math.round(target.toughness - gap)),
    scaleGap: gap,
    tag: gap === 0 ? null
      : `${gap > 0 ? '+' : '−'}${Math.abs(gap)} Scale (${scaleLabel(rammer.size)} into ${scaleLabel(target.size)})`,
  };
}

export type BoardOutcome = 'aboard' | 'held' | 'fallen';

/**
 * The leap across. A success puts them aboard; an ordinary failure just means
 * they thought better of it and stayed where they were, which is the merciful
 * reading and the one that keeps players willing to try. Only a Critical
 * Failure puts them on the road at speed.
 */
export function boardOutcome(total: number, critFail: boolean): BoardOutcome {
  if (critFail) return 'fallen';
  return total >= 4 ? 'aboard' : 'held';
}

/** Damage for hitting the road at chase speed — the price of a botched board. */
export const FALL_FROM_VEHICLE_DAMAGE = '2d6';

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

/** A Club in the hand is a Complication; every other suit is a clean round. */
export function isComplicationCard(actionCard: PlayingCard | null | undefined): boolean {
  return !!actionCard && actionCard.rank !== 15 && actionCard.suit === 'clubs';
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

// ---------- being Bumped, and going badly wrong ----------

export interface BumpResult {
  cardIdx: number;
  /** Bumped clean off the back of the track — the chase has left them behind. */
  leftBehind: boolean;
}

/**
 * A Bump: knocked back so many Chase Cards. Falling off the back of the laid
 * out track is the end of it for them — the chase has gone on without them,
 * which is what makes the rear of the track a real place and a Complication
 * at the back worth dreading.
 */
export function bumpResult(cardIdx: number, cards: number): BumpResult {
  const next = cardIdx - Math.max(0, cards);
  return next < 0 ? { cardIdx: 0, leftBehind: true } : { cardIdx: next, leftBehind: false };
}

/** How a participant is travelling — which decides what a disaster looks like. */
export type ChaseTravel = 'vehicle' | 'mounted' | 'foot';

export interface ChaseCritFailure {
  travel: ChaseTravel;
  label: string;
  /** Cards lost on top of everything else. */
  bumpCards: number;
  /** The machine goes Out of Control — the book's own 2d6 table. */
  outOfControl: boolean;
  /** Stay on, or be thrown: a Riding roll decides. */
  ridingCheck: boolean;
  /** Straight onto the ground. */
  prone: boolean;
}

/**
 * A Critical Failure in a chase, routed by what you are travelling in.
 *
 * Rather than three invented tables, each route hands the disaster to a rule
 * that already exists: a vehicle goes Out of Control on the book's own 2d6
 * table, a rider makes a Riding roll or is thrown, and someone on their own
 * two feet simply goes down. All three lose ground, because whatever else
 * happened, the chase did not wait.
 */
export function chaseCritFailure(travel: ChaseTravel): ChaseCritFailure {
  if (travel === 'vehicle') {
    return {
      travel, label: 'The wheel gets away from them', bumpCards: 1,
      outOfControl: true, ridingCheck: false, prone: false,
    };
  }
  if (travel === 'mounted') {
    return {
      travel, label: 'The mount bolts', bumpCards: 1,
      outOfControl: false, ridingCheck: true, prone: false,
    };
  }
  return {
    travel, label: 'They go down hard', bumpCards: 1,
    outOfControl: false, ridingCheck: false, prone: true,
  };
}
