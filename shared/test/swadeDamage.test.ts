import { describe, expect, it } from 'vitest';
import { MAX_WOUNDS, soakSuccesses, swadeDamageOutcome, swadeHealOutcome, rollInjuryTable } from '../src/systems/swadeDamage.js';

const wc = { alreadyShaken: false, wildCard: true, currentWounds: 0 };

describe('swadeDamageOutcome', () => {
  it('under Toughness does nothing', () => {
    const r = swadeDamageOutcome(5, 6, wc);
    expect(r.shaken).toBe(false);
    expect(r.woundsDealt).toBe(0);
    expect(r.incapacitated).toBe(false);
  });

  it('meeting Toughness Shakes; each full +4 is a Wound', () => {
    expect(swadeDamageOutcome(6, 6, wc).woundsDealt).toBe(0);
    expect(swadeDamageOutcome(6, 6, wc).shaken).toBe(true);
    expect(swadeDamageOutcome(9, 6, wc).woundsDealt).toBe(0);  // +3: still just Shaken
    expect(swadeDamageOutcome(10, 6, wc).woundsDealt).toBe(1); // +4: a raise
    expect(swadeDamageOutcome(14, 6, wc).woundsDealt).toBe(2); // +8: two raises
  });

  it('re-Shaking a Shaken target with damage upgrades to a Wound', () => {
    const r = swadeDamageOutcome(6, 6, { ...wc, alreadyShaken: true });
    expect(r.woundsDealt).toBe(1);
    expect(r.summary).toContain('1 Wound');
  });

  it('a Wild Card carries three Wounds and drops on the fourth', () => {
    expect(swadeDamageOutcome(10, 6, { ...wc, currentWounds: 2 }).incapacitated).toBe(false);
    const down = swadeDamageOutcome(10, 6, { ...wc, currentWounds: MAX_WOUNDS });
    expect(down.incapacitated).toBe(true);
    expect(down.summary).toContain('INCAPACITATED');
    // A big enough single hit can do it from healthy.
    expect(swadeDamageOutcome(6 + 16, 6, wc).incapacitated).toBe(true); // 4 raises
  });

  it('an Extra drops at its first Wound but is only Shaken by a plain success', () => {
    const extra = { alreadyShaken: false, wildCard: false, currentWounds: 0 };
    expect(swadeDamageOutcome(7, 6, extra).incapacitated).toBe(false);
    expect(swadeDamageOutcome(10, 6, extra).incapacitated).toBe(true);
  });

  /**
   * Hardy is the difference between a thing that folds to two glancing blows
   * and one that has to actually be hurt. It spares only the double-Shaken
   * wound — a raise still wounds a golem.
   */
  describe('Hardy', () => {
    const shaken = { alreadyShaken: true, wildCard: true, currentWounds: 0 };

    it('turns a second Shaken back into just Shaken', () => {
      expect(swadeDamageOutcome(7, 6, shaken).woundsDealt).toBe(1);
      expect(swadeDamageOutcome(7, 6, { ...shaken, hardy: true }).woundsDealt).toBe(0);
    });

    it('says why the blow cost nothing', () => {
      expect(swadeDamageOutcome(7, 6, { ...shaken, hardy: true }).verdict).toMatch(/Hardy/);
    });

    it('does not protect against raises', () => {
      // 10 vs Toughness 6 is a raise: a Wound whether Hardy or not.
      expect(swadeDamageOutcome(10, 6, { ...shaken, hardy: true }).woundsDealt).toBe(1);
      expect(swadeDamageOutcome(14, 6, { ...shaken, hardy: true }).woundsDealt).toBe(2);
    });

    it('leaves an unshaken target alone either way', () => {
      const fresh = { alreadyShaken: false, wildCard: true, currentWounds: 0 };
      expect(swadeDamageOutcome(7, 6, { ...fresh, hardy: true }).woundsDealt).toBe(0);
      expect(swadeDamageOutcome(7, 6, fresh).woundsDealt).toBe(0);
    });
  });

  /**
   * Invulnerability stops at the Wound. The blow still lands, still rattles,
   * still counts as a hit — it simply cannot hurt the thing. Whether THIS
   * blow is the exception is the caller's decision (it reads the creature's
   * Environmental Weakness), so from here it is a plain switch.
   */
  describe('Invulnerable', () => {
    const wc = { alreadyShaken: false, wildCard: true, currentWounds: 0 };

    it('shakes but never wounds, however hard the hit', () => {
      const r = swadeDamageOutcome(30, 6, { ...wc, invulnerable: true });
      expect(r.shaken).toBe(true);
      expect(r.woundsDealt).toBe(0);
      expect(r.incapacitated).toBe(false);
      expect(r.verdict).toMatch(/Invulnerable/);
    });

    it('does not stop a hit that misses Toughness from missing anyway', () => {
      expect(swadeDamageOutcome(3, 6, { ...wc, invulnerable: true }).shaken).toBe(false);
    });

    it('is off for the one thing that does hurt it, and then it wounds normally', () => {
      expect(swadeDamageOutcome(14, 6, { ...wc, invulnerable: false }).woundsDealt).toBe(2);
    });
  });
});

describe('soakSuccesses', () => {
  it('success at 4, one more per raise', () => {
    expect(soakSuccesses(3)).toBe(0);
    expect(soakSuccesses(4)).toBe(1);
    expect(soakSuccesses(7)).toBe(1);
    expect(soakSuccesses(8)).toBe(2);
    expect(soakSuccesses(12)).toBe(3);
  });
});

describe('swadeHealOutcome', () => {
  it('restores a wound per full 4 points, at least one for any heal', () => {
    expect(swadeHealOutcome(2, 3).woundsHealed).toBe(1);
    expect(swadeHealOutcome(8, 3).woundsHealed).toBe(2);
    expect(swadeHealOutcome(20, 2).woundsHealed).toBe(2); // capped at current
    expect(swadeHealOutcome(0, 2).woundsHealed).toBe(0);
    expect(swadeHealOutcome(6, 0).woundsHealed).toBe(0);
  });
});

describe('Injury Table', () => {
  const seq = (...vals: number[]) => { let i = 0; return () => vals[i++] ?? 6; };

  it('maps locations from the first d6', () => {
    expect(rollInjuryTable(seq(1)).location).toBe('Unmentionables');
    expect(rollInjuryTable(seq(2)).location).toBe('Arm');
    expect(rollInjuryTable(seq(4)).location).toBe('Leg');
  });

  it('guts and head roll a sub-effect', () => {
    expect(rollInjuryTable(seq(3, 1)).location).toBe('Guts (broken)');
    expect(rollInjuryTable(seq(3, 5)).location).toBe('Guts (busted)');
    expect(rollInjuryTable(seq(5, 6)).location).toBe('Head (brain damage)');
    expect(rollInjuryTable(seq(6, 1)).location).toBe('Head (scarred)');
  });
});

// The chat card lays the outcome out as rows — headline, defence, verdict,
// state — rather than one run-on sentence, so it needs the pieces apart.
describe('outcome rows for the chat card', () => {
  it('splits a miss into a verdict and no state', () => {
    const r = swadeDamageOutcome(4, 5, wc);
    expect(r.verdict).toBe('No effect');
    expect(r.stateNote).toBe(null);
  });

  it('reports Shaken with nothing to add', () => {
    const r = swadeDamageOutcome(6, 5, wc);
    expect(r.verdict).toBe('Shaken');
    expect(r.stateNote).toBe(null);
  });

  it('names the re-Shake that upgrades to a Wound', () => {
    const r = swadeDamageOutcome(6, 5, { ...wc, alreadyShaken: true });
    expect(r.verdict).toBe('1 Wound');
    expect(r.stateNote).toBe('now 1 Wound, Shaken');
  });

  it('carries the wound count into the state line', () => {
    const r = swadeDamageOutcome(13, 5, { ...wc, currentWounds: 1 });
    expect(r.verdict).toBe('2 Wounds');
    expect(r.stateNote).toBe('now 3 Wounds, Shaken');
  });

  // The screenshot case: an Extra taking its first Wound drops on the spot,
  // so the state line is the incapacitation, not a wound tally.
  it('replaces the tally with INCAPACITATED when the target drops', () => {
    const r = swadeDamageOutcome(12, 5, { alreadyShaken: false, wildCard: false, currentWounds: 0 });
    expect(r.verdict).toBe('1 Wound');
    expect(r.stateNote).toBe('INCAPACITATED');
  });

  it('keeps the one-line summary agreeing with the pieces', () => {
    const r = swadeDamageOutcome(12, 5, { alreadyShaken: false, wildCard: false, currentWounds: 0 });
    expect(r.summary).toBe('1 Wound — INCAPACITATED (12 vs Toughness 5)');
  });
});
