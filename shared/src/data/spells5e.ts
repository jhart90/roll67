// D&D 5e SRD spells — a broad selection across every level and school, with
// the mechanically useful fields (level, school, range, damage, save).
import { contentSlug, type ContentEntry } from './compendiumTypes.js';

// [name, level, school, castTime, range, components, duration, concentration,
//  damage, save, damageType, aoe ("shape:sizeFt" or "shape:sizeFt:widthFt"), heal]
//
// `aoe` is only set for spells whose area cleanly maps to one template shape
// (sphere/cylinder/cone/line/cube); spells with irregular or multi-burst
// areas (Chain Lightning's jumps, Fire Storm's joined cubes, Meteor Swarm's
// separate impacts, Wall of Fire's chosen wall/ring) are left untemplated —
// they still work as single-target actions, same as before this existed.
type S = [
  string, number, string, string, string, string, string, boolean,
  string?, string?, string?, string?, boolean?,
];

const SPELLS: S[] = [
  // Cantrips (0)
  ['Acid Splash', 0, 'Conjuration', '1 action', '60 ft', 'V,S', 'Instant', false, '1d6', 'DEX negates', 'acid'],
  ['Chill Touch', 0, 'Necromancy', '1 action', '120 ft', 'V,S', '1 round', false, '1d8', undefined, 'necrotic'],
  ['Dancing Lights', 0, 'Evocation', '1 action', '120 ft', 'V,S,M', '1 min', true],
  ['Druidcraft', 0, 'Transmutation', '1 action', '30 ft', 'V,S', 'Instant', false],
  ['Eldritch Blast', 0, 'Evocation', '1 action', '120 ft', 'V,S', 'Instant', false, '1d10', undefined, 'force'],
  ['Fire Bolt', 0, 'Evocation', '1 action', '120 ft', 'V,S', 'Instant', false, '1d10', undefined, 'fire'],
  ['Guidance', 0, 'Divination', '1 action', 'Touch', 'V,S', '1 min', true],
  ['Light', 0, 'Evocation', '1 action', 'Touch', 'V,M', '1 hr', false, undefined, 'DEX negates'],
  ['Mage Hand', 0, 'Conjuration', '1 action', '30 ft', 'V,S', '1 min', false],
  ['Mending', 0, 'Transmutation', '1 min', 'Touch', 'V,S,M', 'Instant', false],
  ['Message', 0, 'Transmutation', '1 action', '120 ft', 'V,S,M', '1 round', false],
  ['Minor Illusion', 0, 'Illusion', '1 action', '30 ft', 'S,M', '1 min', false],
  ['Poison Spray', 0, 'Conjuration', '1 action', '10 ft', 'V,S', 'Instant', false, '1d12', 'CON negates', 'poison'],
  ['Prestidigitation', 0, 'Transmutation', '1 action', '10 ft', 'V,S', 'up to 1 hr', false],
  ['Produce Flame', 0, 'Conjuration', '1 action', 'Self', 'V,S', '10 min', false, '1d8', undefined, 'fire'],
  ['Ray of Frost', 0, 'Evocation', '1 action', '60 ft', 'V,S', 'Instant', false, '1d8', undefined, 'cold'],
  ['Sacred Flame', 0, 'Evocation', '1 action', '60 ft', 'V,S', 'Instant', false, '1d8', 'DEX negates', 'radiant'],
  ['Shocking Grasp', 0, 'Evocation', '1 action', 'Touch', 'V,S', 'Instant', false, '1d8', undefined, 'lightning'],
  ['Spare the Dying', 0, 'Necromancy', '1 action', 'Touch', 'V,S', 'Instant', false],
  ['Thaumaturgy', 0, 'Transmutation', '1 action', '30 ft', 'V', 'up to 1 min', false],
  ['Vicious Mockery', 0, 'Enchantment', '1 action', '60 ft', 'V', 'Instant', false, '1d4', 'WIS negates', 'psychic'],
  // Level 1
  ['Burning Hands', 1, 'Evocation', '1 action', 'Self (15-ft cone)', 'V,S', 'Instant', false, '3d6', 'DEX half', 'fire', 'cone:15'],
  ['Charm Person', 1, 'Enchantment', '1 action', '30 ft', 'V,S', '1 hr', false, undefined, 'WIS negates'],
  ['Cure Wounds', 1, 'Evocation', '1 action', 'Touch', 'V,S', 'Instant', false, '1d8', undefined, undefined, undefined, true],
  ['Detect Magic', 1, 'Divination', '1 action', 'Self', 'V,S', '10 min', true],
  ['Disguise Self', 1, 'Illusion', '1 action', 'Self', 'V,S', '1 hr', false],
  ['Faerie Fire', 1, 'Evocation', '1 action', '60 ft', 'V', '1 min', true, undefined, 'DEX negates'],
  ['Feather Fall', 1, 'Transmutation', '1 reaction', '60 ft', 'V,M', '1 min', false],
  ['Guiding Bolt', 1, 'Evocation', '1 action', '120 ft', 'V,S', '1 round', false, '4d6', undefined, 'radiant'],
  ['Healing Word', 1, 'Evocation', '1 bonus', '60 ft', 'V', 'Instant', false, '1d4', undefined, undefined, undefined, true],
  ['Hunters Mark', 1, 'Divination', '1 bonus', '90 ft', 'V', '1 hr', true, '1d6'],
  ['Mage Armor', 1, 'Abjuration', '1 action', 'Touch', 'V,S,M', '8 hr', false],
  ['Magic Missile', 1, 'Evocation', '1 action', '120 ft', 'V,S', 'Instant', false, '3d4+3', undefined, 'force'],
  ['Shield', 1, 'Abjuration', '1 reaction', 'Self', 'V,S', '1 round', false],
  ['Sleep', 1, 'Enchantment', '1 action', '90 ft', 'V,S,M', '1 min', false, '5d8'],
  ['Thunderwave', 1, 'Evocation', '1 action', 'Self (15-ft cube)', 'V,S', 'Instant', false, '2d8', 'CON half', 'thunder', 'cube:15'],
  ['Bless', 1, 'Enchantment', '1 action', '30 ft', 'V,S,M', '1 min', true],
  ['Command', 1, 'Enchantment', '1 action', '60 ft', 'V', '1 round', false, undefined, 'WIS negates'],
  // Level 2
  ['Aid', 2, 'Abjuration', '1 action', '30 ft', 'V,S,M', '8 hr', false],
  ['Blur', 2, 'Illusion', '1 action', 'Self', 'V', '1 min', true],
  ['Darkness', 2, 'Evocation', '1 action', '60 ft', 'V,M', '10 min', true],
  ['Flaming Sphere', 2, 'Conjuration', '1 action', '60 ft', 'V,S,M', '1 min', true, '2d6', 'DEX half', 'fire'],
  ['Hold Person', 2, 'Enchantment', '1 action', '60 ft', 'V,S,M', '1 min', true, undefined, 'WIS negates'],
  ['Invisibility', 2, 'Illusion', '1 action', 'Touch', 'V,S,M', '1 hr', true],
  ['Lesser Restoration', 2, 'Abjuration', '1 action', 'Touch', 'V,S', 'Instant', false],
  ['Melfs Acid Arrow', 2, 'Evocation', '1 action', '90 ft', 'V,S,M', 'Instant', false, '4d4', 'attack', 'acid'],
  ['Mirror Image', 2, 'Illusion', '1 action', 'Self', 'V,S', '1 min', false],
  ['Misty Step', 2, 'Conjuration', '1 bonus', 'Self', 'V', 'Instant', false],
  ['Scorching Ray', 2, 'Evocation', '1 action', '120 ft', 'V,S', 'Instant', false, '2d6', 'attack', 'fire'],
  ['Spiritual Weapon', 2, 'Evocation', '1 bonus', '60 ft', 'V,S', '1 min', false, '1d8', undefined, 'force'],
  ['Web', 2, 'Conjuration', '1 action', '60 ft', 'V,S,M', '1 hr', true, undefined, 'DEX negates'],
  // Level 3
  ['Counterspell', 3, 'Abjuration', '1 reaction', '60 ft', 'S', 'Instant', false],
  ['Dispel Magic', 3, 'Abjuration', '1 action', '120 ft', 'V,S', 'Instant', false],
  ['Fireball', 3, 'Evocation', '1 action', '150 ft', 'V,S,M', 'Instant', false, '8d6', 'DEX half', 'fire', 'sphere:20'],
  ['Fly', 3, 'Transmutation', '1 action', 'Touch', 'V,S,M', '10 min', true],
  ['Haste', 3, 'Transmutation', '1 action', '30 ft', 'V,S,M', '1 min', true],
  ['Lightning Bolt', 3, 'Evocation', '1 action', 'Self (100-ft line)', 'V,S,M', 'Instant', false, '8d6', 'DEX half', 'lightning', 'line:100:5'],
  ['Mass Healing Word', 3, 'Evocation', '1 bonus', '60 ft', 'V', 'Instant', false, '1d4', undefined, undefined, undefined, true],
  ['Revivify', 3, 'Necromancy', '1 action', 'Touch', 'V,S,M', 'Instant', false],
  ['Sleet Storm', 3, 'Conjuration', '1 action', '150 ft', 'V,S,M', '1 min', true],
  ['Spirit Guardians', 3, 'Conjuration', '1 action', 'Self (15-ft radius)', 'V,S,M', '10 min', true, '3d8', 'WIS half', 'radiant', 'sphere:15'],
  ['Vampiric Touch', 3, 'Necromancy', '1 action', 'Self', 'V,S', '1 min', true, '3d6', undefined, 'necrotic'],
  ['Water Breathing', 3, 'Transmutation', '1 action', '30 ft', 'V,S,M', '24 hr', false],
  // Level 4
  ['Banishment', 4, 'Abjuration', '1 action', '60 ft', 'V,S,M', '1 min', true, undefined, 'CHA negates'],
  ['Blight', 4, 'Necromancy', '1 action', '30 ft', 'V,S', 'Instant', false, '8d8', 'CON half', 'necrotic'],
  ['Dimension Door', 4, 'Conjuration', '1 action', '500 ft', 'V', 'Instant', false],
  ['Greater Invisibility', 4, 'Illusion', '1 action', 'Touch', 'V,S', '1 min', true],
  ['Ice Storm', 4, 'Evocation', '1 action', '300 ft', 'V,S,M', 'Instant', false, '4d6', 'DEX half', 'cold', 'cylinder:20'],
  ['Polymorph', 4, 'Transmutation', '1 action', '60 ft', 'V,S,M', '1 hr', true, undefined, 'WIS negates'],
  ['Stoneskin', 4, 'Abjuration', '1 action', 'Touch', 'V,S,M', '1 hr', true],
  ['Wall of Fire', 4, 'Evocation', '1 action', '120 ft', 'V,S,M', '1 min', true, '5d8', 'DEX half', 'fire'],
  // Level 5
  ['Cone of Cold', 5, 'Evocation', '1 action', 'Self (60-ft cone)', 'V,S,M', 'Instant', false, '8d8', 'CON half', 'cold', 'cone:60'],
  ['Flame Strike', 5, 'Evocation', '1 action', '60 ft', 'V,S,M', 'Instant', false, '8d6', 'DEX half', 'fire', 'cylinder:10'],
  ['Greater Restoration', 5, 'Abjuration', '1 action', 'Touch', 'V,S,M', 'Instant', false],
  ['Hold Monster', 5, 'Enchantment', '1 action', '90 ft', 'V,S,M', '1 min', true, undefined, 'WIS negates'],
  ['Mass Cure Wounds', 5, 'Evocation', '1 action', '60 ft', 'V,S', 'Instant', false, '3d8', undefined, undefined, undefined, true],
  ['Raise Dead', 5, 'Necromancy', '1 hr', 'Touch', 'V,S,M', 'Instant', false],
  ['Scrying', 5, 'Divination', '10 min', 'Self', 'V,S,M', '10 min', true],
  ['Wall of Force', 5, 'Evocation', '1 action', '120 ft', 'V,S,M', '10 min', true],
  // Level 6
  ['Chain Lightning', 6, 'Evocation', '1 action', '150 ft', 'V,S,M', 'Instant', false, '10d8', 'DEX half', 'lightning'],
  ['Disintegrate', 6, 'Transmutation', '1 action', '60 ft', 'V,S,M', 'Instant', false, '10d6+40', 'DEX negates', 'force'],
  ['Heal', 6, 'Evocation', '1 action', '60 ft', 'V,S', 'Instant', false, '70', undefined, undefined, undefined, true],
  ['Sunbeam', 6, 'Evocation', '1 action', 'Self (60-ft line)', 'V,S,M', '1 min', true, '6d8', 'CON half', 'radiant', 'line:60:5'],
  ['True Seeing', 6, 'Divination', '1 action', 'Touch', 'V,S,M', '1 hr', false],
  // Level 7
  ['Finger of Death', 7, 'Necromancy', '1 action', '60 ft', 'V,S', 'Instant', false, '7d8+30', 'CON half', 'necrotic'],
  ['Fire Storm', 7, 'Evocation', '1 action', '150 ft', 'V,S', 'Instant', false, '7d10', 'DEX half', 'fire'],
  ['Plane Shift', 7, 'Conjuration', '1 action', 'Touch', 'V,S,M', 'Instant', false],
  ['Teleport', 7, 'Conjuration', '1 action', '10 ft', 'V', 'Instant', false],
  // Level 8
  ['Dominate Monster', 8, 'Enchantment', '1 action', '60 ft', 'V,S', '1 hr', true, undefined, 'WIS negates'],
  ['Power Word Stun', 8, 'Enchantment', '1 action', '60 ft', 'V', 'Instant', false],
  ['Sunburst', 8, 'Evocation', '1 action', '150 ft', 'V,S,M', 'Instant', false, '12d6', 'CON half', 'radiant', 'sphere:60'],
  // Level 9
  ['Meteor Swarm', 9, 'Evocation', '1 action', '1 mile', 'V,S', 'Instant', false, '40d6', 'DEX half', 'fire'],
  ['Power Word Kill', 9, 'Enchantment', '1 action', '60 ft', 'V', 'Instant', false],
  ['Time Stop', 9, 'Transmutation', '1 action', 'Self', 'V', 'Instant', false],
  ['Wish', 9, 'Conjuration', '1 action', 'Self', 'V', 'Instant', false],
];

function parseAoe(tag: string | undefined): { shape: 'sphere' | 'cone' | 'line' | 'cube' | 'cylinder'; sizeFt: number; widthFt?: number } | undefined {
  if (!tag) return undefined;
  const [shape, size, width] = tag.split(':');
  return {
    shape: shape as 'sphere' | 'cone' | 'line' | 'cube' | 'cylinder',
    sizeFt: Number(size),
    ...(width ? { widthFt: Number(width) } : {}),
  };
}

export const SPELLS_5E: ContentEntry[] = SPELLS.map(
  ([name, level, school, castTime, range, components, duration, concentration, damage, save, damageType, aoe, heal]): ContentEntry => ({
    id: contentSlug('dnd5e', 'spell', name),
    system: 'dnd5e', kind: 'spell', name,
    category: level === 0 ? 'Cantrip' : `Level ${level}`,
    order: level,
    subtitle: `${school}${damage ? ' · ' + damage : ''}${save ? ' · ' + save : ''} · ${range}`,
    detail: `${castTime} · ${components} · ${duration}${concentration ? ' (concentration)' : ''}`,
    spell: { level, school, castTime, range, components, duration, concentration, damage, save, damageType, heal, aoe: parseAoe(aoe) },
  }),
);
