import { describe, expect, it } from 'vitest';
import {
  BOARD_MOD, CHASE_ACTIONS, CHASE_INCREMENTS, boardOutcome, bumpResult, canFlee, chaseAction,
  chaseCritFailure, changePosition, chaseIncrement, chaseRangeYards, clampToTrack, complicationFor,
  fleePenalty, isComplicationCard, opposedManeuver, ramDamage, speedBonus,
} from '../src/systems/swadeChase.js';
import { vehicleParry } from '../src/systems/swadeVehicles.js';
import type { PlayingCard } from '../src/systems/cards.js';

const at = (cardIdx: number) => ({
  entryId: String(cardIdx), tokenId: null, name: 'x', cardIdx,
  maneuverSkill: 'Driving', topSpeed: 0,
});
const card = (suit: PlayingCard['suit'], rank = 7): PlayingCard => ({ rank, suit });

describe('the chase track', () => {
  it('scales range to the kind of chase', () => {
    expect(chaseIncrement('foot')).toBe(5);
    expect(chaseIncrement('air')).toBe(25);
    expect(chaseIncrement('jet')).toBe(50);
    // Every increment the book offers is on the menu.
    expect(CHASE_INCREMENTS.length).toBe(3);
  });

  it('measures range as the cards BETWEEN them, times the increment', () => {
    // Same card is face to face — the only place melee is possible.
    expect(chaseRangeYards(at(3), at(3), 'foot')).toBe(0);
    expect(chaseRangeYards(at(1), at(3), 'foot')).toBe(10);
    // …and the same gap is a different world in a dogfight.
    expect(chaseRangeYards(at(1), at(3), 'jet')).toBe(100);
  });

  it('measures the same either way round', () => {
    expect(chaseRangeYards(at(5), at(2), 'air')).toBe(chaseRangeYards(at(2), at(5), 'air'));
  });
});

describe('Change Position', () => {
  it('moves a card on a success and two on a raise', () => {
    expect(changePosition(3)).toMatchObject({ cards: 0, success: false });
    expect(changePosition(4)).toMatchObject({ cards: 1, raise: false, success: true });
    expect(changePosition(7)).toMatchObject({ cards: 1, raise: false });
    expect(changePosition(8)).toMatchObject({ cards: 2, raise: true });
    expect(changePosition(20)).toMatchObject({ cards: 2, raise: true });
  });

  it('never walks off the ends of the laid-out track', () => {
    expect(clampToTrack(-3, 9)).toBe(0);
    expect(clampToTrack(12, 9)).toBe(8);
    expect(clampToTrack(4, 9)).toBe(4);
  });
});

describe('the Speed Bonus', () => {
  it('rewards the better machine, and doubly the far better one', () => {
    expect(speedBonus(120, [90])).toBe(1);
    expect(speedBonus(200, [90])).toBe(2);   // twice as fast
    expect(speedBonus(180, [90])).toBe(2);   // exactly twice counts
    expect(speedBonus(90, [120])).toBe(0);
    expect(speedBonus(90, [90])).toBe(0);    // dead even is no bonus
  });

  it('gives nothing in a foot chase, where nobody has a Top Speed', () => {
    expect(speedBonus(0, [0, 0])).toBe(0);
  });

  it('compares against the FASTEST rival, not the average', () => {
    expect(speedBonus(100, [30, 30, 160])).toBe(0);
  });
});

describe('Fleeing', () => {
  it('needs four cards of daylight before it can be tried at all', () => {
    expect(canFlee(3)).toBe(false);
    expect(canFlee(4)).toBe(true);
  });

  it('gets easier the further ahead you already are', () => {
    expect(fleePenalty(4)).toBe(-4);
    expect(fleePenalty(5)).toBe(-2);
    expect(fleePenalty(6)).toBe(0);
    expect(fleePenalty(9)).toBe(0);
  });
});

describe('the chase maneuvers', () => {
  it('knows which ones need somebody to do them to, and how far they reach', () => {
    expect(chaseAction('ram')?.reach).toBe(0);     // your own card only
    expect(chaseAction('force')?.reach).toBe(1);   // …or the one next to it
    expect(chaseAction('board')?.reach).toBe(0);
    expect(chaseAction('evade')?.reach).toBeNull();
    expect(chaseAction('flee')?.reach).toBeNull();
    expect(chaseAction('holdSteady')?.reach).toBeNull();
  });

  it('offers every one of them exactly once', () => {
    expect(new Set(CHASE_ACTIONS.map((a) => a.id)).size).toBe(CHASE_ACTIONS.length);
  });
});

describe('opposed maneuvering', () => {
  it('gives ties to the defender', () => {
    expect(opposedManeuver(7, 7).success).toBe(false);
    expect(opposedManeuver(8, 7).success).toBe(true);
  });

  it('calls four over a raise', () => {
    expect(opposedManeuver(10, 7)).toMatchObject({ success: true, raise: false });
    expect(opposedManeuver(11, 7)).toMatchObject({ success: true, raise: true });
  });
});

describe('Ramming', () => {
  const car = { toughness: 10, size: 4 };   // Large, Scale +2
  const bike = { toughness: 6, size: 0 };   // Normal, Scale 0

  it('hurts both of you — a ram is never free', () => {
    const even = ramDamage(bike, { toughness: 8, size: 0 });
    expect(even.toTarget).toBe(6);
    expect(even.toRammer).toBe(8);
    expect(even.scaleGap).toBe(0);
    expect(even.tag).toBeNull();
  });

  it('lets the bigger machine drive through the smaller one', () => {
    const hit = ramDamage(car, bike);
    expect(hit.toTarget).toBe(12);   // 10 + 2 Scale
    expect(hit.toRammer).toBe(4);    // 6 − 2 Scale
    expect(hit.tag).toContain('Scale');
  });

  it('…and punishes the smaller one for trying it the other way round', () => {
    const hit = ramDamage(bike, car);
    expect(hit.toTarget).toBe(4);    // 6 − 2
    expect(hit.toRammer).toBe(12);   // 10 + 2
  });

  it('never deals negative damage, however lopsided', () => {
    const hit = ramDamage({ toughness: 2, size: 20 }, { toughness: 1, size: -4 });
    expect(hit.toRammer).toBe(0);
  });
});

describe('Boarding', () => {
  it('is a −2 leap that only a Critical Failure turns into the road', () => {
    expect(BOARD_MOD).toBe(-2);
    expect(boardOutcome(4, false)).toBe('aboard');
    expect(boardOutcome(3, false)).toBe('held');
    expect(boardOutcome(12, true)).toBe('fallen');
  });
});

describe("a vehicle's Parry", () => {
  it('is 2 plus half the die at the wheel', () => {
    expect(vehicleParry(6)).toBe(5);
    expect(vehicleParry(12)).toBe(8);
  });

  it('is a flat 2 when nobody is driving — a parked car is a barn door', () => {
    expect(vehicleParry(0)).toBe(2);
  });
});

describe('being Bumped', () => {
  it('costs you the cards it says', () => {
    expect(bumpResult(5, 1)).toMatchObject({ cardIdx: 4, leftBehind: false });
    expect(bumpResult(5, 2)).toMatchObject({ cardIdx: 3, leftBehind: false });
  });

  it('leaves you behind when it pushes you off the back of the track', () => {
    expect(bumpResult(0, 1)).toMatchObject({ leftBehind: true });
    expect(bumpResult(1, 2)).toMatchObject({ leftBehind: true });
  });

  it('is survivable right at the rear if it costs nothing', () => {
    expect(bumpResult(0, 0)).toMatchObject({ cardIdx: 0, leftBehind: false });
  });
});

describe('a Critical Failure in a chase', () => {
  it('hands the disaster to whatever you are travelling in', () => {
    expect(chaseCritFailure('vehicle')).toMatchObject({ outOfControl: true, ridingCheck: false, prone: false });
    expect(chaseCritFailure('mounted')).toMatchObject({ outOfControl: false, ridingCheck: true, prone: false });
    expect(chaseCritFailure('foot')).toMatchObject({ outOfControl: false, ridingCheck: false, prone: true });
  });

  it('costs ground however it happened — the chase did not wait', () => {
    for (const travel of ['vehicle', 'mounted', 'foot'] as const) {
      expect(chaseCritFailure(travel).bumpCards).toBeGreaterThan(0);
    }
  });
});

describe('Complications', () => {
  it('are dealt by Clubs and nothing else', () => {
    expect(isComplicationCard(card('clubs'))).toBe(true);
    expect(isComplicationCard(card('spades'))).toBe(false);
    expect(isComplicationCard(card('hearts'))).toBe(false);
    // A Joker has no suit and is nobody's bad news.
    expect(isComplicationCard({ rank: 15, suit: null })).toBe(false);
    expect(isComplicationCard(null)).toBe(false);
  });

  it('reads its stakes off the suit of the card you are standing on', () => {
    expect(complicationFor(card('spades'))).toMatchObject({ mod: 0, failureIsCritical: true });
    expect(complicationFor(card('hearts'))).toMatchObject({ mod: 0, failureIsCritical: false, bumpCards: 1 });
    expect(complicationFor(card('diamonds'))).toMatchObject({ mod: -2, bumpCards: 1 });
    expect(complicationFor(card('clubs'))).toMatchObject({ mod: -2, failureIsCritical: true });
  });

  it('makes a Joker generous and dangerous at once', () => {
    const joker = complicationFor({ rank: 15, suit: null });
    expect(joker.mod).toBe(2);
    expect(joker.bumpCards).toBe(2);
  });
});
