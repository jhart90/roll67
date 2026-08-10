import { describe, expect, it } from 'vitest';
import { applyEntry, contentForSystem, contentKinds, contentSlug } from '../src/data/compendium.js';
import type { ContentEntry } from '../src/data/compendiumTypes.js';
import { keyFromRow, keyOpens } from '../src/systems/keys.js';
import type { SheetData } from '../src/types.js';

const SYSTEMS = ['dnd5e', 'swn', 'swade'] as const;

describe('keys in the compendium', () => {
  it('gives every system a Basic Key', () => {
    for (const system of SYSTEMS) {
      const keys = contentForSystem(system).filter((c) => c.kind === 'key');
      expect(keys.map((k) => k.name)).toContain('Basic Key');
    }
  });

  it('shows a Keys section in every system', () => {
    for (const system of SYSTEMS) expect(contentKinds(system)).toContain('key');
  });

  // The whole point: a key added from the compendium has to be a WORKING key,
  // not an inventory row that happens to be called one.
  it('adds a key to inventory as a real key, not a named item', () => {
    const entry = contentForSystem('swade').find((c) => c.kind === 'key')!;
    const applied = applyEntry(entry, {});
    expect(applied?.listId).toBe('inventory');
    const row = applied!.row as SheetData;
    expect(row.isKey).toBe(true);
    const key = keyFromRow(row);
    expect(key.scope).toBe('generic');
    expect(keyOpens(key, { kind: 'chest', id: 'c1', mapId: 'm1', keyName: 'Basic Key' })).toBe(true);
    expect(keyOpens(key, { kind: 'chest', id: 'c1', mapId: 'm1', keyName: 'Vault Key' })).toBe(false);
  });

  it('carries a cut key’s scope and target through the compendium', () => {
    // What the Key Manager files when the DM cuts a chest-specific key.
    const cut: ContentEntry = {
      id: contentSlug('swade', 'key', 'Vault Key chest chest-7'),
      system: 'swade', kind: 'key', name: 'Vault Key', category: 'Keys', order: 1,
      subtitle: 'Opens one specific chest',
      key: { scope: 'chest', targetId: 'chest-7' },
    };
    const key = keyFromRow(applyEntry(cut, {})!.row as SheetData);
    expect(key.scope).toBe('chest');
    expect(keyOpens(key, { kind: 'chest', id: 'chest-7', mapId: 'm1' })).toBe(true);
    expect(keyOpens(key, { kind: 'chest', id: 'chest-8', mapId: 'm1' })).toBe(false);
  });

  // Two keys that open different things must not share an id, or filing the
  // second would silently overwrite the first.
  it('gives keys with different targets different ids', () => {
    const a = contentSlug('swade', 'key', 'Vault Key chest chest-7');
    const b = contentSlug('swade', 'key', 'Vault Key chest chest-8');
    expect(a).not.toBe(b);
  });
});
