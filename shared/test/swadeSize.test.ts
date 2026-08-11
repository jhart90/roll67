import { describe, expect, it } from 'vitest';
import {
  extraWoundsFor, scaleFor, scaleLabel, sizeAttackMod, sizeAttackTag,
} from '../src/systems/swadeSize.js';

describe('the Size Table', () => {
  // Every band boundary off the book's page.
  it.each([
    [-4, -6, 'Tiny', 0],
    [-3, -4, 'Very Small', 0],
    [-2, -2, 'Small', 0],
    [-1, 0, 'Normal', 0],
    [0, 0, 'Normal', 0],
    [3, 0, 'Normal', 0],
    [4, 2, 'Large', 1],
    [7, 2, 'Large', 1],
    [8, 4, 'Huge', 2],
    [11, 4, 'Huge', 2],
    [12, 6, 'Gargantuan', 3],
    [20, 6, 'Gargantuan', 3],
  ])('Size %i is Scale %i (%s), +%i wounds', (size, scale, label, wounds) => {
    expect(scaleFor(size as number)).toBe(scale);
    expect(scaleLabel(size as number)).toBe(label);
    expect(extraWoundsFor(size as number)).toBe(wounds);
  });

  it('clamps past either end of the table', () => {
    expect(scaleFor(-99)).toBe(-6);
    expect(scaleFor(999)).toBe(6);
  });

  it('treats a missing or junk Size as Normal', () => {
    expect(scaleFor(NaN)).toBe(0);
  });
});

describe('Scale difference on attacks', () => {
  // The book's own two worked examples.
  it('gives a Tiny fairy +10 to hurl a bolt at a Huge dragon', () => {
    expect(sizeAttackMod(-4, 9)).toBe(10);
  });

  it('costs a Very Small eagle 2 to attack a Tiny fairy', () => {
    expect(sizeAttackMod(-3, -4)).toBe(-2);
  });

  // The common case: nothing happens, which is most rolls at most tables.
  it('is nothing between two Normal creatures', () => {
    expect(sizeAttackMod(0, 2)).toBe(0);
    expect(sizeAttackTag(0, 2)).toBeNull();
  });

  it('is symmetric — what one side adds, the other subtracts', () => {
    expect(sizeAttackMod(0, 8)).toBe(-sizeAttackMod(8, 0));
  });

  it('names both scales in the tag', () => {
    expect(sizeAttackTag(-4, 9)).toBe('+10 Scale (Tiny vs Huge)');
    expect(sizeAttackTag(9, -4)).toBe('−10 Scale (Huge vs Tiny)');
  });
});

import { NPCS_SWADE } from '../src/data/npcsSwade.js';
import { num } from '../src/systems/types.js';

describe('bestiary sizes', () => {
  it('gives every SWADE creature a Size', () => {
    for (const npc of NPCS_SWADE) {
      expect(typeof npc.sheet.size, `${npc.name} has no size`).toBe('number');
    }
  });

  it('reads the size the entry states rather than defaulting it', () => {
    const byName = (n: string) => NPCS_SWADE.find((x) => x.name === n)!;
    expect(num(byName('Alamosaurus').sheet, 'size', 0)).toBe(8);   // "Size +8 (Huge)"
    expect(num(byName('Triceratops').sheet, 'size', 0)).toBe(5);   // "Size +5"
    expect(num(byName('Triceratops Cub').sheet, 'size', 0)).toBe(1); // stated in the note
  });

  // A Huge dinosaur swinging at a person eats the Scale penalty, and the
  // person swinging back gets the bonus.
  it('makes a Huge creature harder for it to hit a person, and easier the other way', () => {
    const huge = num(NPCS_SWADE.find((x) => x.name === 'Alamosaurus')!.sheet, 'size', 0);
    expect(sizeAttackMod(huge, 0)).toBe(-4);
    expect(sizeAttackMod(0, huge)).toBe(4);
  });
});
