import { describe, expect, it } from 'vitest';
import { keyCount, keyFromRow, keyOpens, keysOnSheet, sheetOpens, type LockTarget } from '../src/systems/keys.js';

const door = (id = 'd1', mapId = 'm1', keyName: string | null = null): LockTarget =>
  ({ kind: 'door', id, mapId, keyName });
const chest = (id = 'c1', mapId = 'm1', keyName: string | null = null): LockTarget =>
  ({ kind: 'chest', id, mapId, keyName });

const key = (over: Record<string, unknown>) => keyFromRow({ name: 'Key', isKey: true, ...over });

describe('keys', () => {
  it('a specific key opens its own lock and nothing else', () => {
    const k = key({ name: 'Cell Key', keyScope: 'door', keyTargetId: 'd1' });
    expect(keyOpens(k, door('d1'))).toBe(true);
    expect(keyOpens(k, door('d2'))).toBe(false);
    // A door key is not a chest key, even with the same id.
    expect(keyOpens(k, chest('d1'))).toBe(false);
  });

  it('a map key opens every lock of its kind on that map, and no other map', () => {
    const k = key({ name: 'Watch Key', keyScope: 'allDoors', keyMapId: 'm1' });
    expect(keyOpens(k, door('d1', 'm1'))).toBe(true);
    expect(keyOpens(k, door('d9', 'm1'))).toBe(true);
    expect(keyOpens(k, door('d1', 'm2'))).toBe(false);
    expect(keyOpens(k, chest('c1', 'm1'))).toBe(false);
    const ck = key({ name: 'Vault Key', keyScope: 'allChests', keyMapId: 'm1' });
    expect(keyOpens(ck, chest('c1', 'm1'))).toBe(true);
    expect(keyOpens(ck, door('d1', 'm1'))).toBe(false);
  });

  it('a master key opens anything', () => {
    const k = key({ name: 'Master Key', keyScope: 'master' });
    expect(keyOpens(k, door('d1', 'm1'))).toBe(true);
    expect(keyOpens(k, chest('c9', 'm7'))).toBe(true);
  });

  it('a generic key opens locks that name it, matching loosely', () => {
    const k = key({ name: 'Brass Key', keyScope: 'generic' });
    expect(keyOpens(k, door('d1', 'm1', 'Brass Key'))).toBe(true);
    expect(keyOpens(k, door('d1', 'm1', '  brass key '))).toBe(true);
    expect(keyOpens(k, door('d1', 'm1', 'Iron Key'))).toBe(false);
    // A lock with no named key is not opened by a generic key.
    expect(keyOpens(k, door('d1', 'm1', null))).toBe(false);
  });

  it('keeps opening locks set up before keys existed, by plain item name', () => {
    // No isKey marker at all — just an inventory row called "Brass Key".
    const sheet = { inventory: [{ name: 'Brass Key', qty: 1 }] };
    expect(sheetOpens(sheet, door('d1', 'm1', 'Brass Key'))).toBe(true);
    expect(sheetOpens(sheet, door('d1', 'm1', 'Iron Key'))).toBe(false);
  });

  it('counts every key on the ring, including copies', () => {
    const sheet = {
      inventory: [
        { name: 'Cell Key', isKey: true, keyScope: 'door', keyTargetId: 'd1', qty: 2 },
        { name: 'Master Key', isKey: true, keyScope: 'master' },
        { name: 'Rope', qty: 1 },
      ],
    };
    expect(keysOnSheet(sheet)).toHaveLength(2);
    expect(keyCount(sheet)).toBe(3); // 2 + 1, the rope is not a key
    expect(keyCount({ inventory: [{ name: 'Rope' }] })).toBe(0);
  });

  it('opens a lock when ANY key on the ring fits', () => {
    const sheet = {
      inventory: [
        { name: 'Cell Key', isKey: true, keyScope: 'door', keyTargetId: 'd1' },
        { name: 'Vault Key', isKey: true, keyScope: 'allChests', keyMapId: 'm1' },
      ],
    };
    expect(sheetOpens(sheet, door('d1', 'm1'))).toBe(true);
    expect(sheetOpens(sheet, chest('c5', 'm1'))).toBe(true);
    expect(sheetOpens(sheet, door('d2', 'm1'))).toBe(false);
  });

  it('treats an unknown or missing scope as generic rather than a master key', () => {
    // A malformed row must never become a skeleton key by accident.
    const k = keyFromRow({ name: 'Odd Key', isKey: true, keyScope: 'nonsense' });
    expect(k.scope).toBe('generic');
    expect(keyOpens(k, door('d1', 'm1'))).toBe(false);
  });
});
