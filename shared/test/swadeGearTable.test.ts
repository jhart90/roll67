import { describe, expect, it } from 'vitest';
import { applyEntry, contentForSystem, shopItemFromEntry } from '../src/data/compendium.js';
import { swade, swadeWeightCarried } from '../src/systems/swade.js';
import { combatActions } from '../src/systems/combat.js';
import type { Character, SheetData } from '../src/types.js';

/**
 * The core gear tables, entered as [compendium name, cost, weight]. Weight is
 * in pounds and 0 is the tables' "—" — a pocket item that never troubles
 * encumbrance. These are the numbers a shop charges and a sheet carries, so
 * they are pinned here rather than left to drift.
 */
const GEAR_TABLE: Array<[string, number, number]> = [
  // Animals & tack
  ['Horse', 300, 0],
  ['War Horse', 750, 0],
  ['Saddle', 10, 10],
  ['Elaborate Saddle', 50, 10],
  // Adventuring gear
  ['Backpack', 50, 2],
  ['Bedroll', 25, 4],
  ['Blanket', 10, 4],
  ['Camera (Disposable)', 10, 1],
  ['Camera (Regular)', 75, 2],
  ['Camera (Digital)', 300, 1],
  ['Candle', 1, 1],
  ['Canteen', 5, 1],
  ['Crowbar', 10, 2],
  ['First Aid Kit', 10, 1],
  ['Flashlight', 20, 3],
  ['Flask (Ceramic)', 5, 1],
  ['Flint & Steel', 3, 1],
  ['Goggles', 20, 1],
  ['Grappling Hook', 100, 2],
  ['Hammer', 10, 1],
  ['Manacles', 15, 1],
  ['Lantern', 25, 3],
  ['Lighter', 2, 0],
  ['Lockpicks', 200, 1],
  ['Medkit (Modern)', 100, 4],
  ['Oil Flask', 2, 1],
  ['Quiver', 25, 2],
  ['Rope (10 yards)', 10, 15],
  ['Rope, Nylon (20 yards)', 10, 3],
  ['Shovel', 5, 5],
  ['Soap', 1, 0.2],
  ['Toolkit', 200, 5],
  ['Torch', 5, 1],
  ['Umbrella', 5, 2],
  ['Signal Whistle', 2, 0],
  ['Whetstone', 1, 0],
  ['Rations (5 days)', 10, 5],
  // Clothing
  ['Boots, Hiking', 100, 2],
  ['Camouflage Fatigues', 20, 3],
  ['Clothing, Casual', 20, 2],
  ['Clothing, Formal', 200, 3],
  ['Winter Gear', 200, 3],
  ['Winter Boots', 100, 1],
  // Computers & electronics
  ['Desktop Computer', 800, 20],
  ['GPS', 250, 1],
  ['Hand Held Computer', 250, 1],
  ['Laptop', 1200, 5],
  // Firearms accessories
  ['Bipod/Tripod', 100, 2],
  ['Laser/Red Dot Sight', 150, 1],
  ['Rifle Scope', 100, 2],
  // Food
  ['Fast Food Meal', 8, 1],
  ['Good Meal', 15, 0],
  ['MRE (Meal Ready to Eat)', 10, 1],
  // Surveillance
  ['"Bug" (Micro Transmitter)', 30, 0],
  ['Button Camera', 50, 0],
  ['Cellular Interceptor', 650, 5],
  ["Lineman's Telephone", 150, 2],
  ['Night Vision Goggles', 500, 1],
  ['Parabolic Microphone', 750, 4],
  ['Telephone Tap', 250, 0],
  ['Transmitter Detector', 525, 1],
  // Ammunition — priced and weighed per batch, as the table does.
  ['Arrows (20)', 10, 4],
  ['Crossbow Bolts (20)', 10, 4],
  ['Bullets, Small (50)', 10, 1],
  ['Bullets, Medium (50)', 20, 2],
  ['Bullets, Large (50)', 30, 15],
  ['Laser Battery (Pistol)', 20, 0.25],
  ['Laser Battery (Rifle/SMG)', 20, 0.5],
  ['Laser Battery (Gatling)', 50, 4],
  ['Shot & Powder (10)', 1, 0.5],
  ['Shotgun Shells (25)', 15, 1.5],
  ['Shotgun Slugs (25)', 20, 1.5],
  ['Sling Stones (20)', 2, 1],
];

/**
 * The armor tables, as [name, Armor/Parry bonus, cost, weight]. Shields carry
 * their bonus as Parry; everything else as Armor.
 */
const ARMOR_TABLE: Array<[string, number, number, number]> = [
  // Medieval & ancient
  ['Cloth Jacket', 1, 20, 5],
  ['Cloth Robes', 1, 30, 8],
  ['Cloth Leggings', 1, 20, 5],
  ['Cloth Cap', 1, 5, 1],
  ['Hardened Leather Jacket', 2, 80, 8],
  ['Hardened Leather Leggings', 2, 40, 7],
  ['Hardened Leather Cap', 2, 20, 1],
  ['Chain Mail', 3, 300, 25],
  ['Chain Leggings', 3, 150, 10],
  ['Chain Hood', 3, 25, 4],
  ['Bronze Barding', 3, 1500, 50],
  ['Bronze Corselet', 3, 80, 13],
  ['Bronze Vambraces', 3, 40, 5],
  ['Bronze Greaves', 3, 50, 6],
  ['Bronze Helmet', 3, 25, 6],
  ['Plate Barding', 4, 1500, 50],
  ['Plate Corselet', 4, 500, 30],
  ['Plate Vambraces', 4, 200, 10],
  ['Plate Greaves', 4, 200, 10],
  ['Helm, Pot', 4, 100, 4],
  ['Helm, Enclosed', 4, 200, 8],
  // Modern
  ['Leather Jacket', 1, 100, 5],
  ['Leather Riding Chaps', 1, 70, 5],
  ['Kevlar Riding Jacket', 2, 350, 8],
  ['Kevlar Riding Jeans', 2, 175, 4],
  ['Bike Helmet', 2, 50, 1],
  ['Motorcycle Helmet', 3, 100, 3],
  ['Flak Jacket', 2, 40, 10],
  ['Kevlar Vest', 2, 200, 5],
  ['Kevlar Vest w/ Inserts', 4, 500, 17],
  ['Kevlar Helmet', 4, 80, 5],
  ['Bombproof Suit', 10, 25000, 25],
  // Futuristic
  ['Body Armor', 4, 200, 4],
  ['Infantry Battle Suit', 6, 800, 12],
  ['Battle Helmet', 6, 100, 2],
  // Shields — the bonus is Parry
  ['Small Shield', 1, 50, 4],
  ['Medium Shield', 2, 100, 8],
  ['Large Shield', 3, 200, 12],
  ['Riot Shield', 3, 80, 5],
  ['Ballistic Shield', 3, 250, 9],
  ['Polymer Shield, Small', 1, 200, 2],
  ['Polymer Shield, Medium', 2, 300, 4],
  ['Polymer Shield, Large', 3, 400, 6],
];

/** The tables' ballistic asterisk: soaks 4 off a ranged hit. */
const BALLISTIC = [
  'Kevlar Vest', 'Kevlar Vest w/ Inserts', 'Kevlar Helmet',
  'Body Armor', 'Infantry Battle Suit', 'Battle Helmet',
];

/**
 * The weapon tables, as [compendium name, cost, weight]. Several rows already
 * existed under this project's own names — a book "Axe, Hand" is the compendium
 * "Hand Axe" — so the name here is whichever one the compendium carries.
 *
 * Ranges are deliberately NOT pinned: the campaign caps every gun's Short band
 * at 60ft (12 tiles) with the Sniper Rifle exempt, which is a table decision
 * that outranks the book's printed distances. See swade.test.ts.
 */
const WEAPON_TABLE: Array<[string, number, number]> = [
  // Melee: medieval
  ['Hand Axe', 100, 2], ['Battle Axe', 300, 4], ['Axe, Great', 400, 7],
  ['Club', 25, 2], ['Club, Heavy', 50, 5], ['Dagger', 25, 1],
  ['Flail', 200, 3], ['Halberd', 250, 6], ['Katana', 1000, 3],
  ['Lance', 300, 6], ['Mace', 100, 4], ['Maul', 400, 10],
  ['Pike', 400, 18], ['Rapier', 150, 2], ['Spear', 100, 3],
  ['Staff', 10, 4], ['Great Sword', 400, 6], ['Long Sword', 300, 3],
  ['Short Sword', 100, 2], ['Warhammer', 250, 2],
  // Melee: modern
  ['Bangstick', 5, 2], ['Bayonet', 25, 1], ['Billy Club/Baton', 10, 1],
  ['Brass Knuckles', 20, 1], ['Chainsaw', 200, 20], ['Switchblade', 10, 0.5],
  ['Survival Knife', 50, 1],
  // Melee: futuristic
  ['Molecular Knife', 250, 0.5], ['Molecular Sword', 500, 2], ['Laser Sword', 1000, 2],
  // Ranged: medieval
  ['Axe, Throwing', 100, 3], ['Bow', 250, 3], ['Crossbow', 250, 5],
  ['Heavy Crossbow', 400, 8], ['Longbow', 300, 3], ['Net (Weighted)', 50, 8],
  ['Sling', 10, 1], ['Spear/Javelin', 100, 3],
  // Ranged: modern
  ['Compound Bow', 200, 3], ['Crossbow (Modern)', 300, 7],
  // Black powder
  ['Flintlock Pistol', 150, 3], ['Musket', 300, 15], ['Blunderbuss', 300, 12],
  ['Kentucky Rifle', 300, 8], ['Springfield Model 1861', 250, 11],
  // Pistols
  ['Derringer (.41)', 100, 1], ['Police Revolver (.38)', 150, 2],
  ['Colt Peacemaker (.45)', 200, 4], ['Smith & Wesson (.357)', 250, 5],
  ['Colt 1911 (.45)', 200, 4], ['Desert Eagle (.50)', 300, 8],
  ['Glock (9mm)', 200, 3], ['Ruger (.22)', 100, 2],
  // Submachine guns
  ['H&K MP5 (9mm)', 300, 10], ['Tommy Gun (.45)', 350, 13], ['Uzi (9mm)', 300, 9],
  // Shotguns
  ['Double-Barrel Shotgun', 150, 11], ['Pump Shotgun', 150, 8],
  ['Sawed-Off Double-Barrel', 150, 6], ['Streetsweeper', 450, 10],
  // Rifles
  ['Barrett (.50)', 750, 35], ['M1 Garand (.30-06)', 300, 10],
  ['Hunting Rifle (.308)', 350, 8], ['Sharps Big 50 (.50)', 400, 11],
  ['Spencer Carbine (.52)', 250, 8], ["Winchester '73 (.44-40)", 300, 10],
  // Assault rifles
  ['AK47 (7.62mm)', 450, 10], ['M-16 (5.56mm)', 400, 8], ['Steyr AUG (5.56mm)', 400, 8],
  // Machine guns
  ['Browning Automatic Rifle (BAR)', 300, 17], ['Gatling (.45)', 500, 170],
  ['Minigun (7.62mm)', 100000, 85], ['M2 Browning (.50 Cal)', 1500, 84],
  ['M60 (7.62mm)', 6000, 33], ['MG42 (7.92mm)', 750, 26], ['SAW (5.56mm)', 4000, 20],
  // Lasers
  ['Laser Pistol', 250, 2], ['Laser SMG', 500, 4],
  ['Laser Rifle', 700, 8], ['Gatling Laser', 1000, 20],
];

/** Personal defence rides the weapon table (they are attacks), not gear. */
const DEFENCE_TABLE: Array<[string, number, number]> = [
  ['Pepper Spray', 15, 0.5],
  ['Stun Gun', 25, 0.5],
];

const swadeEntries = contentForSystem('swade');
const byName = new Map(swadeEntries.map((e) => [e.name, e]));

describe('SWADE gear tables', () => {
  it.each(GEAR_TABLE)('%s is in the compendium at cost %i, weight %s', (name, cost, weight) => {
    const entry = byName.get(name);
    expect(entry, `no swade entry named ${name}`).toBeDefined();
    expect(entry!.gear?.cost).toBe(cost);
    // Ammunition is priced by the box and weighed by the round — the pinned
    // figure is the book's, which is the BOX, so it is the box that has to
    // add back up. Everything else weighs one of itself.
    if (entry!.category === 'Ammunition') {
      // The per-round figure is rounded for a legible sheet, so the box adds
      // back up to within a rounding error rather than exactly.
      const box = (entry!.gear?.weight ?? 0) * (entry!.gear?.qty ?? 1);
      expect(box).toBeCloseTo(weight, 1);
    } else {
      expect(entry!.gear?.weight).toBe(weight);
    }
  });

  it.each(DEFENCE_TABLE)('%s is a weapon costing %i and weighing %s', (name, cost, weight) => {
    const entry = byName.get(name);
    expect(entry, `no swade entry named ${name}`).toBeDefined();
    expect(entry!.kind).toBe('weapon');
    expect(entry!.gear?.cost).toBe(cost);
    expect(entry!.gear?.weight).toBe(weight);
  });

  it.each(ARMOR_TABLE)('%s is in the compendium at +%i, cost %i, weight %s', (name, bonus, cost, weight) => {
    const entry = byName.get(name);
    expect(entry, `no swade entry named ${name}`).toBeDefined();
    expect(entry!.kind).toBe('armor');
    expect(entry!.armor?.baseAc).toBe(bonus);
    expect(entry!.gear?.cost).toBe(cost);
    expect(entry!.gear?.weight).toBe(weight);
  });

  it.each(WEAPON_TABLE)('%s is a weapon costing %i and weighing %s', (name, cost, weight) => {
    const entry = byName.get(name);
    expect(entry, `no swade entry named ${name}`).toBeDefined();
    expect(entry!.kind).toBe('weapon');
    expect(entry!.gear?.cost).toBe(cost);
    expect(entry!.gear?.weight).toBe(weight);
  });

  /**
   * Range in feet, damage, and AP, straight from the tables. Range is the
   * printed Short band in tabletop inches × 5, so one inch is one tile on a
   * standard 5-ft hex. AP 0 means the table's "—".
   */
  const RANGED_STATS: Array<[string, number, string, number]> = [
    ['Bow', 60, '2d6!', 0],
    ['Crossbow', 50, '2d6!', 2],
    ['Heavy Crossbow', 75, '2d8!', 2],
    ['Longbow', 75, '2d6!', 1],
    ['Sling', 20, '1d4!', 0],
    ['Axe, Throwing', 15, '1d6!', 0],
    ['Spear/Javelin', 15, '1d6!', 0],
    ['Compound Bow', 60, '1d6!', 1],
    ['Crossbow (Modern)', 75, '2d6!', 2],
    ['Flintlock Pistol', 25, '2d6!+1', 0],
    ['Musket', 50, '2d8!', 0],
    ['Kentucky Rifle', 75, '2d8!', 2],
    ['Springfield Model 1861', 75, '2d8!', 0],
    ['Derringer (.41)', 15, '2d4!', 0],
    ['Police Revolver (.38)', 50, '2d6!', 0],
    ['Colt Peacemaker (.45)', 60, '2d6!+1', 1],
    ['Colt 1911 (.45)', 60, '2d6!+1', 1],
    ['Desert Eagle (.50)', 75, '2d8!', 2],
    ['Glock (9mm)', 60, '2d6!', 1],
    ['Ruger (.22)', 50, '2d4!', 0],
    ['H&K MP5 (9mm)', 60, '2d6!', 1],
    ['Uzi (9mm)', 60, '2d6!', 1],
    ['Sawed-Off Double-Barrel', 25, '3d6!', 0],
    ['Streetsweeper', 60, '3d6!', 0],
    ['Barrett (.50)', 250, '2d10!', 4],
    ['M1 Garand (.30-06)', 120, '2d8!', 2],
    ['Hunting Rifle (.308)', 120, '2d8!', 2],
    ['Sharps Big 50 (.50)', 150, '2d10!', 2],
    ['Spencer Carbine (.52)', 100, '2d8!', 2],
    ['AK47 (7.62mm)', 120, '2d8!+1', 2],
    ['M-16 (5.56mm)', 120, '2d8!', 2],
    ['Steyr AUG (5.56mm)', 120, '2d8!', 2],
    ['Browning Automatic Rifle (BAR)', 100, '2d8!', 2],
    ['Gatling (.45)', 120, '2d8!', 2],
    ['Minigun (7.62mm)', 150, '2d8!+1', 2],
    ['M2 Browning (.50 Cal)', 250, '2d10!', 4],
    ['M60 (7.62mm)', 150, '2d8!+1', 2],
    ['MG42 (7.92mm)', 150, '2d8!+1', 2],
    ['SAW (5.56mm)', 150, '2d8!', 2],
    ['Laser Pistol', 75, '2d6!', 2],
    ['Laser SMG', 75, '2d6!', 2],
    ['Laser Rifle', 150, '3d6!', 2],
    ['Gatling Laser', 250, '3d6!+4', 2],
  ];

  it.each(RANGED_STATS)('%s reaches %i ft Short for %s, AP %i', (name, range, damage, ap) => {
    const row = applyEntry(byName.get(name)!, swade.defaultSheet())!.row as SheetData;
    expect(row.range).toBe(range);
    expect(row.damage).toBe(damage);
    expect(row.ap).toBe(ap);
  });

  /** Melee damage composes the wielder's Strength die with the weapon's. */
  it('melee weapons compose Str + their own die, with the table\'s AP', () => {
    const rowFor = (name: string) =>
      applyEntry(byName.get(name)!, { ...swade.defaultSheet(), strength: 'd8' })!.row as SheetData;
    expect(rowFor('Axe, Great')).toMatchObject({ damage: '1d8!+1d10!', ap: 2, parryBonus: -1 });
    expect(rowFor('Great Sword')).toMatchObject({ damage: '1d8!+1d10!', ap: 0 });
    expect(rowFor('Katana')).toMatchObject({ damage: '1d8!+1d6!+1', ap: 0 });
    expect(rowFor('Molecular Knife')).toMatchObject({ damage: '1d8!+1d4!+2', ap: 2 });
    expect(rowFor('Laser Sword')).toMatchObject({ damage: '1d8!+1d6!+8', ap: 12 });
    expect(rowFor('Chainsaw')).toMatchObject({ damage: '1d8!+2d6!+4', ap: 0 });
  });

  /**
   * Weapons this project invented — era-parity reskins and the 1960s agency
   * loadout — paired with the book weapon each is meant to BE, mechanically.
   * They exist so a cross-era table is fair: a legionary's gladius and a
   * spacer's carbon knife should kill at the same rate, with only the flavour
   * differing. Pinning them against their counterpart means a change to the
   * book row can never quietly leave a variant behind, which is exactly what
   * happened when the range cap was lifted.
   */
  const PARITY: Array<[string, string]> = [
    // Sidearm tier
    ['Composite War Bow', 'Glock (9mm)'],
    ['Chu-Ko-Nu Repeating Crossbow', 'Glock (9mm)'],
    ['Peacemaker Revolver (.45)', 'Glock (9mm)'],
    ['Pulse Laser Pistol', 'Glock (9mm)'],
    ['Browning Hi-Power', 'Glock (9mm)'],
    // Heavy sidearm tier
    ['Gastraphetes (Belly Bow)', 'Smith & Wesson (.357)'],
    ['Heavy Blaster Pistol', 'Smith & Wesson (.357)'],
    // Longarm tier
    ['English Longbow (War Shaft)', 'Hunting Rifle (.308)'],
    ['Winchester Repeater', 'Hunting Rifle (.308)'],
    ['Phase Carbine', 'Hunting Rifle (.308)'],
    // Marksman tier
    ['Siege Arbalest', 'Barrett (.50)'],
    ['Buffalo Gun (.50-90)', 'Barrett (.50)'],
    ['Photon Lance', 'Barrett (.50)'],
    // Scattergun tier
    ['Grapeshot Hand-Mortar', 'Pump Shotgun'],
    ['Scatter Blaster', 'Pump Shotgun'],
    // Automatic tier
    ['Gatling Gun (Crank)', 'M-16 (5.56mm)'],
    ['Pulse Repeater Rifle', 'M-16 (5.56mm)'],
    // 1960s agency loadout
    ['S&W Model 10 (.38 Special)', 'Police Revolver (.38)'],
    ['Colt Detective Special (Snub)', 'Police Revolver (.38)'],
    ['High Standard HDM (Suppressed .22)', 'Ruger (.22)'],
    ['M1 Carbine', 'Spencer Carbine (.52)'],
    ['Thompson M1928 SMG', 'Tommy Gun (.45)'],
    ['Lipstick Pistol (Single Shot)', 'Derringer (.41)'],
    // Melee tiers
    ['Gladius', 'Short Sword'],
    ['Bowie Knife', 'Short Sword'],
    ['Carbon-Edge Knife', 'Short Sword'],
    ['Khopesh', 'Long Sword'],
    ['Cavalry Saber', 'Long Sword'],
    ['Ceramic Longblade', 'Long Sword'],
    ['Rhomphaia', 'Great Sword'],
    ['Blackjack (Sap)', 'Billy Club/Baton'],
  ];

  it.each(PARITY)('%s hits like its book counterpart, %s', (variant, book) => {
    const sheet = { ...swade.defaultSheet(), strength: 'd8' };
    const a = applyEntry(byName.get(variant)!, sheet)!.row as SheetData;
    const b = applyEntry(byName.get(book)!, sheet)!.row as SheetData;
    expect(a.damage, `${variant} damage`).toBe(b.damage);
    expect(a.ap, `${variant} AP`).toBe(b.ap);
    expect(a.range, `${variant} range`).toBe(b.range);
  });

  /**
   * The special-weapons tables: [name, cost, weight, damage, AP, range ft,
   * blast tiles]. Blast is the engine's tile sphere — the tables' Small,
   * Medium and Large templates are 1, 3 and 5 — or 0 for a weapon with no
   * template. Range 0 means the row prints none (mines are emplaced, and the
   * cannon itself fires whatever shell is loaded).
   */
  const SPECIAL: Array<[string, number, number, string, number, number, number]> = [
    // Cannons
    ['Cannon (12 lb)', 10000, 1200, '0', 0, 5, 0],
    ['Cannon Shell, Canister', 50, 0, '2d6!', 0, 120, 3],
    ['Cannon Shell, Solid Shot', 50, 0, '3d6!+1', 4, 250, 0],
    ['Cannon Shell, Shrapnel', 50, 0, '3d6!', 0, 250, 3],
    // Catapults
    ['Catapult', 10000, 0, '3d6!', 4, 120, 3],
    ['Trebuchet', 50000, 0, '3d8!', 4, 150, 3],
    // Flamethrower — a cone, so no sphere
    ['Flamethrower', 300, 70, '3d6!', 0, 5, 0],
    // Grenades
    ['Mk II Grenade (WWII Pineapple)', 40, 1, '3d6!', 0, 20, 3],
    ['Potato Masher (WWII)', 50, 2, '3d6!-2', 0, 25, 3],
    ['Mk67 Grenade (Modern)', 50, 1, '3d6!', 0, 25, 3],
    ['Smoke Grenade', 50, 1, '0', 0, 25, 5],
    ['Stun Grenade', 50, 1, '0', 0, 25, 5],
    // Mines
    ['Anti-Personnel Mine', 100, 10, '2d6!+2', 0, 5, 1],
    ['Anti-Tank Mine', 200, 20, '4d6!', 5, 5, 3],
    ['Bouncing Betty', 125, 9, '3d6!', 0, 5, 1],
    ['Claymore Mine', 75, 4, '3d6!', 0, 5, 0],
    // Missiles
    ['TOW Missile', 60000, 207, '5d10!', 34, 375, 3],
    ['Hellfire Missile', 115000, 100, '5d10!', 44, 750, 3],
    ['Sidewinder Missile', 600000, 188, '4d8!', 6, 500, 1],
    ['Sparrow Missile', 125000, 617, '5d10!', 8, 750, 1],
    // Rocket launchers & torpedoes
    ['AT-4', 1500, 15, '4d8!+2', 24, 120, 3],
    ['Bazooka', 500, 12, '4d8!', 8, 120, 3],
    ['M203 40mm', 1500, 3, '4d8!', 0, 120, 3],
    ['M72 LAW', 750, 5, '4d8!+2', 22, 120, 3],
    ['Panzerschreck', 1000, 20, '4d8!', 12, 75, 3],
    ['Torpedo', 500000, 3000, '8d10!', 22, 1500, 5],
  ];

  it.each(SPECIAL)('%s: $%i, %s lb, %s, AP %i, %i ft, blast %i', (name, cost, weight, damage, ap, range, blast) => {
    const entry = byName.get(name);
    expect(entry, `no swade entry named ${name}`).toBeDefined();
    expect(entry!.gear?.cost).toBe(cost);
    expect(entry!.gear?.weight).toBe(weight);
    const row = applyEntry(entry!, swade.defaultSheet())!.row as SheetData;
    expect(row.damage).toBe(damage);
    expect(row.ap).toBe(ap);
    expect(row.range).toBe(range);
    expect(row.aoeHexes ?? 0).toBe(blast);
    if (blast > 0) expect(row.aoeShape).toBe('sphere');
  });

  /**
   * Powers whose BASE is a template — the book prints the area in the power's
   * own text, not as a modifier. Each must reach the sheet with its area AND
   * become a real targeted AoE action; a template that generates no action is
   * inert data.
   *
   * Stun, Fear, Entangle and Slumber used to be in this list and are not any
   * more: the book gives each of them "AREA OF EFFECT (+2/+3)" under MODIFIERS,
   * so they are single-target until a caster pays for the template. Baking it
   * in made them strictly better than the book's version, for free.
   */
  const AREA_POWERS: Array<[string, string]> = [
    ['Silence', 'silenced'],
    ['Light/Darkness', 'blinded'],
  ];

  it.each(AREA_POWERS)('%s covers a Medium Blast Template and inflicts %s', (name, condition) => {
    const entry = byName.get(name)!;
    expect(entry.kind).toBe('power');
    const base = swade.defaultSheet();
    const row = applyEntry(entry, base)!.row as SheetData;
    expect(row.aoeShape).toBe('sphere');
    expect(row.aoeHexes).toBe(3);
    expect(row.condition).toBe(condition);

    // ...and it has to survive into an actual action with its template.
    const sheet: SheetData = {
      ...base,
      arcaneSkill: 'Spellcasting',
      skills: [{ name: 'Spellcasting', die: 'd8' }],
      powers: [row],
    };
    const character = { id: 'c', campaignId: 'x', ownerUserId: 'u', name: 'T', system: 'swade', sheet } as unknown as Character;
    const action = combatActions(character).find((a) => a.label === name);
    expect(action, `${name} produced no action`).toBeDefined();
    expect(action!.aoe).toMatchObject({ shape: 'sphere', sizeHexes: 3 });
    expect(action!.appliesCondition).toBe(condition);
  });

  it('no longer carries a bare "9mm Pistol" — the named 9mms replace it', () => {
    expect(byName.has('9mm Pistol')).toBe(false);
    for (const kept of ['Glock (9mm)', 'H&K MP5 (9mm)', 'Uzi (9mm)']) {
      expect(byName.has(kept), `${kept} should still be here`).toBe(true);
    }
  });

  it('gives the flamethrower and the claymore a cone rather than a sphere', () => {
    for (const name of ['Flamethrower', 'Claymore Mine']) {
      const row = applyEntry(byName.get(name)!, swade.defaultSheet())!.row as SheetData;
      expect(row.aoeShape, name).toBe('cone');
    }
  });

  it.each(BALLISTIC)('%s soaks 4 off a ranged hit, per its ballistic asterisk', (name) => {
    expect(byName.get(name)!.armor?.rangedArmor).toBe(4);
  });

  it('puts a shield bonus on Parry and body armor on Armor', () => {
    const rowFor = (name: string): SheetData =>
      applyEntry(byName.get(name)!, swade.defaultSheet())!.row as SheetData;
    const shield = rowFor('Large Shield');
    expect(shield.parryBonus).toBe(3);
    expect(shield.armor).toBe(0);
    const plate = rowFor('Plate Corselet');
    expect(plate.armor).toBe(4);
    expect(plate.parryBonus).toBe(0);
    // Weight rides onto the row from the table, not a guess.
    expect(plate.weight).toBe(30);
    expect(shield.weight).toBe(12);
  });

  it('prices a shop shelf from the item, not from a flat per-kind number', () => {
    // The whole point of carrying cost: a laptop and a bar of soap used to
    // stock at the same money.
    expect(shopItemFromEntry(byName.get('Laptop')!).price).toBe(1200);
    expect(shopItemFromEntry(byName.get('Soap')!).price).toBe(1);
    expect(shopItemFromEntry(byName.get('Horse')!).price).toBe(300);
  });

  it('carries the stated weight onto the sheet row, including a stated zero', () => {
    const rowFor = (name: string): SheetData => {
      const applied = applyEntry(byName.get(name)!, swade.defaultSheet());
      expect(applied, `${name} did not apply`).toBeTruthy();
      return applied!.row as SheetData;
    };
    expect(rowFor('Laptop').weight).toBe(5);
    expect(rowFor('Soap').weight).toBe(0.2);
    // "—" in the table: it must land as 0, not be guessed at by the fallback.
    expect(rowFor('Lighter').weight).toBe(0);
    expect(rowFor('Telephone Tap').weight).toBe(0);
  });

  it('gives the two personal-defence items their Stun rider and shots', () => {
    const spray = applyEntry(byName.get('Pepper Spray')!, swade.defaultSheet())!.row as SheetData;
    expect(spray.save).toBe('vigor');
    expect(spray.condition).toBe('stunned');
    expect(spray.ammo).toBe(5);
    expect(spray.range).toBe(10);
    // A spray can does not reach four times as far for a penalty.
    expect(spray.hardRange).toBe(true);

    const stun = applyEntry(byName.get('Stun Gun')!, swade.defaultSheet())!.row as SheetData;
    expect(stun.save).toBe('vigor');
    expect(stun.condition).toBe('stunned');
    expect(stun.ammo).toBe(3);
    // 1/2/4" bands — a real ranged shot, so no hard cap.
    expect(stun.range).toBe(6);
    expect(stun.hardRange).toBeUndefined();
  });

  it('gives every entry its own id, so none shadows another in contentById', () => {
    // Names may repeat across kinds — the power "Armor" and the racial ability
    // "Armor" are different things — and that is fine, because the slug is
    // system+kind+name. Two entries sharing an ID would not be.
    const seen = new Map<string, number>();
    for (const e of swadeEntries) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('keeps one entry per name WITHIN a kind, so a lookup by name is unambiguous', () => {
    const seen = new Map<string, number>();
    for (const e of swadeEntries) {
      const key = `${e.kind}:${e.name}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
  });
});

describe('ammunition weighs by the round, not by the box', () => {
  const ammo = contentForSystem('swade').filter((e) => e.category === 'Ammunition');

  it('has ammunition to weigh at all', () => {
    expect(ammo.length).toBeGreaterThan(8);
  });

  it('carries a per-round weight that adds back up to the box', () => {
    // The table prints "2 lbs / 50 rounds". The row holds 50 rounds at 0.04
    // each, because everything downstream multiplies weight by quantity.
    const medium = ammo.find((e) => e.name === 'Bullets, Medium (50)')!;
    expect(medium.gear?.qty).toBe(50);
    expect(medium.gear?.weight).toBeCloseTo(0.04, 5);
    expect((medium.gear!.weight ?? 0) * medium.gear!.qty!).toBeCloseTo(2, 5);
  });

  it('is why 40 rounds weigh under two pounds and not eighty', () => {
    const medium = ammo.find((e) => e.name === 'Bullets, Medium (50)')!;
    const sheet: SheetData = {
      strength: 'd6',
      inventory: [{ name: medium.name, qty: 40, weight: medium.gear!.weight }],
    };
    expect(swadeWeightCarried(sheet)).toBeCloseTo(1.6, 5);
  });

  it('never weighs a round as nothing at all, however light the box', () => {
    for (const e of ammo) expect(e.gear?.weight, e.name).toBeGreaterThan(0);
  });
});
