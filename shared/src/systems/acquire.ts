import { applyEntry } from '../data/compendiumTypes.js';
import { contentById } from '../data/compendium.js';
import type { GameSystem, SheetData } from '../types.js';

/**
 * Acquiring an item — the one description of what it means for a thing to end
 * up in a character's hands, whether it was bought over a counter or lifted
 * out of a chest. Both routes MUST agree: the difference between buying and
 * looting is who pays, not what you end up holding. Before this existed,
 * taking from a chest deleted the row and posted a chat line without ever
 * touching the taker's sheet, so chest loot was purely decorative.
 */
export interface AcquiredItem {
  name: string;
  /** Compendium/custom entry id: the item arrives with its full logic. */
  contentId?: string;
  /** Free-text description, kept as the row's note. */
  notes?: string;
  /** Usable items defined by hand rather than by compendium entry. */
  effect?: 'heal' | 'damage';
  amount?: string;
  range?: number;
}

/**
 * The sheet changes that putting this item in someone's hands amounts to —
 * returned as a patch rather than applied, so a caller that also moves money
 * can commit both in a single write and never leave a character paid-up but
 * empty-handed.
 *
 * A compendium-backed item (contentId) applies its full entry — a weapon
 * becomes a real attack row, a potion a usable item — while a plain item
 * lands in inventory carrying whatever usable effect it was given.
 */
export function acquirePatch(sheet: SheetData, system: GameSystem, item: AcquiredItem): SheetData {
  const entry = item.contentId ? contentById(item.contentId) : undefined;
  const applied = entry ? applyEntry(entry, sheet) : null;
  const listId = applied?.listId ?? 'inventory';
  const row = applied?.row ?? {
    name: item.name,
    ...(system === 'swn' ? { qty: 1, enc: 1 } : { qty: 1, weight: 0 }),
    ...(item.effect ? { effect: item.effect, amount: item.amount ?? '', range: item.range ?? 5 } : {}),
    notes: item.notes || 'acquired',
  };
  const list = Array.isArray(sheet[listId]) ? [...(sheet[listId] as SheetData[])] : [];
  list.push(row as SheetData);
  return { [listId]: list };
}
