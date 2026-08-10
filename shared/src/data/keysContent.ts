import type { GameSystem } from '../types.js';
import type { ContentEntry } from './compendiumTypes.js';
import { contentSlug } from './compendiumTypes.js';

const SYSTEMS: GameSystem[] = ['dnd5e', 'swn', 'swade'];

/**
 * The one key every campaign starts with: a plain key that opens any lock
 * naming it. Locks have always accepted a matching item name, so this is the
 * compendium entry for the behaviour that already existed — it just could not
 * be stocked into a chest or a shop before, only typed onto a sheet by hand.
 *
 * Every system gets one, since a locked door is not a genre feature.
 */
export const KEY_CONTENT: ContentEntry[] = SYSTEMS.map((system) => ({
  id: contentSlug(system, 'key', 'Basic Key'),
  system,
  kind: 'key',
  name: 'Basic Key',
  category: 'Keys',
  order: 0,
  subtitle: 'Opens any lock that names it',
  detail: 'A plain key. It turns any lock set to look for a key by this name — '
    + 'the DM cuts more specific keys (one door, one chest, every chest on a map, '
    + 'a master key) from the Key Manager, and those appear here too.',
  key: { scope: 'generic' },
}));
