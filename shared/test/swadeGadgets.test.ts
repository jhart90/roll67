import { describe, expect, it } from 'vitest';
import { applyEntry, contentForSystem } from '../src/data/compendium.js';
import { swade } from '../src/systems/swade.js';
import { combatActions } from '../src/systems/combat.js';
import type { Character, SheetData } from '../src/types.js';

/** Apply a named SWADE entry to a fresh sheet and hand back the whole sheet. */
function sheetWith(entryName: string): SheetData {
  const entry = contentForSystem('swade').find((e) => e.name === entryName);
  if (!entry) throw new Error(`no swade entry named ${entryName}`);
  const base = swade.defaultSheet();
  const applied = applyEntry(entry, base);
  if (!applied) throw new Error(`${entryName} did not apply`);
  const list = Array.isArray(base[applied.listId]) ? [...(base[applied.listId] as SheetData[])] : [];
  list.push(applied.row as SheetData);
  return { ...base, [applied.listId]: list, strength: 'd6' };
}

const charWith = (sheet: SheetData): Character =>
  ({ id: 'c', campaignId: 'x', ownerUserId: 'u', name: 'T', system: 'swade', sheet }) as unknown as Character;

const actionsFor = (entryName: string) => combatActions(charWith(sheetWith(entryName)));

describe('Healing Drone', () => {
  it('lands in inventory as a single-use ranged healing item', () => {
    const sheet = sheetWith('Healing Drone');
    const row = (sheet.inventory as SheetData[]).at(-1)!;
    expect(row.effect).toBe('heal');
    expect(row.qty).toBe(1);
    // 40 tiles at the standard 5 ft per hex.
    expect(row.range).toBe(200);
    expect(row.wildCardOnly).toBe(true);
    expect(row.hardRange).toBe(true);
  });

  it('becomes a Healing action that reaches 40 tiles and is spent on use', () => {
    const act = actionsFor('Healing Drone').find((a) => a.label.startsWith('Healing Drone'));
    expect(act).toBeDefined();
    expect(act!.effect).toBe('heal');
    // A SWADE heal is the Healing roll's own margin, not an amount of points.
    expect(act!.healsWounds).toBe(true);
    expect(act!.traitName).toBe('Healing');
    expect(act!.fixedTn).toBe(4);
    expect(act!.rangeFt).toBe(200);
    expect(act!.ranged).toBe(true);
    // Single-use: unlike a Medkit, it is not a tool you keep.
    expect(act!.consumesItem).toBe(true);
    expect(act!.wildCardOnly).toBe(true);
    expect(act!.hardRange).toBe(true);
  });

  it('leaves the reusable kits alone — they stay touch-range tools', () => {
    const kit = actionsFor('Medkit (Modern)').find((a) => a.label.startsWith('Medkit'));
    expect(kit).toBeDefined();
    expect(kit!.rangeFt).toBe(5);
    expect(kit!.consumesItem).toBe(false);
    // Only the drone restricts its patients; a kit treats whoever it reaches.
    expect(kit!.wildCardOnly).toBeUndefined();
    expect(kit!.hardRange).toBeUndefined();
  });
});

describe('Pepper Spray', () => {
  it('lands in attacks as a save-or-Stunned attack with its five shots', () => {
    const sheet = sheetWith('Pepper Spray');
    const row = (sheet.attacks as SheetData[]).at(-1)!;
    expect(row.save).toBe('vigor');
    expect(row.onSave).toBe('negate');
    expect(row.condition).toBe('stunned');
    // Shots 5, per the personal-defence table.
    expect(row.ammo).toBe(5);
    expect(row.maxAmmo).toBe(5);
    expect(row.range).toBe(10);
    expect(row.hardRange).toBe(true);
  });

  it('becomes an action that forces the Vigor roll rather than a to-hit', () => {
    const act = actionsFor('Pepper Spray').find((a) => a.label === 'Pepper Spray');
    expect(act).toBeDefined();
    // The whole attack IS the rider: no to-hit, no damage dice.
    expect(act!.attackExpr).toBeNull();
    expect(act!.saveId).toBe('vigor');
    expect(act!.onSave).toBe('negate');
    expect(act!.appliesCondition).toBe('stunned');
    expect(act!.rangeFt).toBe(10);
    expect(act!.hardRange).toBe(true);
  });

  it('is a spray can, not a rifle: no Medium/Long band past its listed reach', () => {
    // hardRange is what the client ring and the server gate both read to skip
    // the band ladder — without it, 10 ft would stretch to 40 ft at −4.
    const act = actionsFor('Pepper Spray').find((a) => a.label === 'Pepper Spray')!;
    expect(act.hardRange).toBe(true);
    // An ordinary firearm keeps its bands.
    const pistol = actionsFor('9mm Pistol').find((a) => a.label === '9mm Pistol')!;
    expect(pistol.hardRange).toBeUndefined();
  });
});
