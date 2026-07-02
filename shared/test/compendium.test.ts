import { describe, expect, it } from 'vitest';
import { ALL_CONTENT, applyEntry, contentById, contentForSystem, contentKinds } from '../src/data/compendium.js';
import { dnd5e } from '../src/systems/dnd5e.js';
import { swn } from '../src/systems/swn.js';

describe('compendium data', () => {
  it('has a broad catalogue for both systems', () => {
    expect(ALL_CONTENT.length).toBeGreaterThanOrEqual(250);
    expect(contentForSystem('dnd5e').length).toBeGreaterThanOrEqual(180);
    expect(contentForSystem('swn').length).toBeGreaterThanOrEqual(60);
  });

  it('all ids are unique and resolvable', () => {
    const ids = new Set(ALL_CONTENT.map((c) => c.id));
    expect(ids.size).toBe(ALL_CONTENT.length);
    for (const c of ALL_CONTENT) expect(contentById(c.id)).toBe(c);
  });

  it('exposes weapons, armor, gear, magic items and spells for 5e', () => {
    expect(contentKinds('dnd5e')).toEqual(expect.arrayContaining(['weapon', 'armor', 'gear', 'magicitem', 'spell']));
    expect(contentKinds('swn')).toEqual(expect.arrayContaining(['weapon', 'armor', 'gear', 'power']));
  });

  it('every weapon/spell carries the structured payload it needs', () => {
    for (const c of ALL_CONTENT) {
      if (c.kind === 'weapon') expect(c.weapon, c.id).toBeTruthy();
      if (c.kind === 'spell') expect(c.spell, c.id).toBeTruthy();
      if (c.kind === 'power') expect(c.power, c.id).toBeTruthy();
    }
  });
});

describe('applyEntry -> sheet rows', () => {
  it('a 5e martial weapon becomes a rollable attack with STR + proficiency', () => {
    const longsword = contentById('dnd5e-weapon-longsword')!;
    const sheet = { ...dnd5e.defaultSheet(), str: 16, level: 5 }; // +3 STR, +3 prof
    const res = applyEntry(longsword, sheet)!;
    expect(res.listId).toBe('attacks');
    expect(res.row.bonus).toBe(6);        // +3 mod +3 prof
    expect(res.row.damage).toBe('1d8+3');
    // Once on the sheet, rollables exposes it as a click-to-roll attack.
    const withWeapon = { ...sheet, attacks: [res.row] };
    const rolls = dnd5e.rollables(withWeapon);
    expect(rolls.find((r) => r.id === 'attack_0')?.expr).toBe('1d20+6');
    expect(rolls.find((r) => r.id === 'damage_0')?.expr).toBe('1d8+3');
  });

  it('a finesse weapon uses the better of STR/DEX', () => {
    const rapier = contentById('dnd5e-weapon-rapier')!;
    const sheet = { ...dnd5e.defaultSheet(), str: 10, dex: 18, level: 1 };
    const res = applyEntry(rapier, sheet)!;
    expect(res.row.damage).toBe('1d8+4'); // dex +4 beats str +0
    expect(res.row.bonus).toBe(6);        // +4 mod +2 prof
  });

  it('a damaging spell lands in the spells list and becomes rollable', () => {
    const fireball = contentById('dnd5e-spell-fireball')!;
    const sheet = dnd5e.defaultSheet();
    const res = applyEntry(fireball, sheet)!;
    expect(res.listId).toBe('spells');
    expect(res.row.level).toBe(3);
    expect(res.row.damage).toBe('8d6');
    const withSpell = { ...sheet, spells: [res.row] };
    const rolls = dnd5e.rollables(withSpell);
    expect(rolls.find((r) => r.group === 'Spells' && r.expr === '8d6')).toBeTruthy();
  });

  it('a cantrip lands in the cantrips list', () => {
    const firebolt = contentById('dnd5e-spell-fire-bolt')!;
    const res = applyEntry(firebolt, dnd5e.defaultSheet())!;
    expect(res.listId).toBe('cantrips');
    expect(res.row.damage).toBe('1d10');
  });

  it('an SWN weapon becomes an attack row', () => {
    const rifle = contentById('swn-weapon-combat-rifle')!;
    const res = applyEntry(rifle, swn.defaultSheet())!;
    expect(res.listId).toBe('attacks');
    expect(res.row.damage).toBe('1d12');
  });

  it('an SWN psychic power lands in the powers list', () => {
    const ram = contentById('swn-power-telekinetic-ram')!;
    const res = applyEntry(ram, swn.defaultSheet())!;
    expect(res.listId).toBe('powers');
    expect(res.row.discipline).toBe('Telekinesis');
  });

  it('gear and magic items go to inventory', () => {
    const rope = contentById('dnd5e-gear-rope-50-feet-hemp')!;
    expect(applyEntry(rope, dnd5e.defaultSheet())!.listId).toBe('inventory');
    const bag = contentById('dnd5e-magicitem-bag-of-holding')!;
    expect(applyEntry(bag, dnd5e.defaultSheet())!.listId).toBe('inventory');
  });
});
