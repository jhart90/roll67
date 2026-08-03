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
