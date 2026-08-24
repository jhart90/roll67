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
  /** How many arrive at once. A pile lifted whole is ONE row carrying the
   *  count, not one row per unit — fifteen sheets of papyrus are a stack, and
   *  a sheet listed fifteen times is just a sheet listed fifteen times. */
  qty?: number;
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
  const count = Math.max(1, Math.floor(Number(item.qty) || 1));
  const base = applied?.row ?? {
    name: item.name,
    ...(system === 'swn' ? { qty: 1, enc: 1 } : { qty: 1, weight: 0 }),
    ...(item.effect ? { effect: item.effect, amount: item.amount ?? '', range: item.range ?? 5 } : {}),
    notes: item.notes || 'acquired',
  };
  // Multiplied rather than assigned, so an entry that describes a bundle (a
  // quiver of 20) still means twenty when five of them arrive. At count 1 —
  // every purchase, and every single item — this changes nothing.
  const row = typeof (base as SheetData).qty === 'number' && count > 1
    ? { ...(base as SheetData), qty: (Number((base as SheetData).qty) || 1) * count }
    : base;
  const list = Array.isArray(sheet[listId]) ? [...(sheet[listId] as SheetData[])] : [];

  // Already carrying some? Add to that stack instead of starting a second one.
  //
  // Confined to inventory, and to rows that already count themselves: an
  // attack row is a weapon in your hands rather than a pile in your pack, and
  // two swords are two attacks, not one attack with a 2 next to it. A row with
  // no qty is not a stack and is left alone for the same reason.
  if (listId === 'inventory') {
    const key = String(item.name ?? '').trim().toLowerCase();
    const at = key ? list.findIndex((r) => typeof r?.qty === 'number'
      && String(r?.name ?? '').trim().toLowerCase() === key) : -1;
    if (at >= 0) {
      const have = Number(list[at].qty) || 0;
      const gained = Number((row as SheetData).qty) || count;
      list[at] = { ...list[at], qty: have + gained };
      return { [listId]: list };
    }
  }
  list.push(row as SheetData);
  return { [listId]: list };
}
