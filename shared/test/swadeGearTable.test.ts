import { describe, expect, it } from 'vitest';
import { applyEntry, contentForSystem, shopItemFromEntry } from '../src/data/compendium.js';
import { swade } from '../src/systems/swade.js';
import type { SheetData } from '../src/types.js';

/**
 * The core gear tables, entered as [compendium name, cost, weight]. Weight is
 * in pounds and 0 is the tables' "—" — a pocket item that never troubles
 * encumbrance. These are the numbers a shop charges and a sheet carries, so
 * they are pinned here rather than left to drift.
 */
const GEAR_TABLE: Array<[string, number, number]> = [
  // Animals & tack
  ['Horse', 300, 0],
  ['War Horse', 750, 0],
  ['Saddle', 10, 10],
  ['Elaborate Saddle', 50, 10],
  // Adventuring gear
  ['Backpack', 50, 2],
  ['Bedroll', 25, 4],
  ['Blanket', 10, 4],
  ['Camera (Disposable)', 10, 1],
  ['Camera (Regular)', 75, 2],
  ['Camera (Digital)', 300, 1],
  ['Candle', 1, 1],
  ['Canteen', 5, 1],
  ['Crowbar', 10, 2],
  ['First Aid Kit', 10, 1],
  ['Flashlight', 20, 3],
  ['Flask (Ceramic)', 5, 1],
  ['Flint & Steel', 3, 1],
  ['Goggles', 20, 1],
  ['Grappling Hook', 100, 2],
  ['Hammer', 10, 1],
  ['Manacles', 15, 1],
  ['Lantern', 25, 3],
  ['Lighter', 2, 0],
  ['Lockpicks', 200, 1],
  ['Medkit (Modern)', 100, 4],
  ['Oil Flask', 2, 1],
  ['Quiver', 25, 2],
  ['Rope (10 yards)', 10, 15],
  ['Rope, Nylon (20 yards)', 10, 3],
  ['Shovel', 5, 5],
  ['Soap', 1, 0.2],
  ['Toolkit', 200, 5],
  ['Torch', 5, 1],
  ['Umbrella', 5, 2],
  ['Signal Whistle', 2, 0],
  ['Whetstone', 1, 0],
  ['Rations (5 days)', 10, 5],
  // Clothing
  ['Boots, Hiking', 100, 2],
  ['Camouflage Fatigues', 20, 3],
  ['Clothing, Casual', 20, 2],
  ['Clothing, Formal', 200, 3],
  ['Winter Gear', 200, 3],
  ['Winter Boots', 100, 1],
  // Computers & electronics
  ['Desktop Computer', 800, 20],
  ['GPS', 250, 1],
  ['Hand Held Computer', 250, 1],
  ['Laptop', 1200, 5],
  // Firearms accessories
  ['Bipod/Tripod', 100, 2],
  ['Laser/Red Dot Sight', 150, 1],
  ['Rifle Scope', 100, 2],
  // Food
  ['Fast Food Meal', 8, 1],
  ['Good Meal', 15, 0],
  ['MRE (Meal Ready to Eat)', 10, 1],
  // Surveillance
  ['"Bug" (Micro Transmitter)', 30, 0],
  ['Button Camera', 50, 0],
  ['Cellular Interceptor', 650, 5],
  ["Lineman's Telephone", 150, 2],
  ['Night Vision Goggles', 500, 1],
  ['Parabolic Microphone', 750, 4],
  ['Telephone Tap', 250, 0],
  ['Transmitter Detector', 525, 1],
  // Ammunition — priced and weighed per batch, as the table does.
  ['Arrows (20)', 10, 4],
  ['Crossbow Bolts (20)', 10, 4],
  ['Bullets, Small (50)', 10, 1],
  ['Bullets, Medium (50)', 20, 2],
  ['Bullets, Large (50)', 30, 15],
  ['Laser Battery (Pistol)', 20, 0.25],
  ['Laser Battery (Rifle/SMG)', 20, 0.5],
  ['Laser Battery (Gatling)', 50, 4],
  ['Shot & Powder (10)', 1, 0.5],
  ['Shotgun Shells (25)', 15, 1.5],
  ['Shotgun Slugs (25)', 20, 1.5],
  ['Sling Stones (20)', 2, 1],
];

/** Personal defence rides the weapon table (they are attacks), not gear. */
const DEFENCE_TABLE: Array<[string, number, number]> = [
  ['Pepper Spray', 15, 0.5],
  ['Stun Gun', 25, 0.5],
];

const swadeEntries = contentForSystem('swade');
const byName = new Map(swadeEntries.map((e) => [e.name, e]));

describe('SWADE gear tables', () => {
  it.each(GEAR_TABLE)('%s is in the compendium at cost %i, weight %s', (name, cost, weight) => {
    const entry = byName.get(name);
    expect(entry, `no swade entry named ${name}`).toBeDefined();
    expect(entry!.gear?.cost).toBe(cost);
    expect(entry!.gear?.weight).toBe(weight);
  });

  it.each(DEFENCE_TABLE)('%s is a weapon costing %i and weighing %s', (name, cost, weight) => {
    const entry = byName.get(name);
    expect(entry, `no swade entry named ${name}`).toBeDefined();
    expect(entry!.kind).toBe('weapon');
    expect(entry!.gear?.cost).toBe(cost);
    expect(entry!.gear?.weight).toBe(weight);
  });

  it('prices a shop shelf from the item, not from a flat per-kind number', () => {
    // The whole point of carrying cost: a laptop and a bar of soap used to
    // stock at the same money.
    expect(shopItemFromEntry(byName.get('Laptop')!).price).toBe(1200);
    expect(shopItemFromEntry(byName.get('Soap')!).price).toBe(1);
    expect(shopItemFromEntry(byName.get('Horse')!).price).toBe(300);
  });

  it('carries the stated weight onto the sheet row, including a stated zero', () => {
    const rowFor = (name: string): SheetData => {
      const applied = applyEntry(byName.get(name)!, swade.defaultSheet());
      expect(applied, `${name} did not apply`).toBeTruthy();
      return applied!.row as SheetData;
    };
    expect(rowFor('Laptop').weight).toBe(5);
    expect(rowFor('Soap').weight).toBe(0.2);
    // "—" in the table: it must land as 0, not be guessed at by the fallback.
    expect(rowFor('Lighter').weight).toBe(0);
    expect(rowFor('Telephone Tap').weight).toBe(0);
  });

  it('gives the two personal-defence items their Stun rider and shots', () => {
    const spray = applyEntry(byName.get('Pepper Spray')!, swade.defaultSheet())!.row as SheetData;
    expect(spray.save).toBe('vigor');
    expect(spray.condition).toBe('stunned');
    expect(spray.ammo).toBe(5);
    expect(spray.range).toBe(10);
    // A spray can does not reach four times as far for a penalty.
    expect(spray.hardRange).toBe(true);

    const stun = applyEntry(byName.get('Stun Gun')!, swade.defaultSheet())!.row as SheetData;
    expect(stun.save).toBe('vigor');
    expect(stun.condition).toBe('stunned');
    expect(stun.ammo).toBe(3);
    // 1/2/4" bands — a real ranged shot, so no hard cap.
    expect(stun.range).toBe(6);
    expect(stun.hardRange).toBeUndefined();
  });

  it('gives every entry its own id, so none shadows another in contentById', () => {
    // Names may repeat across kinds — the power "Armor" and the racial ability
    // "Armor" are different things — and that is fine, because the slug is
    // system+kind+name. Two entries sharing an ID would not be.
    const seen = new Map<string, number>();
    for (const e of swadeEntries) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('keeps one entry per name WITHIN a kind, so a lookup by name is unambiguous', () => {
    const seen = new Map<string, number>();
    for (const e of swadeEntries) {
      const key = `${e.kind}:${e.name}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
  });
});
