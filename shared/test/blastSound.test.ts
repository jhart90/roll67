import { describe, expect, it } from 'vitest';
import {
  blastAceStyle, blastSoundClip, blastSoundPool, blastSoundVolume, blastTemplate,
} from '../src/systems/blastSound.js';
import { CONTENT_SWADE } from '../src/data/contentSwade.js';

describe('reading the template off a burst', () => {
  it('matches the hex sizes the compendium gives SBT/MBT/LBT', () => {
    expect(blastTemplate(1)).toBe('small');
    expect(blastTemplate(3)).toBe('medium');
    expect(blastTemplate(5)).toBe('large');
  });

  it("calls a spell's own shape something else", () => {
    expect(blastTemplate(undefined)).toBe('other');
    expect(blastTemplate(2)).toBe('other');
  });
});

describe('picking the clip', () => {
  it('bangs for a plain kinetic blast', () => {
    expect(blastSoundPool(3, 'kinetic')).toEqual(['explosion_1', 'explosion_2', 'explosion_3', 'explosion_4']);
  });

  // The one file nothing else uses, saved for the one template big enough.
  it('saves the huge explosion for a Large Blast Template', () => {
    expect(blastSoundPool(5, 'kinetic')).toEqual(['huge_explosion']);
    expect(blastSoundPool(3, 'kinetic')).not.toContain('huge_explosion');
    expect(blastSoundPool(1, 'kinetic')).not.toContain('huge_explosion');
  });

  // A fire template crackles at any size — the big bang is for concussion.
  it('does not upgrade a non-explosive family', () => {
    expect(blastSoundPool(5, 'fire')).toEqual(['fire_1']);
    expect(blastSoundPool(5, 'cold')).toEqual(['water_1', 'water_2']);
  });

  it.each([
    ['fire', 'fire_1'],
    ['cold', 'water_1'],
    ['radiant', 'shine_1'],
    ['poison', 'smoke_1'],
  ])('gives %s its own family', (type, first) => {
    expect(blastSoundPool(3, type)).toContain(first);
  });

  it('falls back to an explosion for a type it does not know', () => {
    expect(blastSoundPool(3, 'sonic-whatever')).toContain('explosion_1');
  });

  // The Smoke Grenade deals nothing and names no damage type; a bang would be
  // plain wrong for it.
  it('hisses rather than bangs when there is no damage type at all', () => {
    expect(blastSoundPool(5, '')).toEqual(['smoke_1']);
    expect(blastSoundPool(5, undefined)).toEqual(['smoke_1']);
  });
});

describe('choosing from the pool', () => {
  it('spreads across every clip', () => {
    const seen = new Set([0, 0.3, 0.6, 0.99].map((r) => blastSoundClip(3, 'kinetic', r)));
    expect(seen.size).toBe(4);
  });

  it('never runs off the end of the pool', () => {
    expect(blastSoundClip(3, 'kinetic', 1)).toBe('explosion_4');
    expect(blastSoundClip(3, 'kinetic', 0)).toBe('explosion_1');
  });
});

describe('the picture matches the noise', () => {
  // One family decides both, so a burst that hisses can never also look like
  // a fireball.
  it.each([
    ['kinetic', 'explosion'],
    ['force', 'explosion'],
    ['fire', 'flames'],
    ['cold', 'water'],
    ['poison', 'smoke'],
    ['radiant', 'flash'],
  ])('draws %s as the %s Ace', (type, style) => {
    expect(blastAceStyle(3, type)).toBe(style);
  });

  it('gives a smoke grenade the smoke Ace, not an explosion', () => {
    expect(blastAceStyle(5, '')).toBe('smoke');
    expect(blastAceStyle(5, undefined)).toBe('smoke');
  });

  // The big bang is still an explosion — only the clip changes at that size.
  it('keeps the Large Blast Template on the explosion Ace', () => {
    expect(blastAceStyle(5, 'kinetic')).toBe('explosion');
  });

  it('only dresses up round templates’ own families it knows', () => {
    expect(blastAceStyle(3, 'necrotic')).toBe('smoke');
  });
});

describe('the bigger the template the louder it is', () => {
  it('rises with the template', () => {
    expect(blastSoundVolume(1)).toBeLessThan(blastSoundVolume(3));
    expect(blastSoundVolume(3)).toBeLessThan(blastSoundVolume(5));
  });

  it('stays inside a sane range', () => {
    for (const n of [1, 3, 5, undefined]) {
      expect(blastSoundVolume(n)).toBeGreaterThan(0);
      expect(blastSoundVolume(n)).toBeLessThanOrEqual(1);
    }
  });
});

describe('every template weapon in the compendium gets a sound', () => {
  const blasts = CONTENT_SWADE.filter(
    (e) => e.kind === 'weapon' && /\b(small|medium|large) blast\b/i.test(e.weapon?.props.join(' ') ?? ''),
  );

  it('finds the template weapons to check', () => {
    expect(blasts.length).toBeGreaterThan(5);
  });

  it('leaves none of them silent', () => {
    for (const w of blasts) {
      const hexes = { small: 1, medium: 3, large: 5 }[
        /\b(small|medium|large) blast\b/i.exec(w.weapon!.props.join(' '))![1]!.toLowerCase() as 'small'
      ];
      expect(blastSoundPool(hexes, w.weapon!.damageType), w.name).not.toHaveLength(0);
    }
  });

  it('gives the Smoke Grenade smoke and the Frag Grenade a bang', () => {
    const smoke = blasts.find((w) => w.name === 'Smoke Grenade')!;
    const frag = blasts.find((w) => w.name === 'Frag Grenade')!;
    expect(blastSoundPool(5, smoke.weapon!.damageType)).toEqual(['smoke_1']);
    expect(blastSoundPool(3, frag.weapon!.damageType)).toContain('explosion_1');
  });
});
