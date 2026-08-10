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
