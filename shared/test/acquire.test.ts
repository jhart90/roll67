import { describe, expect, it } from 'vitest';
import { acquirePatch } from '../src/systems/acquire.js';
import { contentForSystem } from '../src/data/compendium.js';
import type { SheetData } from '../src/types.js';

const rows = (patch: SheetData, list: string) => (patch[list] ?? []) as SheetData[];

describe('acquirePatch', () => {
  it('drops a plain item into inventory with the system\'s own columns', () => {
    const p5e = acquirePatch({}, 'dnd5e', { name: 'Rope' });
    expect(rows(p5e, 'inventory')).toHaveLength(1);
    expect(rows(p5e, 'inventory')[0]).toMatchObject({ name: 'Rope', qty: 1, weight: 0 });

    // SWN tracks encumbrance per item rather than weight.
    const pSwn = acquirePatch({}, 'swn', { name: 'Rope' });
    expect(rows(pSwn, 'inventory')[0]).toMatchObject({ name: 'Rope', qty: 1, enc: 1 });
  });

  it('keeps the note it was given, and falls back to a generic one', () => {
    expect(rows(acquirePatch({}, 'dnd5e', { name: 'Rope', notes: 'purchased' }), 'inventory')[0].notes).toBe('purchased');
    expect(rows(acquirePatch({}, 'dnd5e', { name: 'Rope' }), 'inventory')[0].notes).toBe('acquired');
  });

  it('carries a hand-built usable effect onto the row', () => {
    const patch = acquirePatch({}, 'dnd5e', { name: 'Odd Vial', effect: 'heal', amount: '2d4+2' });
    expect(rows(patch, 'inventory')[0]).toMatchObject({ effect: 'heal', amount: '2d4+2', range: 5 });
  });

  it('appends rather than replacing what the character already carries', () => {
    const sheet: SheetData = { inventory: [{ name: 'Torch', qty: 1 }] };
    const patch = acquirePatch(sheet, 'dnd5e', { name: 'Rope' });
    expect(rows(patch, 'inventory').map((r) => r.name)).toEqual(['Torch', 'Rope']);
    // The original sheet is untouched — the patch is a new list.
    expect((sheet.inventory as SheetData[])).toHaveLength(1);
  });

  it('applies a compendium weapon as a real attack, not an inventory label', () => {
    const sword = contentForSystem('swade').find((e) => e.kind === 'weapon' && e.name === 'Long Sword');
    expect(sword).toBeDefined();
    const patch = acquirePatch({ strength: 'd8' }, 'swade', { name: sword!.name, contentId: sword!.id });
    // It lands on the attacks list, which is the whole point of linking a
    // contentId: buying or looting a sword gives you something to swing.
    expect(patch.attacks).toBeDefined();
    expect(rows(patch, 'attacks')[0].name).toBe('Long Sword');
    expect(patch.inventory).toBeUndefined();
  });

  it('falls back to a plain row when the contentId matches nothing', () => {
    const patch = acquirePatch({}, 'dnd5e', { name: 'Ghost Item', contentId: 'no-such-entry' });
    expect(rows(patch, 'inventory')[0]).toMatchObject({ name: 'Ghost Item' });
  });

  it('is the same result whether the item was bought or looted', () => {
    const entry = contentForSystem('dnd5e').find((e) => e.kind === 'gear');
    expect(entry).toBeDefined();
    const bought = acquirePatch({}, 'dnd5e', { name: entry!.name, contentId: entry!.id, notes: 'purchased' });
    const looted = acquirePatch({}, 'dnd5e', { name: entry!.name, contentId: entry!.id, notes: 'found' });
    // Same list, same row shape — only the note differs.
    expect(Object.keys(bought)).toEqual(Object.keys(looted));
  });
});

describe('acquirePatch stacking', () => {
  it('takes a pile as ONE row carrying the count, not a row per unit', () => {
    const patch = acquirePatch({}, 'dnd5e', { name: 'Papyrus', qty: 15 });
    expect(rows(patch, 'inventory')).toHaveLength(1);
    expect(rows(patch, 'inventory')[0]).toMatchObject({ name: 'Papyrus', qty: 15 });
  });

  it('adds to a stack already in the pack rather than starting a second one', () => {
    const sheet: SheetData = { inventory: [{ name: 'Bullets, Medium', qty: 29, weight: 0 }] };
    const patch = acquirePatch(sheet, 'dnd5e', { name: 'Bullets, Medium', qty: 50 });
    expect(rows(patch, 'inventory')).toHaveLength(1);
    expect(rows(patch, 'inventory')[0].qty).toBe(79);
    // Still a patch, not a mutation of what it was handed.
    expect((sheet.inventory as SheetData[])[0].qty).toBe(29);
  });

  it('merges single items too, so picking one up twice is a stack of two', () => {
    const sheet: SheetData = { inventory: [{ name: 'Torch', qty: 1, weight: 0 }] };
    expect(rows(acquirePatch(sheet, 'dnd5e', { name: 'Torch' }), 'inventory')[0].qty).toBe(2);
  });

  it('does not care about case or stray spacing in the name', () => {
    const sheet: SheetData = { inventory: [{ name: 'Papyrus', qty: 3, weight: 0 }] };
    const patch = acquirePatch(sheet, 'dnd5e', { name: '  papyrus ', qty: 2 });
    expect(rows(patch, 'inventory')).toHaveLength(1);
    expect(rows(patch, 'inventory')[0]).toMatchObject({ name: 'Papyrus', qty: 5 });
  });

  it('keeps the fields the existing stack already had', () => {
    const sheet: SheetData = { inventory: [{ name: 'Arrow', qty: 10, weight: 0.05, notes: 'fletched myself' }] };
    expect(rows(acquirePatch(sheet, 'dnd5e', { name: 'Arrow', qty: 5 }), 'inventory')[0])
      .toMatchObject({ qty: 15, weight: 0.05, notes: 'fletched myself' });
  });

  it('never stacks weapons: two swords are two attacks, not one with a 2 on it', () => {
    const sword = contentForSystem('swade').find((e) => e.kind === 'weapon' && e.name === 'Long Sword');
    expect(sword).toBeDefined();
    const first = acquirePatch({ strength: 'd8' }, 'swade', { name: sword!.name, contentId: sword!.id });
    const second = acquirePatch({ strength: 'd8', ...first }, 'swade', { name: sword!.name, contentId: sword!.id });
    expect(rows(second, 'attacks')).toHaveLength(2);
  });

  it('leaves a row that does not count itself alone', () => {
    // No qty means it is not a stack — a named, one-off thing.
    const sheet: SheetData = { inventory: [{ name: 'Locket', notes: 'her mother\u2019s' }] };
    const patch = acquirePatch(sheet, 'dnd5e', { name: 'Locket' });
    expect(rows(patch, 'inventory')).toHaveLength(2);
  });

  it('changes nothing for a plain single purchase', () => {
    expect(rows(acquirePatch({}, 'dnd5e', { name: 'Rope', notes: 'purchased' }), 'inventory')[0])
      .toMatchObject({ name: 'Rope', qty: 1, weight: 0, notes: 'purchased' });
  });
});
