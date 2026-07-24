import { describe, expect, it } from 'vitest';
import { swn, swnDerivedAc, cyberwareStrainTotal, cyberInitBonus } from '../src/systems/swn.js';
import { combatActions } from '../src/systems/combat.js';
import { applyEntry, contentForSystem } from '../src/data/compendium.js';
import { NPCS_SWN } from '../src/data/npcsSwn.js';
import type { Character, SheetData } from '../src/types.js';

const bySwnName = (name: string) => contentForSystem('swn').find((c) => c.name === name)!;

function charWith(sheet: SheetData): Character {
  return { id: 'c', campaignId: 'x', ownerUserId: null, name: 'Test', system: 'swn', sheet } as unknown as Character;
}

describe('SWN compendium automation', () => {
  it('weapon props become live stats: shock threshold, magazine, energy cells', () => {
    const sheet = swn.defaultSheet();
    const mono = applyEntry(bySwnName('Mono-blade'), sheet)!.row;
    expect(mono).toMatchObject({ shock: 2, shockAc: 15 });
    expect(applyEntry(bySwnName('Semi-auto Pistol'), sheet)!.row).toMatchObject({ ammo: 15 });
    expect(applyEntry(bySwnName('Laser Pistol'), sheet)!.row).toMatchObject({ ammo: 10 }); // "10 shots"
  });

  it('grenades become sphere-template attacks with an Evasion-for-half save', () => {
    const frag = applyEntry(bySwnName('Frag Grenade'), swn.defaultSheet())!.row;
    expect(frag).toMatchObject({ aoeShape: 'sphere', aoeSize: 20, save: 'evasion', onSave: 'half' });
    const character = charWith({ ...swn.defaultSheet(), attacks: [frag] });
    const action = combatActions(character).find((a) => a.id === 'attack:0')!;
    expect(action.aoe).toEqual({ shape: 'sphere', sizeFt: 20 });
    expect(action.saveId).toBe('evasion');
    expect(action.attackExpr).toBeNull(); // save-based, not to-hit
  });

  it('shock data flows into the combat action for miss-shock resolution', () => {
    const sheet = { ...swn.defaultSheet(), attacks: [applyEntry(bySwnName('Mono-blade'), swn.defaultSheet())!.row] };
    const action = combatActions(charWith(sheet)).find((a) => a.id === 'attack:0')!;
    expect(action.shockDamage).toBe(2);
    expect(action.shockAc).toBe(15);
  });

  it('a Shield is AC 13 alone and +1 on top of better armor — never a base-AC clobber', () => {
    const base = swn.defaultSheet();
    const shield = applyEntry(bySwnName('Shield'), base)!.row;
    expect(shield).toMatchObject({ ac: 13, shield: true });
    // Shield alone (manual AC 10): 13.
    expect(swnDerivedAc({ ...base, ac: 10, armor: [{ ...shield, equipped: true }] })).toBe(13);
    // Shield + Combat Field Uniform (AC 15): 16.
    const cfu = applyEntry(bySwnName('Combat Field Uniform'), base)!.row;
    expect(swnDerivedAc({ ...base, armor: [{ ...cfu, equipped: true }, { ...shield, equipped: true }] })).toBe(16);
    // Unequipped shield: nothing.
    expect(swnDerivedAc({ ...base, ac: 10, armor: [{ ...shield, equipped: false }] })).toBe(10);
  });

  it('cyberware installs into the cyberware list with live strain / AC / initiative effects', () => {
    const base = swn.defaultSheet();
    const dermal = applyEntry(bySwnName('Dermal Plating'), base)!;
    expect(dermal.listId).toBe('cyberware');
    expect(dermal.row).toMatchObject({ strain: 1, acBonus: 1 });
    const reflexes = applyEntry(bySwnName('Boosted Reflexes'), base)!;
    expect(reflexes.row).toMatchObject({ strain: 1, initBonus: 1 });
    const sheet = { ...base, ac: 12, cyberware: [dermal.row, reflexes.row] };
    expect(swnDerivedAc(sheet)).toBe(13); // 12 + dermal 1
    expect(cyberwareStrainTotal(sheet)).toBe(2);
    expect(cyberInitBonus(sheet)).toBe(1);
    expect(swn.initiativeExpr(sheet)).toBe('1d8+1'); // dex 10 → +0, reflexes +1
  });

  it('Healing Touch and Psionic Assault are full actions with real ranges', () => {
    const base = { ...swn.defaultSheet(), skills: [{ name: 'Biopsionics', level: 1, attr: 'wis' }, { name: 'Metapsionics', level: 1, attr: 'wis' }] };
    const heal = applyEntry(bySwnName('Healing Touch'), base)!.row;
    const assault = applyEntry(bySwnName('Psionic Assault'), base)!.row;
    const actions = combatActions(charWith({ ...base, powers: [heal, assault] }));
    const healAction = actions.find((a) => a.label === 'Healing Touch')!;
    expect(healAction.effect).toBe('heal');
    expect(healAction.amountExpr).toBe('1d6+2');
    expect(healAction.rangeFt).toBe(5);
    const assaultAction = actions.find((a) => a.label === 'Psionic Assault')!;
    expect(assaultAction.rangeFt).toBe(300);
    expect(assaultAction.saveId).toBe('mental');
  });

  it('healing consumables (Lazarus Patch, Stim Injector) become usable heal items', () => {
    const patch = applyEntry(bySwnName('Lazarus Patch'), swn.defaultSheet())!.row;
    expect(patch).toMatchObject({ effect: 'heal', amount: '1d8' });
    const stim = applyEntry(bySwnName('Stim Injector'), swn.defaultSheet())!.row;
    expect(stim).toMatchObject({ effect: 'heal', amount: '1d6' });
  });

  it('library NPCs: soldier grenades are AoE saves; robots are poison-immune', () => {
    const soldier = NPCS_SWN.find((n) => n.name === 'Regular Soldier')!;
    const grenade = combatActions(charWith(soldier.sheet)).find((a) => a.label === 'Frag Grenade')!;
    expect(grenade.aoe).toEqual({ shape: 'sphere', sizeFt: 20 });
    expect(grenade.saveId).toBe('evasion');
    const bot = NPCS_SWN.find((n) => n.name === 'Security Bot')!;
    expect(bot.sheet.immune).toBe('poison');
  });
});
