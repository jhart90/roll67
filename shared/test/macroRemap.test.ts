import { describe, expect, it } from 'vitest';
import { remapMacro, reorderMap, reorderMapsFor } from '../src/systems/macroRemap.js';

const knife = { name: 'Knife', damage: '1d4!', range: 5 };
const rifle = { name: 'Hunting Rifle', damage: '2d8!', range: 120 };
const colt = { name: 'Colt', damage: '2d6!+1', range: 60 };

describe('spotting a reorder', () => {
  it('maps each row to where it moved', () => {
    const map = reorderMap([knife, rifle], [rifle, knife]);
    expect([...map]).toEqual([[0, 1], [1, 0]]);
  });

  it('says nothing when nothing moved', () => {
    expect(reorderMap([knife, rifle], [knife, rifle]).size).toBe(0);
  });

  // An add or a delete is a different edit with a different right answer, so
  // it is left alone rather than guessed at.
  it.each([
    ['a row was added', [knife], [knife, rifle]],
    ['a row was removed', [knife, rifle], [knife]],
    ['a row was edited', [knife, rifle], [knife, { ...rifle, damage: '2d10!' }]],
    ['the list is empty', [], []],
  ])('stays out of it when %s', (_why, before, after) => {
    expect(reorderMap(before, after).size).toBe(0);
  });

  // Two daggers must not both claim the same slot.
  it('keeps identical rows in their own order', () => {
    const map = reorderMap([knife, knife, rifle], [rifle, knife, knife]);
    expect([...map]).toEqual([[0, 1], [1, 2], [2, 0]]);
  });
});

describe('following the reorder with a pinned pill', () => {
  const swap = { attacks: new Map([[0, 1], [1, 0]]) };

  // The bug this exists for: the knife's pill fired the rifle.
  it('moves an action binding to the row’s new index', () => {
    expect(remapMacro({ actionId: 'attack:0' }, swap)).toEqual({ actionId: 'attack:1', rollableId: null });
    expect(remapMacro({ actionId: 'attack:1' }, swap)).toEqual({ actionId: 'attack:0', rollableId: null });
  });

  it('moves the attack and damage rolls with it', () => {
    expect(remapMacro({ rollableId: 'attack_1' }, swap)!.rollableId).toBe('attack_0');
    expect(remapMacro({ rollableId: 'damage_0' }, swap)!.rollableId).toBe('damage_1');
  });

  // Suppressive Fire is derived from the same row, so it has to travel too.
  it('moves Suppressive Fire with its weapon', () => {
    expect(remapMacro({ actionId: 'suppress:0' }, swap)!.actionId).toBe('suppress:1');
  });

  it('leaves bindings from other lists alone', () => {
    expect(remapMacro({ actionId: 'item:0' }, swap)).toBeNull();
    expect(remapMacro({ actionId: 'power:1' }, swap)).toBeNull();
  });

  it('leaves a plain command pill alone', () => {
    expect(remapMacro({ actionId: null, rollableId: null }, swap)).toBeNull();
  });

  it('reports no change rather than an identical rewrite', () => {
    expect(remapMacro({ actionId: 'attack:0' }, { attacks: new Map() })).toBeNull();
  });

  it('remaps each list against its own move', () => {
    const maps = { attacks: new Map([[0, 1], [1, 0]]), inventory: new Map([[0, 2], [1, 0], [2, 1]]) };
    expect(remapMacro({ actionId: 'item:0' }, maps)!.actionId).toBe('item:2');
    expect(remapMacro({ actionId: 'attack:1' }, maps)!.actionId).toBe('attack:0');
  });
});

describe('reading a patch', () => {
  it('picks up only the lists the patch actually reorders', () => {
    const before = { attacks: [knife, rifle], inventory: [colt] };
    const maps = reorderMapsFor(before, { attacks: [rifle, knife] });
    expect(Object.keys(maps)).toEqual(['attacks']);
    expect([...maps.attacks!]).toEqual([[0, 1], [1, 0]]);
  });

  it('ignores a patch that changes something else entirely', () => {
    expect(reorderMapsFor({ attacks: [knife, rifle] }, { wounds: 2 })).toEqual({});
  });

  it('ignores a list the sheet did not have', () => {
    expect(reorderMapsFor({}, { attacks: [rifle, knife] })).toEqual({});
  });
});
