import { describe, expect, it } from 'vitest';
import {
  CALLED_SHOTS, calledShotById, calledShotTag, clampCalledShotPenalty,
} from '../src/systems/swadeCalledShot.js';

describe('Called Shot targets', () => {
  // The numbers the book prints beside each option.
  it.each([
    ['head', -4, 4],
    ['face', -5, undefined],
    ['hand', -4, undefined],
    ['limb', -2, undefined],
    ['itemPistol', -4, undefined],
    ['itemSword', -2, undefined],
    ['unarmoredTiny', -6, undefined],
    ['unarmoredVerySmall', -4, undefined],
  ])('%s is %i, damage bonus %s', (id, pen, dmg) => {
    const c = calledShotById(id as string)!;
    expect(c.penalty).toBe(pen);
    expect(c.damageBonus).toBe(dmg);
  });

  it('only gives the head-or-vitals shot extra damage', () => {
    const withDamage = CALLED_SHOTS.filter((c) => c.damageBonus);
    expect(withDamage.map((c) => c.id)).toEqual(['head']);
  });

  it('gives every option a note explaining what it does', () => {
    for (const c of CALLED_SHOTS) expect(c.note, c.id).toBeTruthy();
  });
});

describe('a hand-entered modifier', () => {
  it('is held to the Scale table’s own range', () => {
    expect(clampCalledShotPenalty(-99)).toBe(-8);
    expect(clampCalledShotPenalty(99)).toBe(6);
    expect(clampCalledShotPenalty(-3)).toBe(-3);
  });

  it('rounds, and treats junk as no modifier', () => {
    expect(clampCalledShotPenalty(-2.6)).toBe(-3);
    expect(clampCalledShotPenalty(NaN)).toBe(0);
  });

  // The book's own example: aiming at the eye of a Huge dragon is a shot at
  // the EYE. If the eye is car-sized that is Large — a bonus, not a penalty.
  it('allows a positive modifier for a large part', () => {
    expect(clampCalledShotPenalty(2)).toBe(2);
    expect(calledShotTag('Eye (car-sized)', 2)).toBe('+2 Called Shot (Eye (car-sized))');
  });
});

describe('the chat tag', () => {
  it('signs the modifier the way the other tags do', () => {
    expect(calledShotTag('Head or vitals', -4)).toBe('−4 Called Shot (Head or vitals)');
  });
});

import { calledShotPenalty } from '../src/systems/swadeCalledShot.js';

describe('parts scale with the creature they belong to', () => {
  const part = (id: string) => calledShotById(id)!;

  // A head is a head — but a Huge creature's head is the size of a small car.
  it('makes a Huge creature’s head far easier to hit than a person’s', () => {
    expect(calledShotPenalty(part('head'), 0)).toBe(-4);   // person
    expect(calledShotPenalty(part('head'), 9)).toBe(0);    // Huge (Scale +4)
    expect(calledShotPenalty(part('head'), 14)).toBe(2);   // Gargantuan (+6)
  });

  it('makes a Tiny creature’s limb nearly impossible', () => {
    expect(calledShotPenalty(part('limb'), 0)).toBe(-2);
    expect(calledShotPenalty(part('limb'), -4)).toBe(-8);  // Tiny (Scale −6)
  });

  // Still harder than simply hitting the creature: a Huge target is +4 to hit
  // normally, and its limb is +2 — a real cost for a real advantage.
  it('stays harder than an ordinary swing at the same creature', () => {
    expect(calledShotPenalty(part('limb'), 9)).toBe(2);
  });

  // An item is its own size whoever is carrying it.
  it('does not grow items with their owner', () => {
    expect(calledShotPenalty(part('itemPistol'), 0)).toBe(-4);
    expect(calledShotPenalty(part('itemPistol'), 9)).toBe(-4);
    expect(calledShotPenalty(part('itemSword'), 14)).toBe(-2);
  });

  it('holds the result inside the Scale table', () => {
    expect(calledShotPenalty(part('unarmoredTiny'), -4)).toBe(-8);
    expect(calledShotPenalty(part('limb'), 20)).toBe(4);
  });
});
