import { describe, expect, it } from 'vitest';
import { swn, cyberwareStrainTotal } from '../src/systems/swn.js';
import { applyLevelUpSwn } from '../src/systems/swnData.js';
import { combatResources } from '../src/systems/effects.js';

function char(sheet: Record<string, unknown>) {
  return { ...swn.defaultSheet(), ...sheet };
}
function focus(id: string, level = 1) {
  return { id, name: id, level };
}

describe('Phase 6: SWN foci mechanics', () => {
  it('Unarmed Strike scales 1d4 -> 1d6 -> 1d8 with Unarmed Combatant', () => {
    const base = swn.rollables(char({}));
    expect(base.find((r) => r.id === 'unarmed_damage')?.expr).toBe('1d4');

    const l1 = swn.rollables(char({ foci: [focus('unarmed-combatant', 1)] }));
    expect(l1.find((r) => r.id === 'unarmed_damage')?.expr).toBe('1d6');

    const l2 = swn.rollables(char({ foci: [focus('unarmed-combatant', 2)] }));
    expect(l2.find((r) => r.id === 'unarmed_damage')?.expr).toBe('1d8');
  });

  it('Armsman also upgrades Unarmed Strike and adds melee shock', () => {
    const rollables = swn.rollables(char({
      level: 5, foci: [focus('armsman', 1)],
      attacks: [{ name: 'Knife', damage: '1d4', range: 5 }],
    }));
    expect(rollables.find((r) => r.id === 'unarmed_damage')?.expr).toBe('1d6+1'); // Armsman +1 shock
    expect(rollables.find((r) => r.id === 'damage_0')?.expr).toBe('1d4+1'); // melee weapon also gets +1
  });

  it('Shocking Assault adds character level to melee weapon shock damage', () => {
    const rollables = swn.rollables(char({
      level: 4, foci: [focus('shocking-assault', 1)],
      attacks: [{ name: 'Vibroblade', damage: '1d8', range: 5, shock: 1 }],
    }));
    expect(rollables.find((r) => r.id === 'damage_0')?.expr).toBe('1d8+5'); // 1 (row) + 4 (level)
  });

  it('Shock bonuses do not apply to ranged weapons (Shocking Assault/Armsman are melee-only)', () => {
    const rollables = swn.rollables(char({
      level: 4, foci: [focus('shocking-assault', 1), focus('armsman', 1)],
      attacks: [{ name: 'Rifle', damage: '1d10', range: 100 }],
    }));
    expect(rollables.find((r) => r.id === 'damage_0')?.expr).toBe('1d10');
  });

  it('Gunslinger: +1 to hit with pistols at level 1, +2 shock at level 2', () => {
    const l1 = swn.rollables(char({
      attackBonus: 2, foci: [focus('gunslinger', 1)],
      attacks: [{ name: 'Semi-Auto Pistol', bonus: 0, damage: '1d6', range: 30 }],
    }));
    expect(l1.find((r) => r.id === 'attack_0')?.expr).toBe('1d20+3'); // 2 + 1
    expect(l1.find((r) => r.id === 'damage_0')?.expr).toBe('1d6'); // no shock yet

    const l2 = swn.rollables(char({
      attackBonus: 2, foci: [focus('gunslinger', 2)],
      attacks: [{ name: 'Semi-Auto Pistol', bonus: 0, damage: '1d6', range: 30 }],
    }));
    expect(l2.find((r) => r.id === 'damage_0')?.expr).toBe('1d6+2');
  });

  it("Gunslinger's bonuses don't apply to non-pistol ranged weapons", () => {
    const rollables = swn.rollables(char({
      attackBonus: 2, foci: [focus('gunslinger', 2)],
      attacks: [{ name: 'Combat Rifle', bonus: 0, damage: '1d12', range: 100 }],
    }));
    expect(rollables.find((r) => r.id === 'attack_0')?.expr).toBe('1d20+2');
    expect(rollables.find((r) => r.id === 'damage_0')?.expr).toBe('1d12');
  });

  it('Ironhide sets a natural AC floor that does not stack with better worn armor', () => {
    expect(swn.derive(char({ ac: 10, foci: [focus('ironhide', 1)] })).ac).toBe(13);
    expect(swn.derive(char({ ac: 10, foci: [focus('ironhide', 2)] })).ac).toBe(15);
    // Armor already better than natural AC wins (no stacking).
    expect(swn.derive(char({ ac: 16, foci: [focus('ironhide', 1)] })).ac).toBe(16);
  });

  it('Alert adds +1 AC (always-on simplification) and +2 initiative at level 2', () => {
    expect(swn.derive(char({ ac: 10, foci: [focus('alert', 1)] })).ac).toBe(11);
    expect(swn.initiativeExpr(char({ dex: 10, foci: [focus('alert', 1)] }))).toBe('1d8+0');
    expect(swn.initiativeExpr(char({ dex: 10, foci: [focus('alert', 2)] }))).toBe('1d8+2');
  });

  it("Specialist rolls 3d6-keep-2 for the character's highest-level skill", () => {
    const rollables = swn.rollables(char({
      foci: [focus('specialist', 1)],
      skills: [{ name: 'Shoot', level: 2, attr: 'dex' }, { name: 'Talk', level: 0, attr: 'cha' }],
    }));
    expect(rollables.find((r) => r.label.startsWith('Shoot'))?.expr).toMatch(/^3d6kh2/);
    expect(rollables.find((r) => r.label.startsWith('Talk'))?.expr).toMatch(/^2d6/);
  });

  it('Authority adds +2 to the Lead skill', () => {
    const rollables = swn.rollables(char({
      foci: [focus('authority', 1)],
      skills: [{ name: 'Lead', level: 0, attr: 'cha', }],
    }));
    expect(rollables.find((r) => r.label.startsWith('Lead'))?.expr).toBe('2d6+2');
  });

  it('Authority (level 2) and Star Captain (level 2) grant scene-reset resource pools', () => {
    expect(combatResources('swn', char({})).some((r) => r.id === 'authorityMorale')).toBe(false);
    const withAuthority = combatResources('swn', char({ foci: [focus('authority', 2)] }));
    expect(withAuthority.find((r) => r.id === 'authorityMorale')?.reset).toBe('scene');
    const withStarCaptain = combatResources('swn', char({ foci: [focus('star-captain', 2)] }));
    expect(withStarCaptain.find((r) => r.id === 'starCaptainReroll')?.reset).toBe('scene');
  });

  it("Sniper's Aim toggle adds +4 to a ranged shot, and Shoot-skill dice at level 2", () => {
    const notAiming = swn.rollables(char({
      foci: [focus('sniper', 2)], skills: [{ name: 'Shoot', level: 3, attr: 'dex' }],
      attacks: [{ name: 'Rifle', bonus: 0, damage: '1d10', range: 100 }],
    }));
    expect(notAiming.find((r) => r.id === 'attack_0')?.expr).toBe('1d20+0');

    const aiming = swn.rollables(char({
      aimActive: true, foci: [focus('sniper', 2)], skills: [{ name: 'Shoot', level: 3, attr: 'dex' }],
      attacks: [{ name: 'Rifle', bonus: 0, damage: '1d10', range: 100 }],
    }));
    expect(aiming.find((r) => r.id === 'attack_0')?.expr).toBe('1d20+4');
    expect(aiming.find((r) => r.id === 'damage_0')?.expr).toBe('1d10+3d6');
  });

  it('Aim does nothing without the Sniper focus', () => {
    const rollables = swn.rollables(char({
      aimActive: true, attacks: [{ name: 'Rifle', bonus: 0, damage: '1d10', range: 100 }],
    }));
    expect(rollables.find((r) => r.id === 'attack_0')?.expr).toBe('1d20+0');
  });
});

describe('Phase 7: SWN gear/economy', () => {
  it('an equipped armor row overrides the manual AC field', () => {
    const sheet = char({ ac: 10, armor: [{ name: 'Vacc Suit', ac: 13, equipped: true }] });
    expect(swn.derive(sheet).ac).toBe(13);
  });

  it('an unequipped armor row is ignored — falls back to the manual field', () => {
    const sheet = char({ ac: 10, armor: [{ name: 'Vacc Suit', ac: 13, equipped: false }] });
    expect(swn.derive(sheet).ac).toBe(10);
  });

  it('equipped gear (e.g. Dermal Plating) adds an AC bonus on top of worn armor', () => {
    const sheet = char({
      ac: 10, armor: [{ name: 'Vacc Suit', ac: 13, equipped: true }],
      inventory: [{ name: 'Dermal Plating', acBonus: 1, equipped: true }],
    });
    expect(swn.derive(sheet).ac).toBe(14);
  });

  it('unequipping gear removes its AC/save bonus', () => {
    const item = { name: 'Dermal Plating', acBonus: 1, saveBonus: 1, equipped: true };
    expect(swn.derive(char({ ac: 10, inventory: [item] })).ac).toBe(11);
    expect(swn.derive(char({ ac: 10, inventory: [{ ...item, equipped: false }] })).ac).toBe(10);
  });

  it('an equipped save bonus lowers the save target number (easier to meet/beat)', () => {
    const sheet = char({ level: 1, str: 10, dex: 10, con: 10, inventory: [{ name: 'Ward Charm', saveBonus: 2, equipped: true }] });
    const base = swn.derive(char({ level: 1, str: 10, dex: 10, con: 10 })).save_physical;
    expect(swn.derive(sheet).save_physical).toBe(Number(base) - 2);
  });

  it('saveCheck (used to resolve an actual forced save) also carries the equipped item bonus', () => {
    const sheet = char({ level: 1, str: 10, dex: 10, con: 10, inventory: [{ name: 'Ward Charm', saveBonus: 2, equipped: true }] });
    const base = swn.saveCheck(char({ level: 1, str: 10, dex: 10, con: 10 }), 'physical', 0).threshold;
    expect(swn.saveCheck(sheet, 'physical', 0).threshold).toBe(base - 2);
  });

  it('encumbrance sums qty x enc across inventory, and capacity scales with STR', () => {
    const sheet = char({
      str: 14, // +1 mod
      inventory: [{ name: 'Rations', qty: 7, enc: 1 }, { name: 'Rifle ammo', qty: 2, enc: 2 }],
    });
    const d = swn.derive(sheet);
    expect(d.encumbrance).toBe(7 * 1 + 2 * 2);
    expect(d.encumbranceMax).toBe(6 + 3 * 1);
  });

  it('cyberware strain totals sum the cyberware list (informational — not written back to systemStrain)', () => {
    const sheet = char({
      systemStrain: 0,
      cyberware: [{ name: 'Comm Implant', strain: 1 }, { name: 'Combat Reflexes', strain: 2 }],
    });
    expect(cyberwareStrainTotal(sheet)).toBe(3);
    expect(swn.derive(sheet).systemStrain).toBeUndefined(); // manual field is untouched by derive()
  });
});

describe('Phase 8: SWN build depth', () => {
  it('applyLevelUpSwn grants 2 skill points per level, 3 for Expert', () => {
    const warriorPatch = applyLevelUpSwn(char({}), 'warrior', 1, { hpGained: 8 });
    expect(warriorPatch.skillPointsEarned).toBe(2);

    const expertPatch = applyLevelUpSwn(char({}), 'expert', 1, { hpGained: 4 });
    expect(expertPatch.skillPointsEarned).toBe(3);

    // Second level-up call accumulates on top of the sheet's current total.
    const second = applyLevelUpSwn(char({ skillPointsEarned: 3 }), 'expert', 2, { hpGained: 4 });
    expect(second.skillPointsEarned).toBe(6);
  });

  it('an Adventurer with Expert as their second class also earns the bonus point', () => {
    const patch = applyLevelUpSwn(char({ secondaryClass: 'Expert' }), 'adventurer', 1, { hpGained: 4 });
    expect(patch.skillPointsEarned).toBe(3);
  });

  it('skillPointsRemaining subtracts spent points (skill levels) from the earned total', () => {
    const sheet = char({
      skillPointsEarned: 5,
      skills: [{ name: 'Shoot', level: 2, attr: 'dex' }, { name: 'Talk', level: 1, attr: 'cha' }],
    });
    expect(swn.derive(sheet).skillPointsRemaining).toBe(5 - (2 + 1));
  });

  it("Adventurer folds in whichever of Warrior/Expert it picked as a second class", () => {
    const warriorAdv = combatResources('swn', char({ class: 'Adventurer', secondaryClass: 'Warrior' }));
    expect(warriorAdv.some((r) => r.id === 'knack')).toBe(true);
    expect(warriorAdv.some((r) => r.id === 'expertReroll')).toBe(false);

    const expertAdv = combatResources('swn', char({ class: 'Adventurer', secondaryClass: 'Expert' }));
    expect(expertAdv.some((r) => r.id === 'expertReroll')).toBe(true);
    expect(expertAdv.some((r) => r.id === 'knack')).toBe(false);
  });

  it('a plain Adventurer with no second class picked gets neither pool', () => {
    const plain = combatResources('swn', char({ class: 'Adventurer' }));
    expect(plain.some((r) => ['knack', 'expertReroll'].includes(r.id))).toBe(false);
  });
});
