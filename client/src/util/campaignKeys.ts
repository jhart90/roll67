import type { ContentEntry } from 'shared';
import { contentForSystem, keysOnSheet } from 'shared';
import { useGameStore } from '../store/game';

/**
 * Every key name that exists anywhere in this campaign.
 *
 * A key can be in four places, and a lock has to be able to name any of them:
 * cut into the compendium and not yet handed out, sitting in a chest waiting
 * to be found, already in somebody's pocket, or one of the built-in entries
 * every campaign starts with.
 *
 * The door editor used to look only at INVENTORIES, which meant the ordinary
 * way of working — cut a key, stock it in a chest, then lock the door it
 * opens — was the one order that could not be done: the key was real, listed
 * in the compendium and sitting in the chest, and the door's dropdown was
 * empty. Anything that asks "which keys exist?" should ask here.
 */
export function useCampaignKeyNames(): string[] {
  const customItems = useGameStore((s) => s.customItems);
  const characters = useGameStore((s) => s.characters);
  const mapObjects = useGameStore((s) => s.mapObjects);
  const system = useGameStore((s) => s.campaign?.system);

  const names = new Set<string>();

  // 1. The built-ins (Basic Key and friends).
  if (system) {
    for (const e of contentForSystem(system)) if (e.kind === 'key') names.add(e.name);
  }
  // 2. Cut keys, which live in the campaign's custom compendium entries.
  for (const ci of customItems) {
    try {
      const entry = JSON.parse(ci.entryJson) as ContentEntry;
      if (entry.kind === 'key' && entry.name) names.add(entry.name);
    } catch { /* a corrupt row is not a key */ }
  }
  // 3. Keys already in somebody's pocket.
  for (const c of characters) for (const k of keysOnSheet(c.sheet)) names.add(k.name);
  // 4. Keys stocked in a chest or lying on the floor. Matched by the same
  //    compendium ids the stocking wrote, with a name fallback for a row typed
  //    in by hand — a DM who writes "Brass Key" into a chest means the key.
  const keyIds = new Set<string>();
  for (const ci of customItems) {
    try {
      const entry = JSON.parse(ci.entryJson) as ContentEntry;
      if (entry.kind === 'key') keyIds.add(ci.id);
    } catch { /* skip */ }
  }
  if (system) for (const e of contentForSystem(system)) if (e.kind === 'key') keyIds.add(e.id);
  for (const obj of Object.values(mapObjects)) {
    for (const it of obj.items ?? []) {
      if (it.contentId && keyIds.has(it.contentId)) names.add(it.name);
      else if (/\bkey\b/i.test(it.name)) names.add(it.name);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}
