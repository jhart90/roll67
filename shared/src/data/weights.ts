// Item weights, in pounds, so SWADE encumbrance has something to add up.
//
// Named entries carry the tabletop figure. Anything not named falls back to a
// per-kind default so NOTHING is weightless — an unweighted item silently
// makes a character lighter than they should be, which is worse than a rough
// number. `GUESSED_WEIGHTS` lists the fallbacks actually in use so they can be
// reviewed rather than quietly trusted.

/** Exact weights, keyed by the item's compendium name. */
export const ITEM_WEIGHT_LB: Record<string, number> = {
  // ---- melee ----
  Unarmed: 0, 'Brass Knuckles': 1, Dagger: 1, 'Throwing Knife': 1, 'Survival Knife': 1,
  Club: 3, Staff: 8, 'Short Sword': 4, Rapier: 3, 'Rapier (Main Gauche)': 4, Scimitar: 4,
  'Long Sword': 8, Katana: 6, 'Great Sword': 12, Maul: 20, 'Battle Axe': 10, 'Hand Axe': 2,
  Warhammer: 8, 'War Pick': 8, Flail: 8, Halberd: 15, Pike: 25, Spear: 5, Trident: 5,
  Lance: 10, Bayonet: 1, Chainsaw: 20, 'Stun Baton': 3, 'Vibro-Blade': 3, 'Molecular Sword': 5,
  'Improvised Weapon (Light)': 2, 'Improvised Weapon (Medium)': 5, 'Improvised Weapon (Heavy)': 12,
  // ---- bows & primitive ----
  Sling: 1, 'Sling Stones (20)': 2, Blowgun: 1, Bow: 3, Longbow: 3, Crossbow: 10,
  'Heavy Crossbow': 12, 'Arrows (20)': 2, 'Crossbow Bolts (20)': 3,
  // ---- firearms ----
  Derringer: 1, 'Flintlock Pistol': 3, '9mm Pistol': 4, 'Revolver (.357)': 4, '.44 Magnum': 4,
  'Machine Pistol': 5, 'Submachine Gun': 8, 'Pump Shotgun': 8, 'Double-Barrel Shotgun': 11,
  'Combat Shotgun': 10, 'Hunting Rifle': 8, 'Bolt-Action Rifle': 9, 'Assault Rifle': 8,
  'Sniper Rifle': 12, Musket: 15, Blunderbuss: 12, 'Light Machine Gun': 20, 'Heavy Machine Gun': 84,
  'Rocket Launcher': 15, 'Grenade Launcher': 12, Flamethrower: 60,
  // ---- energy ----
  'Laser Pistol': 4, 'Laser Rifle': 8, 'Plasma Rifle': 10, 'Gauss Rifle': 12,
  // ---- thrown explosives ----
  'Frag Grenade': 1, 'Smoke Grenade': 1, 'Stun Grenade': 1, 'Molotov Cocktail': 2,
  'Thunderclap Powder Bomb': 2, 'Micro-Frag Sphere': 1,
  // ---- ammunition ----
  'Bullets, Small (50)': 1, 'Bullets, Medium (50)': 2, 'Bullets, Large (50)': 3,
  'Shotgun Shells (25)': 2, 'Shotgun Slugs (25)': 2, 'Shot & Powder (10)': 2,
  'Laser Battery (Pistol)': 1, 'Laser Battery (Rifle/SMG)': 2, 'Laser Battery (Gatling)': 5,
  // ---- armour & shields ----
  'Cloth Robes': 4, 'Leather Jacket': 5, 'Leather Armor': 15, 'Hide Armor': 20,
  'Scale Armor': 25, Brigandine: 30, 'Chain Mail': 25, 'Half Plate': 40, 'Full Plate': 60,
  'Plate Corselet': 30, 'Helmet (Leather)': 3, 'Helmet (Steel)': 4,
  'Kevlar Vest': 8, 'Kevlar Vest w/ Inserts': 12, 'Flak Jacket': 10, 'Riot Gear': 20,
  'Body Armor (Military)': 25, 'Infantry Battle Suit': 30, 'Powered Battle Armor': 100,
  'Energy Shield': 5, 'Small Shield': 8, 'Medium Shield': 12, 'Large Shield': 20,
  // ---- adventuring gear ----
  Backpack: 2, Bedroll: 4, 'Rope (10 yards)': 10, 'Grappling Hook': 2, Torch: 1,
  Flashlight: 1, Lantern: 3, 'Flint & Steel': 0, Canteen: 3, 'Rations (5 days)': 5,
  'Survival Rations': 1, Waterskin: 4, Tent: 20, 'First Aid Kit': 2, Bandages: 1,
  'Surgical Kit': 5, 'Medkit (Modern)': 10, 'Healing Potion': 1, Antitoxin: 1,
  Lockpicks: 1, Crowbar: 5, Binoculars: 2, Spyglass: 1, Compass: 0, 'Gas Mask': 3,
  'Cell Phone': 0, Radio: 2, 'Comm Unit': 1, 'Climbing Gear': 10, Whetstone: 1,
  'Camouflage Cloak': 4, 'Disguise Kit': 3, 'Forgery Kit': 5, 'Research Library': 40,
  Toolkit: 10, 'Electronics Kit': 5, 'Musical Instrument': 5, 'Riding Tack': 25,
  'Chalk & Charcoal': 0, Manacles: 2, Caltrops: 2, 'Oil Flask': 1, 'Holy Symbol': 1,
  'Spell Components': 1, 'Signal Whistle': 0, 'Night Vision Goggles': 3,
  'Motion Detector': 2, 'Vacc Suit': 25, Jetpack: 40,
};

/** Used when an item isn't named above — deliberately rough, never zero. */
export const FALLBACK_WEIGHT_LB: Record<string, number> = {
  weapon: 4, armor: 15, gear: 2, magicitem: 2,
};

/** Names that fell through to a fallback, for review. Populated by weightFor. */
export const GUESSED_WEIGHTS = new Set<string>();

/** The weight to stamp on an item's sheet row. */
export function weightFor(name: string, kind: string, explicit?: number): number {
  // >= 0, not > 0: the gear tables list a whole column of pocket items at "—",
  // and a stated zero is an answer, not a missing value to guess over.
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0) return explicit;
  const known = ITEM_WEIGHT_LB[name];
  if (known !== undefined) return known;
  GUESSED_WEIGHTS.add(`${kind}:${name}`);
  return FALLBACK_WEIGHT_LB[kind] ?? 1;
}
