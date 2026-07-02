// D&D 5e SRD equipment: weapons, armor, adventuring gear, and magic items.
import { contentSlug, type ContentEntry } from './compendiumTypes.js';

type Ab = 'str' | 'dex' | 'finesse' | 'ranged' | 'none';
// [name, category, damage, type, ability, props, weight]
type W = [string, string, string, string, Ab, string[], number];

const WEAPONS: W[] = [
  // Simple Melee
  ['Club', 'Simple Melee', '1d4', 'bludgeoning', 'str', ['light'], 2],
  ['Dagger', 'Simple Melee', '1d4', 'piercing', 'finesse', ['finesse', 'light', 'thrown (20/60)'], 1],
  ['Greatclub', 'Simple Melee', '1d8', 'bludgeoning', 'str', ['two-handed'], 10],
  ['Handaxe', 'Simple Melee', '1d6', 'slashing', 'str', ['light', 'thrown (20/60)'], 2],
  ['Javelin', 'Simple Melee', '1d6', 'piercing', 'str', ['thrown (30/120)'], 2],
  ['Light Hammer', 'Simple Melee', '1d4', 'bludgeoning', 'str', ['light', 'thrown (20/60)'], 2],
  ['Mace', 'Simple Melee', '1d6', 'bludgeoning', 'str', [], 4],
  ['Quarterstaff', 'Simple Melee', '1d6', 'bludgeoning', 'str', ['versatile (1d8)'], 4],
  ['Sickle', 'Simple Melee', '1d4', 'slashing', 'str', ['light'], 2],
  ['Spear', 'Simple Melee', '1d6', 'piercing', 'str', ['thrown (20/60)', 'versatile (1d8)'], 3],
  // Simple Ranged
  ['Light Crossbow', 'Simple Ranged', '1d8', 'piercing', 'ranged', ['ammunition (80/320)', 'loading', 'two-handed'], 5],
  ['Dart', 'Simple Ranged', '1d4', 'piercing', 'finesse', ['finesse', 'thrown (20/60)'], 0.25],
  ['Shortbow', 'Simple Ranged', '1d6', 'piercing', 'ranged', ['ammunition (80/320)', 'two-handed'], 2],
  ['Sling', 'Simple Ranged', '1d4', 'bludgeoning', 'ranged', ['ammunition (30/120)'], 0],
  // Martial Melee
  ['Battleaxe', 'Martial Melee', '1d8', 'slashing', 'str', ['versatile (1d10)'], 4],
  ['Flail', 'Martial Melee', '1d8', 'bludgeoning', 'str', [], 2],
  ['Glaive', 'Martial Melee', '1d10', 'slashing', 'str', ['heavy', 'reach', 'two-handed'], 6],
  ['Greataxe', 'Martial Melee', '1d12', 'slashing', 'str', ['heavy', 'two-handed'], 7],
  ['Greatsword', 'Martial Melee', '2d6', 'slashing', 'str', ['heavy', 'two-handed'], 6],
  ['Halberd', 'Martial Melee', '1d10', 'slashing', 'str', ['heavy', 'reach', 'two-handed'], 6],
  ['Lance', 'Martial Melee', '1d12', 'piercing', 'str', ['reach', 'special'], 6],
  ['Longsword', 'Martial Melee', '1d8', 'slashing', 'str', ['versatile (1d10)'], 3],
  ['Maul', 'Martial Melee', '2d6', 'bludgeoning', 'str', ['heavy', 'two-handed'], 10],
  ['Morningstar', 'Martial Melee', '1d8', 'piercing', 'str', [], 4],
  ['Pike', 'Martial Melee', '1d10', 'piercing', 'str', ['heavy', 'reach', 'two-handed'], 18],
  ['Rapier', 'Martial Melee', '1d8', 'piercing', 'finesse', ['finesse'], 2],
  ['Scimitar', 'Martial Melee', '1d6', 'slashing', 'finesse', ['finesse', 'light'], 3],
  ['Shortsword', 'Martial Melee', '1d6', 'piercing', 'finesse', ['finesse', 'light'], 2],
  ['Trident', 'Martial Melee', '1d6', 'piercing', 'str', ['thrown (20/60)', 'versatile (1d8)'], 4],
  ['War Pick', 'Martial Melee', '1d8', 'piercing', 'str', [], 2],
  ['Warhammer', 'Martial Melee', '1d8', 'bludgeoning', 'str', ['versatile (1d10)'], 2],
  ['Whip', 'Martial Melee', '1d4', 'slashing', 'finesse', ['finesse', 'reach'], 3],
  // Martial Ranged
  ['Blowgun', 'Martial Ranged', '1', 'piercing', 'ranged', ['ammunition (25/100)', 'loading'], 1],
  ['Hand Crossbow', 'Martial Ranged', '1d6', 'piercing', 'ranged', ['ammunition (30/120)', 'light', 'loading'], 3],
  ['Heavy Crossbow', 'Martial Ranged', '1d10', 'piercing', 'ranged', ['ammunition (100/400)', 'heavy', 'loading', 'two-handed'], 18],
  ['Longbow', 'Martial Ranged', '1d8', 'piercing', 'ranged', ['ammunition (150/600)', 'heavy', 'two-handed'], 2],
  ['Net', 'Martial Ranged', '0', 'special', 'none', ['thrown (5/15)', 'special'], 3],
];

// [name, category, baseAc, addDex, maxDex, notes, weight]
type A = [string, string, number, boolean, number | null, string, number];
const ARMOR: A[] = [
  ['Padded', 'Light Armor', 11, true, null, 'Stealth disadvantage', 8],
  ['Leather', 'Light Armor', 11, true, null, '', 10],
  ['Studded Leather', 'Light Armor', 12, true, null, '', 13],
  ['Hide', 'Medium Armor', 12, true, 2, '', 12],
  ['Chain Shirt', 'Medium Armor', 13, true, 2, '', 20],
  ['Scale Mail', 'Medium Armor', 14, true, 2, 'Stealth disadvantage', 45],
  ['Breastplate', 'Medium Armor', 14, true, 2, '', 20],
  ['Half Plate', 'Medium Armor', 15, true, 2, 'Stealth disadvantage', 40],
  ['Ring Mail', 'Heavy Armor', 14, false, null, 'Stealth disadvantage', 40],
  ['Chain Mail', 'Heavy Armor', 16, false, null, 'Str 13, Stealth disadvantage', 55],
  ['Splint', 'Heavy Armor', 17, false, null, 'Str 15, Stealth disadvantage', 60],
  ['Plate', 'Heavy Armor', 18, false, null, 'Str 15, Stealth disadvantage', 65],
  ['Shield', 'Shield', 2, false, null, '+2 AC', 6],
];

// [name, category, subtitle, weight]
type G = [string, string, string, number];
const GEAR: G[] = [
  ['Backpack', 'Adventuring Gear', 'Holds ~1 cubic foot / 30 lb', 5],
  ['Bedroll', 'Adventuring Gear', 'Sleep outdoors', 7],
  ['Bell', 'Adventuring Gear', '', 0],
  ['Blanket', 'Adventuring Gear', '', 3],
  ['Caltrops (bag of 20)', 'Adventuring Gear', '5-ft square, DC 15 or stop + 1 damage', 2],
  ['Candle', 'Adventuring Gear', 'Bright light 5 ft, 1 hr', 0],
  ['Chain (10 feet)', 'Adventuring Gear', 'DC 20 to break', 10],
  ['Crowbar', 'Adventuring Gear', 'Advantage on Str where leverage helps', 5],
  ['Grappling Hook', 'Adventuring Gear', '', 4],
  ['Hammer', 'Adventuring Gear', '', 3],
  ['Healers Kit', 'Adventuring Gear', '10 uses; stabilize a creature', 3],
  ['Holy Symbol', 'Adventuring Gear', 'Spellcasting focus (clerics/paladins)', 1],
  ['Hooded Lantern', 'Adventuring Gear', 'Bright 30 ft / dim 30 ft', 2],
  ['Hunting Trap', 'Adventuring Gear', '1d4 damage, DC 13 to escape', 25],
  ['Ink & Pen', 'Adventuring Gear', '', 0],
  ['Ladder (10 feet)', 'Adventuring Gear', '', 25],
  ['Lantern (Bullseye)', 'Adventuring Gear', 'Bright 60-ft cone', 2],
  ['Lock', 'Adventuring Gear', 'DC 15 with thieves tools', 1],
  ['Manacles', 'Adventuring Gear', 'DC 20 Str / DC 15 tools to escape', 6],
  ['Mess Kit', 'Adventuring Gear', '', 1],
  ['Oil (flask)', 'Adventuring Gear', 'Thrown: 5 fire damage', 1],
  ['Piton', 'Adventuring Gear', '', 0.25],
  ['Potion of Healing', 'Adventuring Gear', 'Regain 2d4+2 hit points', 0.5],
  ['Quiver', 'Adventuring Gear', 'Holds 20 arrows', 1],
  ['Rations (1 day)', 'Adventuring Gear', '', 2],
  ['Rope (50 feet, hemp)', 'Adventuring Gear', 'DC 17 to break', 10],
  ['Shovel', 'Adventuring Gear', '', 5],
  ['Spellbook', 'Adventuring Gear', 'Wizard spell storage', 3],
  ['Tent', 'Adventuring Gear', 'Sleeps two', 20],
  ['Thieves Tools', 'Adventuring Gear', 'Pick locks, disarm traps', 1],
  ['Tinderbox', 'Adventuring Gear', 'Light fire as an action', 1],
  ['Torch', 'Adventuring Gear', 'Bright 20 ft / dim 20 ft, 1 hr; 1 fire damage', 1],
  ['Waterskin', 'Adventuring Gear', 'Holds 4 pints', 5],
];

// [name, category, subtitle, detail]
type M = [string, string, string, string];
const MAGIC: M[] = [
  ['Potion of Greater Healing', 'Potion', 'Regain 4d4+4 hit points', 'Uncommon. Drink or administer as an action.'],
  ['Potion of Fire Breath', 'Potion', 'Exhale fire: 4d6 (DEX 13 half)', 'Uncommon. 3 uses within 1 hour.'],
  ['Potion of Flying', 'Potion', 'Fly speed 60 ft for 1 hour', 'Very rare.'],
  ['Potion of Invisibility', 'Potion', 'Invisible for 1 hour', 'Very rare; ends if you attack/cast.'],
  ['Potion of Giant Strength (Hill)', 'Potion', 'Strength becomes 21 for 1 hour', 'Uncommon.'],
  ['Bag of Holding', 'Wondrous item', 'Holds 500 lb in an extradimensional space', 'Uncommon.'],
  ['Cloak of Protection', 'Wondrous item', '+1 AC and saving throws', 'Uncommon (requires attunement).'],
  ['Ring of Protection', 'Ring', '+1 AC and saving throws', 'Rare (requires attunement).'],
  ['Amulet of Health', 'Wondrous item', 'Constitution becomes 19', 'Rare (requires attunement).'],
  ['Boots of Speed', 'Wondrous item', 'Double speed as a bonus action, 10 min/day', 'Rare (requires attunement).'],
  ['Boots of Elvenkind', 'Wondrous item', 'Advantage on Stealth (move quietly)', 'Uncommon.'],
  ['Gauntlets of Ogre Power', 'Wondrous item', 'Strength becomes 19', 'Uncommon (requires attunement).'],
  ['Bracers of Defense', 'Wondrous item', '+2 AC when unarmored & no shield', 'Rare (requires attunement).'],
  ['Cloak of Elvenkind', 'Wondrous item', 'Advantage on Stealth; disadvantage to be seen', 'Uncommon (requires attunement).'],
  ['Gloves of Missile Snaring', 'Wondrous item', 'Reduce ranged damage by 1d10+Dex', 'Uncommon (requires attunement).'],
  ['Ring of Free Action', 'Ring', 'Ignore difficult terrain; immune to paralyze/restrain speed', 'Rare (requires attunement).'],
  ['Ring of Feather Falling', 'Ring', 'No falling damage', 'Rare (requires attunement).'],
  ['Winged Boots', 'Wondrous item', 'Fly speed = walking speed, 4 hours', 'Uncommon (requires attunement).'],
  ['Belt of Dwarvenkind', 'Wondrous item', '+2 Con save, advantage vs poison, darkvision', 'Rare (requires attunement).'],
  ['Flame Tongue', 'Weapon', 'Longsword +2d6 fire when active', 'Rare (requires attunement).'],
  ['Frost Brand', 'Weapon', '+1d6 cold; fire resistance', 'Very rare (requires attunement).'],
  ['Sword of Sharpness', 'Weapon', 'Extra 4d6 on a max melee die; lop off limbs', 'Very rare (requires attunement).'],
  ['Dagger of Venom', 'Weapon', '+1 dagger; coat in poison (2d10, DC 15 Con)', 'Rare (requires attunement).'],
  ['Bag of Tricks (Gray)', 'Wondrous item', 'Pull out a random beast ally', 'Uncommon.'],
  ['Immovable Rod', 'Rod', 'Fixes in place, holds 8,000 lb', 'Uncommon.'],
  ['Wand of Magic Missiles', 'Wand', '7 charges; cast magic missile', 'Uncommon.'],
  ['Wand of Fireballs', 'Wand', '7 charges; cast fireball (8d6+)', 'Rare (requires attunement).'],
  ['Staff of Healing', 'Staff', '10 charges; cure wounds / lesser restoration', 'Rare (requires attunement).'],
  ['Driftglobe', 'Wondrous item', 'Floating light source; daylight 1/day', 'Uncommon.'],
  ['Goggles of Night', 'Wondrous item', 'Darkvision 60 ft', 'Uncommon.'],
  ['Eyes of the Eagle', 'Wondrous item', 'Advantage on sight Perception', 'Uncommon (requires attunement).'],
  ['Pearl of Power', 'Wondrous item', 'Recover one spell slot (≤3rd) per day', 'Uncommon (requires attunement).'],
  ['Sending Stones', 'Wondrous item', 'Cast sending to the paired stone', 'Uncommon.'],
  ['Rope of Climbing', 'Wondrous item', '60-ft rope moves on command', 'Uncommon.'],
  ['Cap of Water Breathing', 'Wondrous item', 'Breathe underwater', 'Uncommon.'],
];

export const ITEMS_5E: ContentEntry[] = [
  ...WEAPONS.map(([name, category, damage, damageType, ability, props, weight], i): ContentEntry => ({
    id: contentSlug('dnd5e', 'weapon', name),
    system: 'dnd5e', kind: 'weapon', name, category, order: i,
    subtitle: `${damage} ${damageType}${props.length ? ' · ' + props.join(', ') : ''}`,
    weapon: { damage, damageType, ability, props },
    gear: { weight },
  })),
  ...ARMOR.map(([name, category, baseAc, addDex, maxDex, notes, weight], i): ContentEntry => ({
    id: contentSlug('dnd5e', 'armor', name),
    system: 'dnd5e', kind: 'armor', name, category, order: i,
    subtitle: `AC ${baseAc}${addDex ? ' + Dex' + (maxDex ? ` (max ${maxDex})` : '') : ''}${notes ? ' · ' + notes : ''}`,
    armor: { baseAc, addDex, maxDex: maxDex ?? undefined, notes },
    gear: { weight },
  })),
  ...GEAR.map(([name, category, subtitle, weight], i): ContentEntry => ({
    id: contentSlug('dnd5e', 'gear', name),
    system: 'dnd5e', kind: 'gear', name, category, order: i,
    subtitle: subtitle || `${weight} lb`,
    gear: { weight },
  })),
  ...MAGIC.map(([name, category, subtitle, detail], i): ContentEntry => ({
    id: contentSlug('dnd5e', 'magicitem', name),
    system: 'dnd5e', kind: 'magicitem', name, category: `Magic: ${category}`, order: i,
    subtitle, detail,
    gear: { weight: 1 },
  })),
];
