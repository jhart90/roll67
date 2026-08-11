import { describe, expect, it } from 'vitest';
import {
  applyArcaneBackground, arcaneProfile, ARCANE_BACKGROUNDS_SWADE, ARCANE_PROFILES_SWADE,
} from '../src/systems/swade.js';

describe('SWADE Arcane Backgrounds', () => {
  // Straight off the book's page — the numbers the whole feature hangs on.
  it.each([
    ['Gifted', 'Focus', 'Spirit', 1, 15],
    ['Magic', 'Spellcasting', 'Smarts', 3, 10],
    ['Miracles', 'Faith', 'Spirit', 3, 10],
    ['Psionics', 'Psionics', 'Smarts', 3, 10],
    ['Weird Science', 'Weird Science', 'Smarts', 2, 15],
  ])('%s rolls %s (%s), starts with %i power(s) and %i PP', (bg, skill, attr, powers, pp) => {
    const p = arcaneProfile(bg as string)!;
    expect(p).toEqual({ skill, attribute: attr, startingPowers: powers, powerPoints: pp });
  });

  it('covers every background the sheet offers', () => {
    for (const bg of ARCANE_BACKGROUNDS_SWADE) expect(arcaneProfile(bg)).not.toBeNull();
    expect(Object.keys(ARCANE_PROFILES_SWADE).sort()).toEqual([...ARCANE_BACKGROUNDS_SWADE].sort());
  });

  it('matches loosely, so a typed background still resolves', () => {
    expect(arcaneProfile('  weird science ')?.skill).toBe('Weird Science');
  });

  it('fills the skill and both PP fields from the background', () => {
    expect(applyArcaneBackground('Weird Science')).toEqual({
      arcaneBackground: 'Weird Science', arcaneSkill: 'Weird Science', pp: 15, maxPp: 15,
    });
  });

  // A setting can invent its own background; that must not wipe the sheet.
  it('leaves the other fields alone for an unknown background', () => {
    expect(applyArcaneBackground('Chi Mastery')).toEqual({ arcaneBackground: 'Chi Mastery' });
  });
});
