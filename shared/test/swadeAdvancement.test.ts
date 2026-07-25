import { describe, expect, it } from 'vitest';
import {
  ADVANCES_PER_RANK, advanceOptions, advanceRanksUp, advancesToNextRank, applyAdvance,
  canRaiseAttribute, edgeEligibility, edgeOptions, rankForAdvances, rankIndexForAdvances,
  skillStandings, untakenSkills, EDGE_ENTRIES_SWADE,
} from '../src/systems/swadeAdvancement.js';
import { swade, swadeToughness, gearTraitBonus } from '../src/systems/swade.js';
import type { SheetData } from '../src/types.js';

function sheet(over: SheetData = {}): SheetData {
  return { ...swade.defaultSheet(), ...over };
}

describe('SWADE rank + advance math', () => {
  it('every four Advances raises the Rank', () => {
    expect(rankForAdvances(0)).toBe('Novice');
    expect(rankForAdvances(3)).toBe('Novice');
    expect(rankForAdvances(4)).toBe('Seasoned');
    expect(rankForAdvances(8)).toBe('Veteran');
    expect(rankForAdvances(12)).toBe('Heroic');
    expect(rankForAdvances(16)).toBe('Legendary');
    expect(rankForAdvances(40)).toBe('Legendary'); // caps
    expect(ADVANCES_PER_RANK).toBe(4);
  });

  it('counts down to the next Rank and flags the Advance that crosses it', () => {
    expect(advancesToNextRank(0)).toBe(4);
    expect(advancesToNextRank(3)).toBe(1);
    expect(advancesToNextRank(16)).toBe(0); // already Legendary
    expect(advanceRanksUp(3)).toBe(true);   // the 4th Advance ranks you up
    expect(advanceRanksUp(2)).toBe(false);
  });
});

describe('skill standings decide what an Advance buys', () => {
  it('separates skills at/above their linked attribute from those below', () => {
    // Fighting is linked to Agility. Agility d6: Fighting d6 is "at",
    // Fighting d4 is "below".
    const s = sheet({
      agility: 'd6', smarts: 'd6',
      skills: [
        { name: 'Fighting', die: 'd6' },
        { name: 'Stealth', die: 'd4' },
        { name: 'Notice', die: 'd8' },
      ],
    });
    const st = skillStandings(s);
    expect(st.find((x) => x.name === 'Fighting')!.atOrAbove).toBe(true);
    expect(st.find((x) => x.name === 'Stealth')!.atOrAbove).toBe(false);
    expect(st.find((x) => x.name === 'Notice')!.atOrAbove).toBe(true);
    expect(st.find((x) => x.name === 'Fighting')!.linkedAttr).toBe('agility');
  });

  it('flags d12 skills as maxed', () => {
    const st = skillStandings(sheet({ skills: [{ name: 'Fighting', die: 'd12' }] }));
    expect(st[0].maxed).toBe(true);
  });

  it('untakenSkills excludes what the character already has', () => {
    const s = sheet({ skills: [{ name: 'Fighting', die: 'd6' }] });
    expect(untakenSkills(s)).not.toContain('Fighting');
    expect(untakenSkills(s)).toContain('Hacking');
  });
});

describe('advance options gate on what the character can actually do', () => {
  it('offers the two-low-skills option only with two eligible skills', () => {
    const one = sheet({ agility: 'd8', skills: [{ name: 'Fighting', die: 'd4' }] });
    expect(advanceOptions(one).find((o) => o.kind === 'skillsLow')!.available).toBe(false);
    const two = sheet({ agility: 'd8', skills: [{ name: 'Fighting', die: 'd4' }, { name: 'Stealth', die: 'd4' }] });
    expect(advanceOptions(two).find((o) => o.kind === 'skillsLow')!.available).toBe(true);
  });

  it('offers the single-skill option only when one is at or above its attribute', () => {
    const below = sheet({ agility: 'd8', skills: [{ name: 'Fighting', die: 'd4' }] });
    expect(advanceOptions(below).find((o) => o.kind === 'skillHigh')!.available).toBe(false);
    const at = sheet({ agility: 'd6', skills: [{ name: 'Fighting', die: 'd6' }] });
    expect(advanceOptions(at).find((o) => o.kind === 'skillHigh')!.available).toBe(true);
  });

  it('allows an attribute raise once per Rank and blocks the second', () => {
    const fresh = sheet({ advances: 0 });
    expect(canRaiseAttribute(fresh)).toBe(true);
    const used = applyAdvance(fresh, { kind: 'attribute', attrId: 'vigor' });
    const after = sheet({ ...used.patch });
    expect(canRaiseAttribute(after)).toBe(false);
    expect(advanceOptions(after).find((o) => o.kind === 'attribute')!.available).toBe(false);
    // Crossing into the next Rank frees it again.
    const nextRank = sheet({ ...after, advances: 4 });
    expect(canRaiseAttribute(nextRank)).toBe(true);
  });
});

describe('Edge eligibility', () => {
  it('blocks Edges above the character Rank', () => {
    const novice = sheet({ advances: 0 });
    const block = EDGE_ENTRIES_SWADE.find((e) => e.name === 'Block')!; // Seasoned
    expect(edgeEligibility(novice, block).eligible).toBe(false);
    expect(edgeEligibility(novice, block).reason).toMatch(/Seasoned/);
    const seasoned = sheet({ advances: 4, skills: [{ name: 'Fighting', die: 'd8' }] });
    expect(edgeEligibility(seasoned, block).eligible).toBe(true);
  });

  it('blocks Edges whose trait minimum is unmet, and allows it once met', () => {
    const weak = sheet({ advances: 4, skills: [{ name: 'Fighting', die: 'd6' }] });
    const block = EDGE_ENTRIES_SWADE.find((e) => e.name === 'Block')!; // Fighting d8+
    expect(edgeEligibility(weak, block).eligible).toBe(false);
    expect(edgeEligibility(weak, block).reason).toMatch(/Fighting d8/);
  });

  it('checks attribute minimums too', () => {
    const quick = EDGE_ENTRIES_SWADE.find((e) => e.name === 'Quick')!; // Agility d8+
    expect(edgeEligibility(sheet({ agility: 'd6' }), quick).eligible).toBe(false);
    expect(edgeEligibility(sheet({ agility: 'd8' }), quick).eligible).toBe(true);
  });

  it('never blocks on unparseable prose requirements', () => {
    const alertness = EDGE_ENTRIES_SWADE.find((e) => e.name === 'Alertness')!; // "Novice"
    expect(edgeEligibility(sheet(), alertness).eligible).toBe(true);
  });

  it('refuses an Edge the character already has', () => {
    const s = sheet({ edges: [{ name: 'Alertness' }] });
    const alertness = EDGE_ENTRIES_SWADE.find((e) => e.name === 'Alertness')!;
    expect(edgeEligibility(s, alertness).reason).toBe('Already taken.');
    expect(edgeOptions(s).find((e) => e.entry.name === 'Alertness')!.eligible).toBe(false);
  });
});

describe('applyAdvance produces a correct patch', () => {
  it('bumps the Advance count and Rank, announcing a rank-up', () => {
    const s = sheet({ advances: 3, skills: [{ name: 'Fighting', die: 'd6' }], agility: 'd6' });
    const res = applyAdvance(s, { kind: 'skillHigh', skill: 'Fighting' });
    expect(res.patch.advances).toBe(4);
    expect(res.patch.rank).toBe('Seasoned');
    expect(res.summary).toMatch(/Seasoned Rank/);
  });

  it('raises a single high skill a die type', () => {
    const s = sheet({ agility: 'd6', skills: [{ name: 'Fighting', die: 'd6' }] });
    const res = applyAdvance(s, { kind: 'skillHigh', skill: 'Fighting' });
    expect((res.patch.skills as SheetData[])[0].die).toBe('d8');
    expect(res.showcase).toEqual({ label: 'Fighting', die: 'd8', kind: 'skill' });
  });

  it('raises two low skills on one Advance', () => {
    const s = sheet({ agility: 'd10', skills: [{ name: 'Fighting', die: 'd4' }, { name: 'Stealth', die: 'd6' }] });
    const res = applyAdvance(s, { kind: 'skillsLow', skills: ['Fighting', 'Stealth'] });
    const out = res.patch.skills as SheetData[];
    expect(out.find((x) => x.name === 'Fighting')!.die).toBe('d6');
    expect(out.find((x) => x.name === 'Stealth')!.die).toBe('d8');
  });

  it('adds a brand-new skill at d4', () => {
    const s = sheet({ skills: [] });
    const res = applyAdvance(s, { kind: 'newSkill', skill: 'Hacking' });
    expect(res.patch.skills).toEqual([{ name: 'Hacking', die: 'd4', notes: '' }]);
  });

  it('raises an attribute and records the Rank so it cannot repeat', () => {
    const s = sheet({ vigor: 'd6', advances: 0 });
    const res = applyAdvance(s, { kind: 'attribute', attrId: 'vigor' });
    expect(res.patch.vigor).toBe('d8');
    expect(res.patch.attrRaisedAtRank).toBe(0);
    // Toughness follows the new Vigor automatically.
    expect(swadeToughness({ ...s, ...res.patch })).toBe(swadeToughness(s) + 1);
  });

  it('adds an Edge with its live modifier columns, so it works immediately', () => {
    const s = sheet();
    const res = applyAdvance(s, { kind: 'edge', edgeName: 'Alertness' });
    const edge = (res.patch.edges as SheetData[])[0];
    expect(edge.name).toBe('Alertness');
    expect(edge.bonusSkill).toBe('Notice');
    expect(edge.bonusAmt).toBe(2);
    expect(gearTraitBonus({ ...s, ...res.patch }, 'Notice')).toBe(2);
  });

  it('a Brawny Advance immediately raises Toughness', () => {
    const s = sheet();
    const res = applyAdvance(s, { kind: 'edge', edgeName: 'Brawny' });
    expect(swadeToughness({ ...s, ...res.patch })).toBe(swadeToughness(s) + 1);
  });

  it('never pushes a trait past d12', () => {
    const s = sheet({ agility: 'd12', skills: [{ name: 'Fighting', die: 'd12' }] });
    expect(applyAdvance(s, { kind: 'attribute', attrId: 'agility' }).patch.agility).toBe('d12');
    const raised = applyAdvance(s, { kind: 'skillHigh', skill: 'Fighting' });
    expect((raised.patch.skills as SheetData[])[0].die).toBe('d12');
  });
});
