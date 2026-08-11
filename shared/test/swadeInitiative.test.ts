import { describe, expect, it } from 'vitest';
import { cardDrawPlan, chooseCard, quickRedraws, QUICK_REDRAW_MAX } from '../src/systems/swadeInitiative.js';
import type { PlayingCard } from '../src/systems/cards.js';
import type { SheetData } from '../src/types.js';

const sheet = (edges: string[] = [], hindrances: string[] = []): SheetData => ({
  edges: edges.map((name) => ({ name })),
  hindrances: hindrances.map((name) => ({ name })),
});
const card = (rank: number): PlayingCard => ({ rank, suit: 'spades' });
const joker: PlayingCard = { rank: 15, suit: null, joker: 'red' };

describe('cardDrawPlan', () => {
  it('draws one and keeps it with no relevant traits', () => {
    const p = cardDrawPlan(sheet());
    expect(p).toMatchObject({ draw: 1, keep: 'best', redrawAtOrBelow: 0 });
    expect(p.reasons).toEqual([]);
  });

  it('Quick discards 5 and lower without changing the draw count', () => {
    const p = cardDrawPlan(sheet(['Quick']));
    expect(p.draw).toBe(1);
    expect(p.redrawAtOrBelow).toBe(QUICK_REDRAW_MAX);
  });

  it('Level Headed draws two and keeps the better', () => {
    expect(cardDrawPlan(sheet(['Level Headed']))).toMatchObject({ draw: 2, keep: 'best' });
  });

  it('Improved Level Headed draws three, and supersedes the base Edge', () => {
    expect(cardDrawPlan(sheet(['Level Headed', 'Improved Level Headed']))).toMatchObject({ draw: 3, keep: 'best' });
  });

  it('Hesitant draws two and acts on the worse', () => {
    expect(cardDrawPlan(sheet([], ['Hesitant']))).toMatchObject({ draw: 2, keep: 'worst' });
  });

  // Stacking them would mean "draw three, keep the worst" — strictly worse
  // than having neither, which reads as a bug rather than as a rule.
  it('Hesitant and Level Headed cancel rather than stacking', () => {
    const p = cardDrawPlan(sheet(['Level Headed'], ['Hesitant']));
    expect(p).toMatchObject({ draw: 1, keep: 'best' });
    expect(p.reasons.join(' ')).toMatch(/cancel/i);
  });

  it('Quick stacks with Level Headed', () => {
    const p = cardDrawPlan(sheet(['Quick', 'Level Headed']));
    expect(p).toMatchObject({ draw: 2, keep: 'best', redrawAtOrBelow: QUICK_REDRAW_MAX });
  });

  it('matches trait names case-insensitively', () => {
    expect(cardDrawPlan(sheet(['quick'])).redrawAtOrBelow).toBe(QUICK_REDRAW_MAX);
  });
});

describe('chooseCard', () => {
  it('takes the highest under best', () => {
    expect(chooseCard([card(4), card(11), card(7)], 'best').rank).toBe(11);
  });

  it('takes the lowest under worst', () => {
    expect(chooseCard([card(4), card(11), card(7)], 'worst').rank).toBe(4);
  });

  // The book carves the Joker out of Hesitant explicitly: drawing one and
  // then being forced to discard it is the opposite of what a Joker means.
  it('always takes a Joker, even under worst', () => {
    expect(chooseCard([card(2), joker], 'worst').rank).toBe(15);
  });
});

describe('quickRedraws', () => {
  it('throws back 5 and lower', () => {
    expect(quickRedraws(card(5), QUICK_REDRAW_MAX)).toBe(true);
    expect(quickRedraws(card(6), QUICK_REDRAW_MAX)).toBe(false);
  });

  it('never throws back a Joker', () => {
    expect(quickRedraws(joker, QUICK_REDRAW_MAX)).toBe(false);
  });

  it('does nothing without the Edge', () => {
    expect(quickRedraws(card(2), 0)).toBe(false);
  });
});
