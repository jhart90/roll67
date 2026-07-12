// Savage Worlds Adventure Edition core content: weapons, armor & shields,
// powers, and common gear. Damage entries hold only the weapon's own dice —
// melee weapons add the wielder's acing Strength die when applied to a sheet
// (applyEntry composes it), matching SWADE's "Str + weapon die" convention.
// Ranges are feet (SWADE short range in tabletop inches × 6).
import { contentSlug, type ContentEntry } from './compendiumTypes.js';

// [name, category, weaponDie, type, ability, props]
type W = [string, string, string, string, 'str' | 'ranged' | 'none', string[]];
const WEAPONS: W[] = [
  ['Unarmed', 'Melee', '', 'bludgeoning', 'str', []],
  ['Dagger', 'Melee', '1d4!', 'piercing', 'str', ['can be thrown']],
  ['Club', 'Melee', '1d4!', 'bludgeoning', 'str', []],
  ['Short Sword', 'Melee', '1d6!', 'slashing', 'str', []],
  ['Spear', 'Melee', '1d6!', 'piercing', 'str', ['reach 1', '+1 Parry two-handed']],
  ['Staff', 'Melee', '1d4!', 'bludgeoning', 'str', ['reach 1', '+1 Parry']],
  ['Rapier', 'Melee', '1d4!', 'piercing', 'str', ['+1 Parry']],
  ['Long Sword', 'Melee', '1d8!', 'slashing', 'str', []],
  ['Battle Axe', 'Melee', '1d8!', 'slashing', 'str', []],
  ['Warhammer', 'Melee', '1d6!', 'bludgeoning', 'str', ['AP 1 vs rigid armor']],
  ['Great Sword', 'Melee', '1d10!', 'slashing', 'str', ['two-handed', 'Parry −1']],
  ['Maul', 'Melee', '1d10!', 'bludgeoning', 'str', ['two-handed', 'AP 2 vs rigid armor']],
  ['Katana', 'Melee', '1d6!+1', 'slashing', 'str', ['AP 2']],
  ['Sling', 'Ranged', '1d4!', 'bludgeoning', 'ranged', ['range 24/48/96']],
  ['Bow', 'Ranged', '2d6!', 'piercing', 'ranged', ['range 72/144/288']],
  ['Crossbow', 'Ranged', '2d6!', 'piercing', 'ranged', ['range 90/180/360', 'AP 2', '1 action to reload']],
  ['Throwing Knife', 'Ranged', '1d4!', 'piercing', 'ranged', ['range 18/36/72', 'add Str die to damage']],
  ['Derringer', 'Ranged', '2d4!', 'kinetic', 'ranged', ['range 30/60/120', 'mag 2']],
  ['9mm Pistol', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 72/144/288', 'mag 17', 'AP 1']],
  ['.44 Magnum', 'Ranged', '2d6!+1', 'kinetic', 'ranged', ['range 72/144/288', 'mag 6', 'AP 1']],
  ['Pump Shotgun', 'Ranged', '3d6!', 'kinetic', 'ranged', ['range 72/144/288', 'mag 6', 'damage 3d6/2d6/1d6 by range band']],
  ['Hunting Rifle', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 144/288/576', 'mag 5', 'AP 2']],
  ['Assault Rifle', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 144/288/576', 'mag 30', 'AP 2', 'RoF 3']],
  ['Submachine Gun', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 72/144/288', 'mag 30', 'AP 1', 'RoF 3']],
  ['Sniper Rifle', 'Ranged', '2d10!', 'kinetic', 'ranged', ['range 300/600/1200', 'mag 10', 'AP 4', 'snapfire']],
  ['Flintlock Pistol', 'Ranged', '2d6!+1', 'kinetic', 'ranged', ['range 30/60/120', '2 actions to reload']],
  ['Frag Grenade', 'Ranged', '3d6!', 'kinetic', 'ranged', ['range 30/60/120', 'thrown', 'medium blast']],
];

// [name, category, bonus, notes] — category 'Shield' means the bonus is Parry.
type A = [string, string, number, string];
const ARMOR: A[] = [
  ['Leather Jacket', 'Armor', 1, 'Covers torso/arms'],
  ['Leather Armor', 'Armor', 2, 'Covers torso/arms/legs'],
  ['Chain Mail', 'Armor', 3, 'Flexible metal links'],
  ['Plate Corselet', 'Armor', 4, 'Rigid breastplate'],
  ['Kevlar Vest', 'Armor', 2, 'Modern ballistic vest; negates 4 AP from bullets'],
  ['Kevlar Vest w/ Inserts', 'Armor', 4, 'Ceramic plate inserts'],
  ['Small Shield', 'Shield', 1, '+1 Parry'],
  ['Medium Shield', 'Shield', 2, '+2 Parry, +2 Armor vs ranged that hits'],
  ['Large Shield', 'Shield', 3, '+3 Parry, +2 Armor vs ranged that hits'],
];

// [name, ppCost, rankReq, subtitle, damage?, heal?, rangeFt?]
type P = [string, number, string, string, string?, boolean?, number?];
const POWERS: P[] = [
  ['Arcane Protection', 1, 'Novice', 'Foes suffer a penalty to affect you with powers'],
  ['Armor', 1, 'Novice', '+2 Armor (or +4 with a raise) for 5 rounds'],
  ['Blast', 3, 'Seasoned', 'Medium blast template of damage', '2d6!', false, 288],
  ['Bolt', 1, 'Novice', 'A missile of arcane energy', '2d6!', false, 288],
  ['Boost/Lower Trait', 2, 'Novice', 'Raise or lower a target trait one die type'],
  ['Burrow', 2, 'Novice', 'Meld into and move through earth'],
  ['Burst', 2, 'Novice', 'Cone template of damage', '2d6!', false, 0],
  ['Confusion', 1, 'Novice', 'Target must make a Smarts roll or be Distracted & Vulnerable'],
  ['Deflection', 3, 'Novice', 'Attacks against you suffer −2 (−4 with a raise)'],
  ['Detect/Conceal Arcana', 2, 'Novice', 'Sense or hide the supernatural'],
  ['Dispel', 1, 'Seasoned', 'Cancel an enemy power'],
  ['Empathy', 1, 'Novice', 'Read emotions; bonus to social rolls'],
  ['Entangle', 2, 'Novice', 'Target is Entangled (Bound with a raise)'],
  ['Environmental Protection', 2, 'Novice', 'Breathe/operate in a hostile environment'],
  ['Fear', 2, 'Novice', 'Target makes a Fear check (Spirit roll)'],
  ['Fly', 3, 'Veteran', 'Fly at Pace 12'],
  ['Healing', 3, 'Novice', 'Heal a Wound (two with a raise) within the golden hour', '1', true, 5],
  ['Illusion', 3, 'Novice', 'Create a visual illusion'],
  ['Invisibility', 5, 'Seasoned', '−4 to be hit or noticed (−6 with a raise)'],
  ['Light/Darkness', 1, 'Novice', 'Create or extinguish light'],
  ['Protection', 1, 'Novice', '+2 Toughness (or +4 with a raise)'],
  ['Puppet', 3, 'Veteran', 'Control a target’s actions (opposed by Spirit)'],
  ['Relief', 1, 'Novice', 'Remove Fatigue or Shaken'],
  ['Smite', 2, 'Novice', 'A weapon gains +2 damage (+4 with a raise)'],
  ['Speed', 2, 'Novice', 'Double a target’s Pace'],
  ['Stun', 2, 'Novice', 'Target makes a Vigor roll or is Stunned'],
  ['Telekinesis', 5, 'Seasoned', 'Move objects or creatures with your mind'],
  ['Teleport', 2, 'Seasoned', 'Instantly move up to 12″ (double with a raise)'],
];

// [name, subtitle]
type G = [string, string];
const GEAR: G[] = [
  ['Backpack', 'Standard load carrier'],
  ['Bedroll', 'Sleeping kit'],
  ['Rope (10 yards)', 'Hemp climbing rope'],
  ['Grappling Hook', 'Anchors a rope'],
  ['Torch', '1 hour of light, 4″ radius'],
  ['Flashlight', '10″ beam, batteries last a session'],
  ['Lantern', '4″ radius, burns 3 hours per pint of oil'],
  ['Flint & Steel', 'Start fires'],
  ['Canteen', 'A day of water'],
  ['Rations (5 days)', 'Trail food'],
  ['First Aid Kit', 'Basic supplies; regain 2d4+2 hit points and negate a wound penalty'],
  ['Lockpicks', '+1 to Thievery to open locks'],
  ['Crowbar', '+1 Strength to force things open'],
  ['Binoculars', 'See distant detail'],
  ['Gas Mask', 'Protects against inhaled toxins'],
  ['Cell Phone', 'Modern communication'],
  ['Climbing Gear', '+2 to Athletics (climbing)'],
  ['Whetstone', 'Weapon maintenance'],
  ['Quiver (20 arrows)', 'Ammunition for bows'],
  ['Bullets (50)', 'Ammunition, small caliber'],
];

export const CONTENT_SWADE: ContentEntry[] = [
  ...WEAPONS.map(([name, category, damage, damageType, ability, props], i): ContentEntry => ({
    id: contentSlug('swade', 'weapon', name),
    system: 'swade', kind: 'weapon', name, category, order: i,
    subtitle: `${damage ? `${ability === 'str' ? `Str+${damage}` : damage} ${damageType}` : `Str ${damageType}`}${props.length ? ` · ${props.join(', ')}` : ''}`,
    weapon: { damage, damageType, ability, props },
  })),
  ...ARMOR.map(([name, category, baseAc, notes], i): ContentEntry => ({
    id: contentSlug('swade', 'armor', name),
    system: 'swade', kind: 'armor', name, category, order: i,
    subtitle: category === 'Shield' ? `+${baseAc} Parry` : `+${baseAc} Armor`,
    armor: { baseAc, addDex: false, notes },
  })),
  ...POWERS.map(([name, cost, rank, subtitle, damage, heal, rangeFt], i): ContentEntry => ({
    id: contentSlug('swade', 'power', name),
    system: 'swade', kind: 'power', name, category: rank, order: i,
    subtitle: `${cost} PP · ${rank} · ${subtitle}`,
    power: {
      discipline: rank, level: cost, notes: subtitle,
      ...(damage ? { damage, heal: heal === true } : {}),
      ...(rangeFt !== undefined ? { rangeFt } : {}),
    },
  })),
  ...GEAR.map(([name, subtitle], i): ContentEntry => ({
    id: contentSlug('swade', 'gear', name),
    system: 'swade', kind: 'gear', name, category: 'Gear', order: i,
    subtitle,
    gear: {},
  })),
];
