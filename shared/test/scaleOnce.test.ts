import { describe, expect, it } from 'vitest';
import { scaleFor, scaleLabel, sizeAttackMod, sizeAttackTag } from '../src/systems/swadeSize.js';

/**
 * One fact, one modifier.
 *
 * SWADE has a single rule for "that thing is bigger than me": Scale, derived
 * from the creature's Size on its sheet. A token's footprint — how many hexes
 * its picture covers — is a drawing decision made by whoever placed it, and
 * for a while the engine charged for both, billing a Huge creature twice: +4
 * for the art and +4 for the stat block.
 *
 * This pins the numbers the one surviving rule produces, so that any future
 * "big target" bonus has something to contradict.
 */
describe('Scale is the whole of the size rule', () => {
  it('reads the book’s table off a Size', () => {
    expect(scaleFor(8)).toBe(4);      // Huge — the Robo T-Rex
    expect(scaleFor(4)).toBe(2);      // Large
    expect(scaleFor(0)).toBe(0);      // Normal: a person
    expect(scaleFor(-2)).toBe(-2);    // Small
    expect(scaleLabel(8)).toBe('Huge');
  });

  it('gives a normal attacker +4 against a Huge creature — once', () => {
    expect(sizeAttackMod(0, 8)).toBe(4);
    expect(sizeAttackTag(0, 8)).toBe('+4 Scale (Normal vs Huge)');
  });

  it('and the same difference the other way is a penalty', () => {
    expect(sizeAttackMod(8, 0)).toBe(-4);
  });

  it('says nothing at all when both sides are the same size', () => {
    expect(sizeAttackMod(0, 0)).toBe(0);
    expect(sizeAttackTag(0, 0)).toBeNull();
    // Which is almost every roll at almost every table, so it must be silent.
    expect(sizeAttackMod(2, 3)).toBe(0);   // both Normal
  });

  it('is a DIFFERENCE, not the target’s size — a Huge thing swinging at a Huge thing is even', () => {
    expect(sizeAttackMod(8, 8)).toBe(0);
  });
});
