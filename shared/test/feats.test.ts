import { describe, expect, it } from 'vitest';
import { dnd5e } from '../src/systems/dnd5e.js';
import { applyLevelUp } from '../src/systems/levelup5e.js';
import { combatResources } from '../src/systems/effects.js';
import { superiorityDice } from '../src/systems/features5e.js';
import {
  applyFeat, dualWielderAcBonus, featBonuses, featEffects, FEATS_5E,
  hasConcentrationAdvantage, meetsPrereq, powerAttackBonus, takenFeatIds,
} from '../src/systems/feats5e.js';

describe('feat catalog', () => {
  it('has a broad catalog with unique ids', () => {
    expect(FEATS_5E.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FEATS_5E.map((f) => f.id)).size).toBe(FEATS_5E.length);
  });
});

describe('feat effects', () => {
  it('half-feat raises a fixed ability (Actor +1 CHA)', () => {
    const eff = featEffects({ cha: 14 }, 'actor')!;
    expect(eff.stats.cha).toBe(15);
    expect(eff.feature.name).toBe('Actor');
  });

  it('Resilient raises the chosen ability and grants its save proficiency', () => {
    const eff = featEffects({ con: 13 }, 'resilient', 'con')!;
    expect(eff.stats.con).toBe(14);
    expect(eff.stats.save_con).toBe(true);
  });

  it('Tough adds 2 HP per level to both current and max', () => {
    const eff = featEffects({ level: 5, hp: 40, maxHp: 40 }, 'tough')!;
    expect(eff.stats.maxHp).toBe(50);
    expect(eff.stats.hp).toBe(50);
  });

  it('Mobile adds 10 speed; ability +1 caps at 20', () => {
    expect(featEffects({ speed: 30 }, 'mobile')!.stats.speed).toBe(40);
    expect(featEffects({ str: 20 }, 'heavily-armored')!.stats.str).toBe(20);
  });

  it('applyFeat records the feat in the feats list and features', () => {
    const patch = applyFeat({ level: 3, feats: ['alert'] }, 'tough');
    expect(patch.feats).toEqual(['alert', 'tough']);
    expect((patch.features as unknown[]).some((f) => (f as { name: string }).name === 'Tough')).toBe(true);
  });
});

describe('ongoing feat bonuses feed the sheet', () => {
  it('Alert adds +5 initiative; Observant adds +5 passive Perception', () => {
    expect(featBonuses({ feats: ['alert', 'observant'] })).toEqual({ initiative: 5, passivePerception: 5 });

    const sheet = { ...dnd5e.defaultSheet(), dex: 14, feats: ['alert'] };
    expect(dnd5e.rollables(sheet).find((r) => r.id === 'initiative')?.expr).toBe('1d20+7'); // +2 DEX +5 Alert
    expect(dnd5e.derive(sheet).initiative).toBe('+7');

    const obs = { ...dnd5e.defaultSheet(), wis: 12, feats: ['observant'] };
    expect(dnd5e.derive(obs).passivePerception).toBe(10 + 1 + 5); // 10 + WIS +5 Observant
  });
});

describe('feats via the level-up wizard', () => {
  it('taking a half-feat at an ASI level raises the ability and records it', () => {
    const sheet = { ...dnd5e.defaultSheet(), class: 'Fighter', level: 3, cha: 12, maxHp: 28, hp: 28 };
    const patch = applyLevelUp(sheet, 'fighter', 4, {
      hpGained: 6, asi: { mode: 'feat', featId: 'actor' },
    });
    expect(patch.cha).toBe(13);
    expect(takenFeatIds(patch)).toContain('actor');
  });
});

describe('feat prerequisites', () => {
  it('checkable ability prereqs block until met, and pass once met', () => {
    const duelist = FEATS_5E.find((f) => f.id === 'defensive-duelist')!;
    expect(meetsPrereq({ dex: 12 }, duelist)).toBe(false);
    expect(meetsPrereq({ dex: 13 }, duelist)).toBe(true);
  });

  it('an "X or Y" prereq passes if either ability meets the threshold', () => {
    const ritualCaster = FEATS_5E.find((f) => f.id === 'ritual-caster')!;
    expect(meetsPrereq({ int: 10, wis: 10 }, ritualCaster)).toBe(false);
    expect(meetsPrereq({ int: 10, wis: 13 }, ritualCaster)).toBe(true);
    expect(meetsPrereq({ int: 13, wis: 10 }, ritualCaster)).toBe(true);
  });

  it('unchecked prereqs (spellcasting, armor proficiency) never block', () => {
    const warCaster = FEATS_5E.find((f) => f.id === 'war-caster')!;
    expect(meetsPrereq({}, warCaster)).toBe(true);
    const heavyArmorMaster = FEATS_5E.find((f) => f.id === 'heavy-armor-master')!;
    expect(meetsPrereq({}, heavyArmorMaster)).toBe(true);
  });
});

describe('Great Weapon Master / Sharpshooter power-attack toggle', () => {
  it('does nothing until the toggle is on, even with the feat', () => {
    const sheet = { feats: ['great-weapon-master'] };
    expect(powerAttackBonus(sheet, false)).toEqual({ toHit: 0, damage: 0 });
  });

  it('GWM applies −5/+10 to melee only; Sharpshooter to ranged only', () => {
    const gwm = { feats: ['great-weapon-master'], powerAttackActive: true };
    expect(powerAttackBonus(gwm, false)).toEqual({ toHit: -5, damage: 10 });
    expect(powerAttackBonus(gwm, true)).toEqual({ toHit: 0, damage: 0 });

    const ss = { feats: ['sharpshooter'], powerAttackActive: true };
    expect(powerAttackBonus(ss, true)).toEqual({ toHit: -5, damage: 10 });
    expect(powerAttackBonus(ss, false)).toEqual({ toHit: 0, damage: 0 });
  });

  it('flows through to the attack/damage rollables for a melee weapon', () => {
    const sheet = {
      ...dnd5e.defaultSheet(), feats: ['great-weapon-master'], powerAttackActive: true,
      attacks: [{ name: 'Greataxe', bonus: 5, damage: '1d12+3', range: 5 }],
    };
    const rollables = dnd5e.rollables(sheet);
    expect(rollables.find((r) => r.id === 'attack_0')?.expr).toBe('1d20+0'); // 5 − 5
    expect(rollables.find((r) => r.id === 'damage_0')?.expr).toBe('1d12+3+10');
  });
});

describe('Dual Wielder AC toggle', () => {
  it('adds its bonus only while toggled on, surfaced as the derived ac badge', () => {
    const sheet = { ...dnd5e.defaultSheet(), ac: 14, feats: ['dual-wielder'] };
    expect(dualWielderAcBonus(sheet)).toBe(0);
    expect(dnd5e.derive(sheet).ac).toBe(14);

    const on = { ...sheet, dualWieldingActive: true };
    expect(dualWielderAcBonus(on)).toBe(1);
    expect(dnd5e.derive(on).ac).toBe(15);
  });
});

describe('War Caster concentration advantage', () => {
  it('is only granted with the feat', () => {
    expect(hasConcentrationAdvantage({ feats: ['war-caster'] })).toBe(true);
    expect(hasConcentrationAdvantage({ feats: ['tough'] })).toBe(false);
  });
});

describe('Savage Attacker resource pool', () => {
  it('only appears for characters with the feat, resets each round', () => {
    expect(combatResources('dnd5e', {}).some((r) => r.id === 'savageAttacker')).toBe(false);
    const resources = combatResources('dnd5e', { feats: ['savage-attacker'] });
    const sa = resources.find((r) => r.id === 'savageAttacker')!;
    expect(sa).toBeDefined();
    expect(sa.max).toBe(1);
    expect(sa.reset).toBe('round');
  });
});

describe('Martial Adept superiority die', () => {
  it('grants a single d6 die outside Battle Master', () => {
    expect(superiorityDice({ class: 'Fighter', feats: ['martial-adept'] })).toEqual({ count: 1, die: 'd6' });
    expect(superiorityDice({ class: 'Wizard' })).toBeNull();
  });
});
