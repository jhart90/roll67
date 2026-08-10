// Keys as a real kind of item, rather than "any inventory row whose name
// happens to match the lock".
//
// A key is an ordinary inventory row carrying `isKey` plus a scope saying
// WHAT it opens. Name-matching still works, so every door and chest already
// set up with a `keyName` keeps functioning — a key item is simply a more
// precise way to say the same thing, and the two live side by side.

import type { SheetData } from '../types.js';
import { rows, str } from './types.js';

export type KeyScope =
  /** Opens anything whose lock names this key (the classic behaviour). */
  | 'generic'
  /** Opens one specific door. */
  | 'door'
  /** Opens one specific chest. */
  | 'chest'
  /** Opens every door on one map. */
  | 'allDoors'
  /** Opens every chest on one map. */
  | 'allChests'
  /** A master key: every lock in the campaign. */
  | 'master';

export interface KeyItem {
  name: string;
  scope: KeyScope;
  /** The door or chest id, for the single-target scopes. */
  targetId?: string;
  /** The map, for the all-on-this-map scopes. */
  mapId?: string;
  /** How many of this key the holder has. */
  qty: number;
}

/** What a lock being opened looks like to a key. */
export interface LockTarget {
  kind: 'door' | 'chest';
  id: string;
  mapId: string;
  /** The lock's named key, when it has one ("Brass Key"). */
  keyName?: string | null;
}

/** Is this inventory row a key? */
export function isKeyRow(row: SheetData): boolean {
  return row.isKey === true;
}

/** Read a key out of an inventory row. */
export function keyFromRow(row: SheetData): KeyItem {
  const scope = str(row, 'keyScope', 'generic') as KeyScope;
  const qty = Number(row.qty);
  return {
    name: str(row, 'name', 'Key'),
    scope: (['generic', 'door', 'chest', 'allDoors', 'allChests', 'master'] as string[]).includes(scope)
      ? scope : 'generic',
    targetId: str(row, 'keyTargetId', '') || undefined,
    mapId: str(row, 'keyMapId', '') || undefined,
    qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
  };
}

/** Every key on a sheet. */
export function keysOnSheet(sheet: SheetData): KeyItem[] {
  return rows(sheet, 'inventory').filter(isKeyRow).map(keyFromRow);
}

/** How many keys the holder is carrying, counting copies. */
export function keyCount(sheet: SheetData): number {
  return keysOnSheet(sheet).reduce((n, k) => n + k.qty, 0);
}

/** Does this key open that lock? */
export function keyOpens(key: KeyItem, target: LockTarget): boolean {
  switch (key.scope) {
    case 'master':
      return true;
    case 'door':
      return target.kind === 'door' && !!key.targetId && key.targetId === target.id;
    case 'chest':
      return target.kind === 'chest' && !!key.targetId && key.targetId === target.id;
    case 'allDoors':
      return target.kind === 'door' && !!key.mapId && key.mapId === target.mapId;
    case 'allChests':
      return target.kind === 'chest' && !!key.mapId && key.mapId === target.mapId;
    case 'generic':
    default:
      // The classic rule: a lock naming "Brass Key" opens for an item called
      // "Brass Key". Comparison is case- and space-insensitive.
      return !!target.keyName
        && key.name.trim().toLowerCase() === target.keyName.trim().toLowerCase();
  }
}

/** Does anything on this sheet open that lock? */
export function sheetOpens(sheet: SheetData, target: LockTarget): boolean {
  // A plain (non-key) item whose NAME matches still works, so locks set up
  // before keys existed keep opening.
  const named = target.keyName?.trim().toLowerCase();
  if (named && rows(sheet, 'inventory').some((r) => str(r, 'name', '').trim().toLowerCase() === named)) return true;
  return keysOnSheet(sheet).some((k) => keyOpens(k, target));
}

/** A short human description of what a key opens, for the keyring UI. */
export function keyScopeLabel(key: KeyItem, mapName?: string, targetName?: string): string {
  switch (key.scope) {
    case 'master': return 'Opens everything';
    case 'door': return targetName ? `Opens the ${targetName}` : 'Opens one specific door';
    case 'chest': return targetName ? `Opens the ${targetName}` : 'Opens one specific chest';
    case 'allDoors': return mapName ? `Opens every door in ${mapName}` : 'Opens every door on its map';
    case 'allChests': return mapName ? `Opens every chest in ${mapName}` : 'Opens every chest on its map';
    case 'generic':
    default: return 'Opens locks that name it';
  }
}
