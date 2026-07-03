import { describe, expect, it } from 'vitest';
import { dnd5e } from '../src/systems/dnd5e.js';
import { applyLevelUp } from '../src/systems/levelup5e.js';
import {
  applyFeat, featBonuses, featEffects, FEATS_5E, takenFeatIds,
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
