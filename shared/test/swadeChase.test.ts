import { describe, expect, it } from 'vitest';
import {
  CHASE_INCREMENTS, canFlee, changePosition, chaseIncrement, chaseRangeYards,
  clampToTrack, complicationFor, fleePenalty, speedBonus,
} from '../src/systems/swadeChase.js';
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

describe('Complications', () => {
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
