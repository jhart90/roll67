import { describe, expect, it } from 'vitest';
import { applyEntry, contentForSystem, shopItemFromEntry } from '../src/data/compendium.js';
import { swade, swadeParry, swadeToughness, swadePace, gearTraitBonus } from '../src/systems/swade.js';
import { buildSwadeCharacterSheet } from '../src/systems/swadeCreation.js';
import { swn, swnDerivedAc } from '../src/systems/swn.js';
import { dnd5e } from '../src/systems/dnd5e.js';
import { combatActions } from '../src/systems/combat.js';
import { roll, seededRng } from '../src/dice/roller.js';
import type { Character, GameSystem, SheetData } from '../src/types.js';

const SYSTEM_SHEET: Record<GameSystem, () => SheetData> = {
  swade: () => swade.defaultSheet(),
  swn: () => swn.defaultSheet(),
  dnd5e: () => dnd5e.defaultSheet(),
};

function charWith(system: GameSystem, sheet: SheetData): Character {
  return { id: 'c', campaignId: 'x', ownerUserId: null, name: 'T', system, sheet } as unknown as Character;
}

/** Apply an entry onto a fresh sheet and hand back the resulting sheet. */
function sheetAfter(system: GameSystem, entryName: string): { sheet: SheetData; listId: string; row: SheetData } {
  const entry = contentForSystem(system).find((e) => e.name === entryName);
  if (!entry) throw new Error(`no ${system} entry named ${entryName}`);
  const base = SYSTEM_SHEET[system]();
  const applied = applyEntry(entry, base);
  if (!applied) throw new Error(`${entryName} did not apply`);
  const list = Array.isArray(base[applied.listId]) ? [...(base[applied.listId] as SheetData[])] : [];
  list.push(applied.row as SheetData);
  return { sheet: { ...base, [applied.listId]: list }, listId: applied.listId, row: applied.row as SheetData };
}

describe('every compendium entry applies cleanly', () => {
  for (const system of ['dnd5e', 'swn', 'swade'] as const) {
    it(`${system}: applyEntry returns a usable row for every entry`, () => {
      const entries = contentForSystem(system);
      expect(entries.length).toBeGreaterThan(80);
      for (const entry of entries) {
        const applied = applyEntry(entry, SYSTEM_SHEET[system]());
        expect(applied, `${entry.id} produced nothing`).toBeTruthy();
        expect(applied!.listId, `${entry.id} listId`).toBeTruthy();
        expect(applied!.row, `${entry.id} row`).toBeTruthy();
        expect(String((applied!.row as SheetData).name ?? ''), `${entry.id} name`).not.toBe('');
      }
    });

    it(`${system}: entries land on lists the sheet schema actually defines`, () => {
      const listIds = new Set<string>();
      for (const tab of (system === 'swade' ? swade : system === 'swn' ? swn : dnd5e).tabs) {
        for (const sec of tab.sections) if (sec.kind === 'list') listIds.add(sec.id);
      }
      for (const entry of contentForSystem(system)) {
        const applied = applyEntry(entry, SYSTEM_SHEET[system]())!;
        expect(listIds.has(applied.listId), `${entry.id} -> unknown list "${applied.listId}"`).toBe(true);
      }
    });

    it(`${system}: every applied weapon/power rolls without throwing`, () => {
      for (const entry of contentForSystem(system).filter((e) => e.kind === 'weapon' || e.kind === 'power' || e.kind === 'spell')) {
        const { sheet } = sheetAfter(system, entry.name);
        const schema = system === 'swade' ? swade : system === 'swn' ? swn : dnd5e;
        for (const r of schema.rollables(sheet)) {
          if (r.expr === '0') continue;
          expect(() => roll(r.expr, seededRng(3)), `${entry.id}: ${r.expr}`).not.toThrow();
        }
        for (const a of combatActions(charWith(system, sheet))) {
          if (a.attackExpr) expect(() => roll(a.attackExpr!, seededRng(4)), `${entry.id} atk`).not.toThrow();
          if (a.amountExpr && a.amountExpr !== '0') {
            expect(() => roll(a.amountExpr, seededRng(5)), `${entry.id} dmg`).not.toThrow();
          }
        }
      }
    });
  }
});

describe('SWADE Edges and Hindrances are mechanically live', () => {
  it('are present in the compendium in useful numbers', () => {
    const list = contentForSystem('swade');
    expect(list.filter((e) => e.kind === 'edge').length).toBeGreaterThanOrEqual(40);
    expect(list.filter((e) => e.kind === 'hindrance').length).toBeGreaterThanOrEqual(40);
  });

  it('Alertness raises the Notice roll it grants', () => {
    const { sheet } = sheetAfter('swade', 'Alertness');
    expect(gearTraitBonus(sheet, 'Notice')).toBe(2);
    const withSkill = { ...sheet, skills: [{ name: 'Notice', die: 'd6' }] };
    expect(swade.rollables(withSkill).find((r) => r.id === 'skill_0')!.expr).toBe('best(1d6!, 1d6!)+2');
  });

  it('Brawny raises Toughness and Fleet-Footed raises Pace', () => {
    const base = swade.defaultSheet();
    const brawny = sheetAfter('swade', 'Brawny').sheet;
    expect(swadeToughness(brawny)).toBe(swadeToughness(base) + 1);
    const fleet = sheetAfter('swade', 'Fleet-Footed').sheet;
    expect(swadePace(fleet)).toBe(swadePace(base) + 2);
    expect(Number(swade.derive(fleet).pace)).toBe(swadePace(base) + 2);
  });

  it('Block raises Parry; Improved Block raises it more', () => {
    const base = swadeParry(swade.defaultSheet());
    expect(swadeParry(sheetAfter('swade', 'Block').sheet)).toBe(base + 1);
    expect(swadeParry(sheetAfter('swade', 'Improved Block').sheet)).toBe(base + 2);
  });

  it('Hindrances apply their penalties and carry their severity', () => {
    const clumsy = sheetAfter('swade', 'Clumsy');
    expect(clumsy.row.severity).toBe('Major');
    expect(gearTraitBonus(clumsy.sheet, 'Athletics')).toBe(-2);
    const obese = sheetAfter('swade', 'Obese');
    expect(obese.row.severity).toBe('Minor');
    // Obese: slower but sturdier — both sides land.
    expect(swadePace(obese.sheet)).toBe(swadePace(swade.defaultSheet()) - 1);
    expect(swadeToughness(obese.sheet)).toBe(swadeToughness(swade.defaultSheet()) + 1);
    const small = sheetAfter('swade', 'Small');
    expect(swadeToughness(small.sheet)).toBe(swadeToughness(swade.defaultSheet()) - 1);
  });

  it('Edges land in the edges list and Hindrances in the hindrances list', () => {
    expect(sheetAfter('swade', 'Luck').listId).toBe('edges');
    expect(sheetAfter('swade', 'Bad Luck').listId).toBe('hindrances');
  });
});

describe('Edges taken at character creation are mechanically live', () => {
  const build = (edgeIds: string[], hindranceIds: string[] = []) => buildSwadeCharacterSheet({
    concept: '', ancestryName: 'Human', ancestryIsCustom: false,
    customTraitPicks: [],
    attributeSteps: { agility: 0, smarts: 0, spirit: 0, strength: 0, vigor: 0 },
    skillDice: { Notice: 'd6' }, hindranceIds, hindranceFundsSpent: 0, edgeIds,
  });

  it('writes Edge rows carrying their modifier columns, not bare name/notes', () => {
    const sheet = build(['alertness']);
    const alertness = (sheet.edges as SheetData[]).find((e) => e.name === 'Alertness')!;
    expect(alertness.bonusSkill).toBe('Notice');
    expect(alertness.bonusAmt).toBe(2);
  });

  it('an Edge taken at creation actually moves the roll it boosts', () => {
    expect(gearTraitBonus(build([]), 'Notice')).toBe(0);
    expect(gearTraitBonus(build(['alertness']), 'Notice')).toBe(2);
  });

  it('Brawny and Fleet-Footed move Toughness and Pace through the normal derive path', () => {
    const plain = build([]);
    expect(swadeToughness(build(['brawny']))).toBe(swadeToughness(plain) + 1);
    const fleet = build(['fleet-footed']);
    expect(swadePace(fleet)).toBe(swadePace(plain) + 2);
    expect(Number(swade.derive(fleet).pace)).toBe(swadePace(plain) + 2);
    expect(fleet.runningDie).toBe('d10');
  });

  it('no longer fakes Edge effects as phantom gear or armor rows', () => {
    // Alertness used to be smuggled in as an "Alertness (Edge)" inventory
    // item and Brawny as a fake armor row — both now live on the Edge itself.
    expect(build(['alertness']).inventory).toEqual([]);
    expect(build(['brawny']).armor).toEqual([]);
  });

  it('Hindrances taken at creation carry their penalties too', () => {
    expect(gearTraitBonus(build([], ['clueless']), 'Common Knowledge')).toBe(-1);
  });
});

describe('racial abilities are addable from the compendium after creation', () => {
  it('the whole Making Races table is present, one entry per priced tier', () => {
    const traits = contentForSystem('swade').filter((e) => e.kind === 'racialTrait');
    // 45 abilities, several of which expose 2–3 tiers.
    expect(traits.length).toBeGreaterThanOrEqual(55);
    expect(traits.some((t) => t.name === 'Hardy')).toBe(true);
    expect(traits.some((t) => t.name === 'Flight (Fly Pace 24)')).toBe(true);
    expect(traits.some((t) => t.name === 'Claws (d6, AP 2)')).toBe(true);
    expect(traits.some((t) => t.category === 'Positive Racial Ability')).toBe(true);
    expect(traits.some((t) => t.category === 'Negative Racial Ability')).toBe(true);
    // The build-point cost is surfaced for the GM's benefit.
    expect(traits.find((t) => t.name === 'Hardy')!.detail).toContain('+2 racial build points');
  });

  /** Apply a racial ability by name — several share a name with a power. */
  function addRacial(name: string) {
    const entry = contentForSystem('swade').find((e) => e.kind === 'racialTrait' && e.name === name);
    if (!entry) throw new Error(`no racial ability named ${name}`);
    const base = swade.defaultSheet();
    const applied = applyEntry(entry, base)!;
    const list = Array.isArray(base[applied.listId]) ? [...(base[applied.listId] as SheetData[])] : [];
    return { listId: applied.listId, sheet: { ...base, [applied.listId]: [...list, applied.row as SheetData] } };
  }

  it('adding one lands in Ancestry Traits and moves the stat it should', () => {
    const plain = swade.defaultSheet();
    const armor = addRacial('Armor');
    expect(armor.listId).toBe('racialTraits');
    expect(swadeToughness(armor.sheet)).toBe(swadeToughness(plain) + 2);
    expect(swadeParry(addRacial('Parry').sheet)).toBe(swadeParry(plain) + 1);
    expect(swadePace(addRacial('Reduced Pace (−1 Pace)').sheet)).toBe(swadePace(plain) - 1);
    expect(swadeToughness(addRacial('Frail').sheet)).toBe(swadeToughness(plain) - 1);
  });

  it('natural weapons arrive as real attacks using the character’s Strength die', () => {
    const entry = contentForSystem('swade').find((e) => e.name === 'Claws (d6, AP 2)')!;
    const sheet = { ...swade.defaultSheet(), strength: 'd10' };
    const applied = applyEntry(entry, sheet)!;
    expect(applied.listId).toBe('attacks');
    expect(applied.row).toMatchObject({ damage: '1d10!+1d6!', ap: 2, skill: 'Fighting' });
    // …and it is immediately usable as a combat action.
    const character = charWith('swade', { ...sheet, attacks: [applied.row as SheetData] });
    expect(combatActions(character).some((a) => a.label.startsWith('Claws'))).toBe(true);
  });

  it('they never leak into shop stock', () => {
    for (const e of contentForSystem('swade').filter((x) => x.kind === 'racialTrait')) {
      expect(shopItemFromEntry(e).price, e.name).toBe(0);
    }
  });
});

describe('expanded SWADE gear and weapons stay automated', () => {
  it('new healing gear becomes a usable heal item', () => {
    for (const [name, amount] of [['Healing Potion', '2d6'], ['Medkit (Modern)', '2d6'], ['Antitoxin', '1d6']] as const) {
      const { row } = sheetAfter('swade', name);
      expect(row.effect, name).toBe('heal');
      expect(row.amount, name).toBe(amount);
    }
  });

  it('new gear with a trait bonus boosts that trait once equipped', () => {
    const { sheet } = sheetAfter('swade', 'Surgical Kit');
    const equipped = { ...sheet, inventory: (sheet.inventory as SheetData[]).map((i) => ({ ...i, equipped: true })) };
    expect(gearTraitBonus(equipped, 'Healing')).toBe(2);
  });

  it('new weapons parse AP, Parry mods, and magazines', () => {
    expect(sheetAfter('swade', 'Vibro-Blade').row.ap).toBe(4);
    expect(sheetAfter('swade', 'Rapier (Main Gauche)').row.parryBonus).toBe(1);
    expect(sheetAfter('swade', 'Combat Shotgun').row.ammo).toBe(8);
    expect(sheetAfter('swade', 'Laser Rifle').row.ap).toBe(4);
  });

  it('new save-or-condition powers become targeted actions', () => {
    const { sheet } = sheetAfter('swade', 'Blind');
    const withSkill = { ...sheet, arcaneSkill: 'Spellcasting', skills: [{ name: 'Spellcasting', die: 'd8' }] };
    const action = combatActions(charWith('swade', withSkill)).find((a) => a.label === 'Blind')!;
    expect(action.saveId).toBe('agility');
    expect(action.appliesCondition).toBe('blinded');
  });
});

describe('expanded SWN content stays automated', () => {
  it('new weapons carry shock thresholds, magazines, and blast areas', () => {
    expect(sheetAfter('swn', 'Vibro-sword').row.shock).toBe(3);
    expect(sheetAfter('swn', 'Vibro-sword').row.shockAc).toBe(15);
    expect(sheetAfter('swn', 'Machine Pistol').row.ammo).toBe(20);
    const emp = sheetAfter('swn', 'EMP Grenade').row;
    expect(emp.aoeShape).toBe('sphere');
    expect(emp.save).toBe('evasion');
  });

  it('new armor sets AC, and shields keep the shield rule', () => {
    const plate = sheetAfter('swn', 'Plate Harness');
    expect(plate.row.ac).toBe(16);
    const worn = { ...plate.sheet, armor: [{ ...plate.row, equipped: true }] };
    expect(swnDerivedAc(worn)).toBe(16);
    const riot = sheetAfter('swn', 'Riot Shield').row;
    expect(riot.shield).toBe(true);
    expect(riot.ac).toBe(13);
  });

  it('new cyberware installs with strain and live bonuses', () => {
    const subdermal = sheetAfter('swn', 'Subdermal Armor');
    expect(subdermal.listId).toBe('cyberware');
    expect(subdermal.row.strain).toBe(2);
    expect(subdermal.row.acBonus).toBe(2);
    const reflex = sheetAfter('swn', 'Reflex Booster (Advanced)');
    expect(reflex.row.initBonus).toBe(2);
    expect(swn.initiativeExpr(reflex.sheet)).toBe('1d8+2');
  });

  it('new healing gear and cyberware become usable heal items', () => {
    expect(sheetAfter('swn', 'Trauma Pack').row.amount).toBe('2d6');
    expect(sheetAfter('swn', 'Trauma Kit (Pretech)').row.amount).toBe('3d6');
  });

  it('new psychic powers carry damage, saves, and ranges', () => {
    const assault = sheetAfter('swn', 'Telepathic Assault').row;
    expect(assault.damage).toBe('2d10');
    expect(assault.save).toBe('mental');
    expect(assault.range).toBe(200);
    const medicine = sheetAfter('swn', 'Field Medicine').row;
    expect(medicine.effect).toBe('heal');
    expect(medicine.damage).toBe('1d6');
  });
});
