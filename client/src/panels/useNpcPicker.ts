import { useMemo, useState } from 'react';
import { npcCategories, npcsForSystem, type GameSystem } from 'shared';

export type NpcSortKey = 'category' | 'name' | 'challenge' | 'hp';

/** Search/category/sort state + the filtered compendium list, shared by the
 *  NPC library ("+ add") and randomize-from-model ("use as model") pickers. */
export function useNpcPicker(system: GameSystem) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<NpcSortKey>('category');
  const categories = useMemo(() => npcCategories(system), [system]);

  const entries = useMemo(() => {
    let list = npcsForSystem(system);
    if (category !== 'all') list = list.filter((n) => n.category === category);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((n) =>
        n.name.toLowerCase().includes(q) || n.category.toLowerCase().includes(q));
    }
    const sorted = [...list];
    switch (sort) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'challenge':
        sorted.sort((a, b) => a.challenge - b.challenge || a.name.localeCompare(b.name));
        break;
      case 'hp':
        sorted.sort((a, b) => a.hp - b.hp || a.name.localeCompare(b.name));
        break;
      default:
        // category order as authored (logical grouping), by challenge within
        sorted.sort((a, b) => {
          const ca = categories.indexOf(a.category);
          const cb = categories.indexOf(b.category);
          return ca - cb || a.challenge - b.challenge || a.name.localeCompare(b.name);
        });
    }
    return sorted;
  }, [system, category, search, sort, categories]);

  return { search, setSearch, category, setCategory, sort, setSort, categories, entries };
}
