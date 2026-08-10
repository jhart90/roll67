// Savage Worlds Adventure Edition core content: weapons, armor & shields,
// powers, and common gear. Damage entries hold only the weapon's own dice —
// melee weapons add the wielder's acing Strength die when applied to a sheet
// (applyEntry composes it), matching SWADE's "Str + weapon die" convention.
// Ranges are feet (SWADE short range in tabletop inches × 6).
import { contentSlug, type ContentEntry } from './compendiumTypes.js';

// [name, category, weaponDie, type, ability, props]
// [name, category, weaponDie, type, ability, props, cost?, weight?]
type W = [string, string, string, string, 'str' | 'ranged' | 'none', string[], number?, number?];
const WEAPONS: W[] = [
  ['Unarmed', 'Melee', '', 'bludgeoning', 'str', []],
  // Grabbed off the floor mid-brawl: −2 to attack rolls, per the quick rules.
  ['Improvised Weapon (Light)', 'Melee', '1d4!', 'bludgeoning', 'str', ['improvised — −2 to attacks', 'a bottle, a mug, a loose brick']],
  ['Improvised Weapon (Medium)', 'Melee', '1d6!', 'bludgeoning', 'str', ['improvised — −2 to attacks', 'a chair, a shovel, a lamp']],
  ['Improvised Weapon (Heavy)', 'Melee', '1d8!', 'bludgeoning', 'str', ['improvised — −2 to attacks', 'a bar stool, a small table', 'min Str d8']],
  ['Dagger', 'Melee', '1d4!', 'piercing', 'str', ['can be thrown', 'min Str d4'], 25, 1],
  ['Club', 'Melee', '1d4!', 'bludgeoning', 'str', ['min Str d4', 'a sign of low status or thuggery'], 25, 2],
  ['Short Sword', 'Melee', '1d6!', 'slashing', 'str', ['min Str d6', 'includes cavalry sabers'], 100, 2],
  ['Spear', 'Melee', '1d6!', 'piercing', 'str', ['reach 1', '+1 Parry two-handed', 'min Str d6'], 100, 3],
  ['Staff', 'Melee', '1d4!', 'bludgeoning', 'str', ['reach 1', '+1 Parry', 'two-handed', 'min Str d4'], 10, 4],
  ['Rapier', 'Melee', '1d4!', 'piercing', 'str', ['+1 Parry', 'min Str d4'], 150, 2],
  ['Long Sword', 'Melee', '1d8!', 'slashing', 'str', ['min Str d8', 'basic swords and scimitars'], 300, 3],
  ['Battle Axe', 'Melee', '1d8!', 'slashing', 'str', ['min Str d8'], 300, 4],
  ['Warhammer', 'Melee', '1d6!', 'bludgeoning', 'str', ['AP 1', 'spiked', 'min Str d6'], 250, 2],
  ['Great Sword', 'Melee', '1d10!', 'slashing', 'str', ['two-handed', 'Parry −1', 'min Str d10'], 400, 6],
  ['Maul', 'Melee', '1d10!', 'bludgeoning', 'str', ['two-handed', '+2 damage to break objects', 'min Str d10'], 400, 10],
  ['Katana', 'Melee', '1d6!+1', 'slashing', 'str', ['AP 2', 'two-handed', 'min Str d6'], 1000, 3],
  ['Sling', 'Ranged', '1d4!', 'bludgeoning', 'ranged', ['range 24/48/96', 'thrown with Athletics', 'min Str d4', 'caliber: stones'], 10, 1],
  ['Bow', 'Ranged', '2d6!', 'piercing', 'ranged', ['range 60/120/240', 'min Str d6', 'caliber: arrows'], 250, 3],
  ['Crossbow', 'Ranged', '2d6!', 'piercing', 'ranged', ['range 60/120/240', 'AP 2', 'hand-drawn', '1 action to reload', 'min Str d6', 'caliber: bolts'], 250, 5],
  ['Throwing Knife', 'Ranged', '1d4!', 'piercing', 'ranged', ['range 18/36/72', 'add Str die to damage']],
  ['Derringer', 'Ranged', '2d4!', 'kinetic', 'ranged', ['range 30/60/120', 'mag 2', '−2 to be Noticed if hidden', 'min Str d4', 'caliber: bullets-small'], 100, 1],
  ['9mm Pistol', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 17', 'AP 1', 'caliber: bullets-medium']],
  ['.44 Magnum', 'Ranged', '2d6!+1', 'kinetic', 'ranged', ['range 60/120/240', 'mag 6', 'AP 1', 'caliber: bullets-medium']],
  ['Pump Shotgun', 'Ranged', '3d6!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 6', 'damage 3d6/2d6/1d6 by range band', 'min Str d4', 'caliber: shells'], 150, 8],
  ['Hunting Rifle', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 5', 'AP 2', 'snapfire', 'min Str d6', 'caliber: bullets-medium'], 350, 8],
  ['Assault Rifle', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 30', 'AP 2', 'RoF 3', 'caliber: bullets-medium']],
  ['Submachine Gun', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 30', 'AP 1', 'RoF 3', 'caliber: bullets-medium']],
  ['Sniper Rifle', 'Ranged', '2d10!', 'kinetic', 'ranged', ['range 300/600/1200', 'mag 10', 'AP 4', 'snapfire', 'caliber: bullets-large']],
  ['Flintlock Pistol', 'Ranged', '2d6!+1', 'kinetic', 'ranged', ['range 30/60/120', 'Reload 3', 'min Str d4', 'caliber: shot'], 150, 3],
  ['Frag Grenade', 'Ranged', '3d6!', 'kinetic', 'ranged', ['range 25/50/100', 'thrown', 'medium blast']],
  // --- more melee ---
  ['Brass Knuckles', 'Melee', '1d4!', 'bludgeoning', 'str', ['does not count as a weapon for Unarmed Defender', 'min Str d4'], 20, 1],
  ['Hand Axe', 'Melee', '1d6!', 'slashing', 'str', ['can be thrown', 'min Str d6'], 100, 2],
  ['Flail', 'Melee', '1d6!', 'bludgeoning', 'str', ['ignores shield Parry bonus', 'min Str d6'], 200, 3],
  ['Halberd', 'Melee', '1d8!', 'slashing', 'str', ['reach 1', 'two-handed', 'min Str d8'], 250, 6],
  ['Lance', 'Melee', '1d8!', 'piercing', 'str', ['reach 2', 'AP 2 when charging mounted', 'only usable mounted', 'min Str d8'], 300, 6],
  ['Pike', 'Melee', '1d8!', 'piercing', 'str', ['reach 2', 'two-handed', 'unwieldy in close quarters', 'min Str d8'], 400, 18],
  ['Rapier (Main Gauche)', 'Melee', '1d4!', 'piercing', 'str', ['+1 Parry']],
  ['Scimitar', 'Melee', '1d6!', 'slashing', 'str', []],
  ['Trident', 'Melee', '1d6!', 'piercing', 'str', ['reach 1', 'can be thrown']],
  ['War Pick', 'Melee', '1d6!', 'piercing', 'str', ['AP 2 vs rigid armor']],
  ['Bayonet', 'Melee', '1d4!', 'piercing', 'str', ['Str+d6 and +1 Parry fixed to a rifle', 'reach 1', 'two-handed', 'min Str d4'], 25, 1],
  ['Chainsaw', 'Melee', '2d6!', 'slashing', 'str', ['AP 2', 'critical failure hits the wielder', 'min Str d6'], 200, 20],
  ['Survival Knife', 'Melee', '1d4!', 'piercing', 'str', ['can be thrown', 'tools in the handle add +1 to Survival', 'min Str d4'], 50, 1],
  ['Stun Baton', 'Melee', '1d4!', 'energy', 'str', ['target rolls Vigor or is Stunned']],
  ['Vibro-Blade', 'Melee', '1d8!', 'slashing', 'str', ['AP 4']],
  ['Molecular Sword', 'Melee', '1d10!', 'slashing', 'str', ['AP 4', 'min Str d6'], 500, 2],
  // --- more ranged ---
  ['Blowgun', 'Ranged', '1', 'piercing', 'ranged', ['range 18/36/72', 'delivers poison']],
  ['Longbow', 'Ranged', '2d6!', 'piercing', 'ranged', ['range 60/120/240', 'AP 1', 'min Str d8', 'caliber: arrows'], 300, 3],
  ['Heavy Crossbow', 'Ranged', '2d8!', 'piercing', 'ranged', ['range 60/120/240', 'AP 2', 'needs a windlass — Reload 2', 'min Str d6', 'caliber: bolts'], 400, 8],
  ['Musket', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'Brown Bess and similar', 'Reload 3', 'min Str d6', 'caliber: shot'], 300, 15],
  ['Blunderbuss', 'Ranged', '3d6!', 'kinetic', 'ranged', ['range 30/60/120', 'treat as a shotgun', 'Reload 3', 'min Str d6', 'caliber: shot'], 300, 12],
  ['Revolver (.357)', 'Ranged', '2d6!+1', 'kinetic', 'ranged', ['range 60/120/240', 'mag 6', 'AP 1', 'caliber: bullets-medium']],
  ['Machine Pistol', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 20', 'AP 1', 'RoF 3', 'caliber: bullets-medium']],
  ['Double-Barrel Shotgun', 'Ranged', '3d6!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 2', 'min Str d6', 'caliber: shells'], 150, 11],
  ['Combat Shotgun', 'Ranged', '3d6!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 8', 'RoF 3', 'caliber: shells']],
  ['Bolt-Action Rifle', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 5', 'AP 2', 'caliber: bullets-medium']],
  ['Light Machine Gun', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 100', 'AP 2', 'RoF 4', 'snapfire', 'caliber: bullets-medium']],
  ['Heavy Machine Gun', 'Ranged', '2d10!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 200', 'AP 4', 'RoF 4', 'snapfire', 'caliber: bullets-large']],
  ['Rocket Launcher', 'Ranged', '4d8!', 'fire', 'ranged', ['range 60/120/240', 'mag 1', 'AP 9', 'medium blast']],
  ['Grenade Launcher', 'Ranged', '3d6!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 6', 'medium blast']],
  ['Flamethrower', 'Ranged', '2d10!', 'fire', 'ranged', ['cone template', 'targets may catch fire']],
  ['Laser Pistol', 'Ranged', '2d6!', 'energy', 'ranged', ['range 60/120/240', 'mag 24', 'AP 2', 'no Recoil', 'min Str d4', 'caliber: battery-pistol'], 250, 2],
  ['Laser Rifle', 'Ranged', '2d8!', 'energy', 'ranged', ['range 60/120/240', 'mag 30', 'AP 4', 'no Recoil', 'min Str d6', 'caliber: battery-rifle'], 700, 8],
  ['Plasma Rifle', 'Ranged', '3d8!', 'energy', 'ranged', ['range 60/120/240', 'mag 20', 'AP 6', 'caliber: battery-rifle']],
  ['Gauss Rifle', 'Ranged', '2d10!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 40', 'AP 6', 'RoF 3', 'caliber: bullets-large']],
  ['Smoke Grenade', 'Ranged', '0', '', 'ranged', ['range 25/50/100', 'thrown', 'medium blast', 'blocks line of sight']],
  ['Stun Grenade', 'Ranged', '0', 'energy', 'ranged', ['range 25/50/100', 'thrown', 'medium blast', 'Vigor roll or Stunned']],
  ['Molotov Cocktail', 'Ranged', '2d10!', 'fire', 'ranged', ['range 25/50/100', 'thrown', 'small blast', 'may set fires']],
  // --- era parity variants ---
  // The same killing power expressed by different centuries: a master archer's
  // war bow, a gunslinger's revolver and a laser sidearm all sit on one
  // damage tier, with identical damage, AP, range and riders. Magazines and
  // reload speeds stay period flavour. The RAW-priced originals above are
  // untouched; these are for cross-era campaigns where the eras must be fair.
  ['Composite War Bow', 'Ranged', '2d6!', 'piercing', 'ranged', ['range 60/120/240', 'AP 1', 'era: ancient — sidearm parity with 9mm Pistol & Pulse Laser Pistol', 'caliber: arrows']],
  ['Chu-Ko-Nu Repeating Crossbow', 'Ranged', '2d6!', 'piercing', 'ranged', ['range 60/120/240', 'AP 1', 'mag 10', 'era: medieval — sidearm parity', 'caliber: bolts']],
  ['Peacemaker Revolver (.45)', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 1', 'mag 6', 'era: old west — sidearm parity', 'caliber: bullets-medium']],
  ['Pulse Laser Pistol', 'Ranged', '2d6!', 'energy', 'ranged', ['range 60/120/240', 'AP 1', 'mag 24', 'era: future — sidearm parity', 'caliber: battery-pistol']],
  ['Gastraphetes (Belly Bow)', 'Ranged', '2d6!+1', 'piercing', 'ranged', ['range 60/120/240', 'AP 1', '1 action to reload', 'era: ancient Greece — heavy sidearm parity with .44 Magnum & Revolver (.357)', 'caliber: bolts']],
  ['Heavy Blaster Pistol', 'Ranged', '2d6!+1', 'energy', 'ranged', ['range 60/120/240', 'AP 1', 'mag 12', 'era: future — heavy sidearm parity', 'caliber: battery-pistol']],
  ['English Longbow (War Shaft)', 'Ranged', '2d8!', 'piercing', 'ranged', ['range 60/120/240', 'AP 2', 'min Str d8', 'era: medieval — longarm parity with Hunting Rifle & Bolt-Action Rifle', 'caliber: arrows']],
  ['Winchester Repeater', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'mag 15', 'era: old west — longarm parity', 'caliber: bullets-medium']],
  ['Phase Carbine', 'Ranged', '2d8!', 'energy', 'ranged', ['range 60/120/240', 'AP 2', 'mag 30', 'era: future — longarm parity', 'caliber: battery-rifle']],
  ['Siege Arbalest', 'Ranged', '2d10!', 'piercing', 'ranged', ['range 60/120/240', 'AP 4', 'snapfire', '2 actions to reload', 'era: medieval — marksman parity with Sniper Rifle', 'caliber: bolts']],
  ['Buffalo Gun (.50-90)', 'Ranged', '2d10!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 4', 'snapfire', 'mag 1', 'era: old west — marksman parity', 'caliber: bullets-large']],
  ['Photon Lance', 'Ranged', '2d10!', 'energy', 'ranged', ['range 60/120/240', 'AP 4', 'snapfire', 'mag 10', 'era: future — marksman parity']],
  ['Grapeshot Hand-Mortar', 'Ranged', '3d6!', 'kinetic', 'ranged', ['range 30/60/120', '2 actions to reload', 'damage 3d6/2d6/1d6 by range band', 'era: black powder — scattergun parity with Pump Shotgun', 'caliber: shot']],
  ['Scatter Blaster', 'Ranged', '3d6!', 'energy', 'ranged', ['range 60/120/240', 'mag 8', 'damage 3d6/2d6/1d6 by range band', 'era: future — scattergun parity', 'caliber: battery-rifle']],
  ['Thunderclap Powder Bomb', 'Ranged', '3d6!', 'kinetic', 'ranged', ['range 25/50/100', 'thrown', 'medium blast', 'era: medieval China — grenade parity with Frag Grenade']],
  ['Micro-Frag Sphere', 'Ranged', '3d6!', 'kinetic', 'ranged', ['range 25/50/100', 'thrown', 'medium blast', 'era: future — grenade parity']],
  // Automatic-fire parity tier (matches the Assault Rifle's 2d8!/AP 2/RoF 3).
  // No ancient/medieval members: sustained automatic fire simply doesn't
  // exist before self-contained cartridges.
  ['Gatling Gun (Crank)', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'mag 40', 'RoF 3', 'snapfire', 'era: old west — automatic parity with Assault Rifle', 'caliber: bullets-medium']],
  ['Pulse Repeater Rifle', 'Ranged', '2d8!', 'energy', 'ranged', ['range 60/120/240', 'AP 2', 'mag 60', 'RoF 3', 'era: future — automatic parity', 'caliber: battery-rifle']],
  ['Gladius', 'Melee', '1d6!', 'slashing', 'str', ['era: ancient Rome — blade parity with Short Sword & Bowie Knife']],
  ['Bowie Knife', 'Melee', '1d6!', 'slashing', 'str', ['era: old west — blade parity']],
  ['Carbon-Edge Knife', 'Melee', '1d6!', 'slashing', 'str', ['era: future — blade parity']],
  ['Khopesh', 'Melee', '1d8!', 'slashing', 'str', ['era: ancient Egypt — sword parity with Long Sword']],
  ['Cavalry Saber', 'Melee', '1d8!', 'slashing', 'str', ['era: old west — sword parity']],
  ['Ceramic Longblade', 'Melee', '1d8!', 'slashing', 'str', ['era: future — sword parity (Vibro-Blade is the AP 4 upgrade, not this tier)']],
  ['Rhomphaia', 'Melee', '1d10!', 'slashing', 'str', ['two-handed', 'Parry −1', 'era: ancient Thrace — greatblade parity with Great Sword']],
  // --- 1960s FBI / CIA (JFK era) ---
  // What agents of various junior ranks actually carried: revolvers as
  // standard issue, a pistol and carbine from the field office armory, and
  // the Agency's quieter tools. Sidearm-tier damage throughout — right for
  // Novice opposition or Novice player agents.
  ['S&W Model 10 (.38 Special)', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 6', 'era: 1960s — FBI standard issue', 'caliber: bullets-medium']],
  ['Colt Detective Special (Snub)', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 30/60/120', 'mag 6', 'concealable', 'era: 1960s — FBI/CIA plainclothes', 'caliber: bullets-medium']],
  ['Browning Hi-Power', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 1', 'mag 13', 'era: 1960s — CIA field issue', 'caliber: bullets-medium']],
  ['High Standard HDM (Suppressed .22)', 'Ranged', '2d4!', 'kinetic', 'ranged', ['range 30/60/120', 'mag 10', 'suppressed — nearly silent (Notice −4 to hear the shot)', 'era: 1960s — CIA covert work', 'caliber: bullets-small']],
  ['M1 Carbine', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 15', 'era: 1960s — FBI armory long gun', 'caliber: bullets-medium']],
  ['Thompson M1928 SMG', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 1', 'mag 30', 'RoF 3', 'era: 1960s — FBI armory, senior agents only', 'caliber: bullets-medium']],
  ['Lipstick Pistol (Single Shot)', 'Ranged', '2d4!', 'kinetic', 'ranged', ['range 6/12/24', 'mag 1', 'concealable anywhere, passes any search', 'era: 1960s — CIA gadget', 'caliber: bullets-small']],
  ['Blackjack (Sap)', 'Melee', '1d4!', 'bludgeoning', 'str', ['nonlethal', 'Vigor roll or Stunned', 'concealable', 'era: 1960s — FBI/CIA close work']],
  // No damage at all — the whole attack IS the rider. 'max range' keeps it at
  // arm's length rather than letting the band ladder spray it four tiles.
  // Personal defence: no damage at all, the whole attack IS the Stun rider.
  // The spray has a hard 10ft reach and no range penalty ('max range'); the
  // stun gun is a real 1/2/4″ banded shot.
  ['Pepper Spray', 'Ranged', '0', 'poison', 'ranged', ['range 10', 'max range', 'nonlethal', 'Vigor roll or Stunned', 'mag 5', 'concealable'], 15, 0.5],
  ['Stun Gun', 'Ranged', '0', 'energy', 'ranged', ['range 6', 'nonlethal', 'Vigor roll or Stunned', 'mag 3', 'recharges for two hours once spent'], 25, 0.5],

  // ---------------------------------------------------------------------
  // Core weapon tables. Ranges are the table's inches × 5, so one tabletop
  // inch is one tile on a standard 5-ft hex — a 12" bow reaches 12 tiles.
  // Minimum Strength rides in the props: it is real table data, but nothing
  // in the engine reads it yet, so it is stated rather than half-wired.
  // ---------------------------------------------------------------------
  // ---- Melee: medieval ----
  ['Axe, Great', 'Melee', '1d10!', 'slashing', 'str', ['AP 2', 'Parry −1', 'two-handed', 'min Str d10'], 400, 7],
  ['Club, Heavy', 'Melee', '1d6!', 'bludgeoning', 'str', ['a sign of low status or thuggery', 'min Str d6'], 50, 5],
  ['Mace', 'Melee', '1d6!', 'bludgeoning', 'str', ['min Str d6'], 100, 4],
  // ---- Melee: modern ----
  ['Bangstick', 'Melee', '3d6!', 'kinetic', 'none', ['a shotgun shell on a stick', 'one action to reload a fresh shell', 'min Str d6'], 5, 2],
  ['Billy Club/Baton', 'Melee', '1d4!', 'bludgeoning', 'str', ['often carried by law enforcement', 'min Str d4'], 10, 1],
  ['Switchblade', 'Melee', '1d4!', 'piercing', 'str', ['−2 to be Noticed if hidden', 'min Str d4'], 10, 0.5],
  // ---- Melee: futuristic ----
  ['Molecular Knife', 'Melee', '1d4!+2', 'slashing', 'str', ['AP 2', 'cannot be thrown', 'min Str d4'], 250, 0.5],
  ['Laser Sword', 'Melee', '1d6!+8', 'energy', 'str', ['AP 12', 'min Str d4'], 1000, 2],
  // ---- Ranged: medieval ----
  ['Axe, Throwing', 'Ranged', '1d6!', 'slashing', 'ranged', ['range 15/30/60', 'add Str die to damage', 'thrown', 'min Str d6'], 100, 3],
  ['Net (Weighted)', 'Ranged', '0', '', 'ranged', ['range 15/30/60', 'thrown', 'a hit Entangles', 'Hardness 10, cut free only', 'min Str d6'], 50, 8],
  ['Spear/Javelin', 'Ranged', '1d6!', 'piercing', 'ranged', ['range 15/30/60', 'add Str die to damage', 'thrown', 'min Str d6'], 100, 3],
  // ---- Ranged: modern ----
  ['Compound Bow', 'Ranged', '1d6!', 'piercing', 'ranged', ['range 60/120/240', 'add Str die to damage', 'AP 1', 'min Str d6', 'caliber: arrows'], 200, 3],
  ['Crossbow (Modern)', 'Ranged', '2d6!', 'piercing', 'ranged', ['range 60/120/240', 'AP 2', 'min Str d6', 'caliber: bolts'], 300, 7],
  // ---- Black powder (Reload 3 unless noted) ----
  ['Kentucky Rifle', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'the tight rifling makes it Reload 4', 'min Str d6', 'caliber: shot'], 300, 8],
  ['Springfield Model 1861', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'Reload 3', 'min Str d6', 'caliber: shot'], 250, 11],
  // ---- Pistols: revolvers ----
  ['Derringer (.41)', 'Ranged', '2d4!', 'kinetic', 'ranged', ['range 15/30/60', 'mag 2', '−2 to be Noticed if hidden', 'min Str d4', 'caliber: bullets-small'], 100, 1],
  ['Police Revolver (.38)', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 50/100/200', 'mag 6', 'min Str d4', 'caliber: bullets-medium'], 150, 2],
  ['Colt Peacemaker (.45)', 'Ranged', '2d6!+1', 'kinetic', 'ranged', ['range 60/120/240', 'AP 1', 'mag 6', 'min Str d4', 'caliber: bullets-medium'], 200, 4],
  ['Smith & Wesson (.357)', 'Ranged', '2d6!+1', 'kinetic', 'ranged', ['range 60/120/240', 'AP 1', 'mag 6', 'min Str d4', 'caliber: bullets-medium'], 250, 5],
  // ---- Pistols: semi-automatics ----
  ['Colt 1911 (.45)', 'Ranged', '2d6!+1', 'kinetic', 'ranged', ['range 60/120/240', 'AP 1', 'mag 7', 'min Str d4', 'caliber: bullets-medium'], 200, 4],
  ['Desert Eagle (.50)', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'mag 7', 'min Str d6', 'caliber: bullets-large'], 300, 8],
  ['Glock (9mm)', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 1', 'mag 17', 'min Str d4', 'caliber: bullets-medium'], 200, 3],
  ['Ruger (.22)', 'Ranged', '2d4!', 'kinetic', 'ranged', ['range 50/100/200', 'mag 9', 'min Str d4', 'caliber: bullets-small'], 100, 2],
  // ---- Submachine guns ----
  ['H&K MP5 (9mm)', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 1', 'RoF 3', 'mag 30', 'min Str d6', 'caliber: bullets-medium'], 300, 10],
  ['Tommy Gun (.45)', 'Ranged', '2d6!+1', 'kinetic', 'ranged', ['range 60/120/240', 'AP 1', 'RoF 3', 'mag 20', 'a 50-round drum adds 2 lbs and costs $50 loaded', 'min Str d6', 'caliber: bullets-medium'], 350, 13],
  ['Uzi (9mm)', 'Ranged', '2d6!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 1', 'RoF 3', 'mag 32', 'min Str d4', 'caliber: bullets-medium'], 300, 9],
  // ---- Shotguns ----
  ['Sawed-Off Double-Barrel', 'Ranged', '1-3d6!', 'kinetic', 'ranged', ['range 25/50/100', 'mag 2', 'min Str d4', 'caliber: shells'], 150, 6],
  ['Streetsweeper', 'Ranged', '1-3d6!', 'kinetic', 'ranged', ['range 60/120/240', 'mag 12', 'min Str d6', 'caliber: shells'], 450, 10],
  // ---- Rifles: lever- and bolt-action ----
  ['Barrett (.50)', 'Ranged', '2d10!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 4', 'mag 10', 'Heavy Weapon', 'snapfire', 'the 10-shot magazine weighs 2 lbs; almost always scoped', 'min Str d8', 'caliber: bullets-large'], 750, 35],
  ['M1 Garand (.30-06)', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'mag 8', 'the standard US infantry rifle of the Second World War', 'min Str d6', 'caliber: bullets-medium'], 300, 10],
  ['Hunting Rifle (.308)', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'mag 5', 'snapfire', 'min Str d6', 'caliber: bullets-medium'], 350, 8],
  ['Sharps Big 50 (.50)', 'Ranged', '2d10!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'mag 1', 'snapfire', 'min Str d8', 'caliber: bullets-large'], 400, 11],
  ['Spencer Carbine (.52)', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'mag 7', 'min Str d6', 'caliber: bullets-medium'], 250, 8],
  ["Winchester '73 (.44-40)", 'Ranged', '2d8!-1', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'mag 15', 'min Str d6', 'caliber: bullets-medium'], 300, 10],
  // ---- Assault rifles ----
  ['AK47 (7.62mm)', 'Ranged', '2d8!+1', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'RoF 3', 'mag 30', 'min Str d6', 'caliber: bullets-medium'], 450, 10],
  ['M-16 (5.56mm)', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'RoF 3', 'mag 30', 'the A-2 can fire a three-round burst', 'min Str d6', 'caliber: bullets-medium'], 400, 8],
  ['Steyr AUG (5.56mm)', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'RoF 3', 'mag 30', 'may fire a three-round burst', 'min Str d6', 'caliber: bullets-medium'], 400, 8],
  // ---- Machine guns (Reload 2; minimum RoF 2 unless noted) ----
  ['Browning Automatic Rifle (BAR)', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'RoF 3', 'mag 20', 'RoF 1 to 3; magazine-fed, one action to reload', 'min Str d8', 'caliber: bullets-medium'], 300, 17],
  ['Gatling (.45)', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'RoF 3', 'mag 100', 'weapon mount — no minimum Strength, no Recoil', 'caliber: bullets-medium'], 500, 170],
  ['Minigun (7.62mm)', 'Ranged', '2d8!+1', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'RoF 5', 'mag 4000', 'minimum RoF 3', 'needs a backpack harness; the ammo adds 85 lbs full', 'min Str d10', 'caliber: bullets-medium'], 100000, 85],
  ['M2 Browning (.50 Cal)', 'Ranged', '2d10!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 4', 'RoF 3', 'mag 200', 'Heavy Weapon', 'weapon mount — no minimum Strength, no Recoil', 'caliber: bullets-large'], 1500, 84],
  ['M60 (7.62mm)', 'Ranged', '2d8!+1', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'RoF 3', 'mag 100', 'min Str d8', 'caliber: bullets-medium'], 6000, 33],
  ['MG42 (7.92mm)', 'Ranged', '2d8!+1', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'RoF 4', 'mag 200', 'min Str d10', 'caliber: bullets-medium'], 750, 26],
  ['SAW (5.56mm)', 'Ranged', '2d8!', 'kinetic', 'ranged', ['range 60/120/240', 'AP 2', 'RoF 4', 'mag 200', 'min Str d8', 'caliber: bullets-medium'], 4000, 20],
  // ---- Lasers (futuristic). Pistols, SMGs and rifles ignore Recoil. ----
  ['Laser SMG', 'Ranged', '2d6!', 'energy', 'ranged', ['range 60/120/240', 'AP 2', 'RoF 4', 'mag 200', 'no Recoil', 'min Str d4', 'caliber: battery-rifle'], 500, 4],
  ['Gatling Laser', 'Ranged', '3d6!+4', 'energy', 'ranged', ['range 60/120/240', 'AP 2', 'RoF 4', 'mag 800', 'takes the Recoil penalty — usually tripod-mounted', 'min Str d8', 'caliber: battery-gatling'], 1000, 20],
];

// [name, category, bonus, rangedArmor, notes, cost?, weight?]
// Category 'Shield' means the bonus is Parry rather than Armor. `rangedArmor`
// is the soak applied only to ranged hits — it carries both the armor tables'
// ballistic asterisk ("reduces damage from bullets by 4") and the armor a
// shield gives someone shooting through it.
//
// The tables repeat names across their sections (a Jacket, Leggings and a Cap
// appear under two different materials; Vambraces and Greaves under two), so
// entries are prefixed by material — an id is system+kind+name, and two rows
// sharing one would shadow each other.
//
// Minimum Strength and a shield's Cover penalty ride in the notes: they are
// real table data but nothing in the engine reads them yet, and inventing
// half-wired columns for them would be worse than saying so plainly.
type A = [string, string, number, number, string, number?, number?];
const ARMOR: A[] = [
  // ---- Medieval & ancient: cloth / light leather ----
  ['Cloth Jacket', 'Armor', 1, 0, 'Torso and arms · Min Str d4', 20, 5],
  ['Cloth Robes', 'Armor', 1, 0, 'Torso, arms and legs · Min Str d4', 30, 8],
  ['Cloth Leggings', 'Armor', 1, 0, 'Legs · Min Str d4', 20, 5],
  ['Cloth Cap', 'Armor', 1, 0, 'Head · Min Str d4', 5, 1],
  // ---- Thick leather / tough hides ----
  ['Hardened Leather Jacket', 'Armor', 2, 0, 'Boiled leather; torso and arms · Min Str d6', 80, 8],
  ['Hardened Leather Leggings', 'Armor', 2, 0, 'Boiled leather; legs · Min Str d6', 40, 7],
  ['Hardened Leather Cap', 'Armor', 2, 0, 'Boiled leather; head · Min Str d6', 20, 1],
  // ---- Chain mail (chain, splint, scale, ring, samurai) ----
  ['Chain Mail', 'Armor', 3, 0, 'Chain shirt; torso and arms · Min Str d8', 300, 25],
  ['Chain Leggings', 'Armor', 3, 0, 'Legs · Min Str d8', 150, 10],
  ['Chain Hood', 'Armor', 3, 0, 'Head · Min Str d8', 25, 4],
  // ---- Bronze (pre-iron-age settings) ----
  ['Bronze Barding', 'Armor', 3, 0, 'Horse barding · Min Str d10', 1500, 50],
  ['Bronze Corselet', 'Armor', 3, 0, 'Torso · Min Str d8', 80, 13],
  ['Bronze Vambraces', 'Armor', 3, 0, 'Arms · Min Str d8. Halve cost and weight for half the pair.', 40, 5],
  ['Bronze Greaves', 'Armor', 3, 0, 'Legs · Min Str d8. Halve cost and weight for half the pair.', 50, 6],
  ['Bronze Helmet', 'Armor', 3, 0, 'Head · Min Str d8', 25, 6],
  // ---- Plate mail ----
  ['Plate Barding', 'Armor', 4, 0, 'Horse barding · Min Str d10', 1500, 50],
  ['Plate Corselet', 'Armor', 4, 0, 'Torso · Min Str d10', 500, 30],
  ['Plate Vambraces', 'Armor', 4, 0, 'Arms · Min Str d10. Halve cost and weight for half the pair.', 200, 10],
  ['Plate Greaves', 'Armor', 4, 0, 'Legs · Min Str d10. Halve cost and weight for half the pair.', 200, 10],
  ['Helm, Pot', 'Armor', 4, 0, 'Head · Min Str d10', 100, 4],
  ['Helm, Enclosed', 'Armor', 4, 0, 'Head, full face · Min Str d10', 200, 8],
  // ---- Modern: cloth / leather ----
  ['Leather Jacket', 'Armor', 1, 0, 'Thick coat or leather jacket; torso and arms · Min Str d4', 100, 5],
  ['Leather Riding Chaps', 'Armor', 1, 0, 'Legs · Min Str d4', 70, 5],
  ['Kevlar Riding Jacket', 'Armor', 2, 0, 'Torso and arms · Min Str d4', 350, 8],
  ['Kevlar Riding Jeans', 'Armor', 2, 0, 'Legs · Min Str d4', 175, 4],
  ['Bike Helmet', 'Armor', 2, 0, 'Head · Min Str d4', 50, 1],
  ['Motorcycle Helmet', 'Armor', 3, 0, 'Head · Min Str d4', 100, 3],
  // ---- Modern: body armor. The starred rows soak 4 off bullets. ----
  ['Flak Jacket', 'Armor', 2, 0, 'Vietnam-era fragmentation vest; torso · Min Str d6', 40, 10],
  ['Kevlar Vest', 'Armor', 2, 4, 'Torso · Min Str d6. Ballistic: soaks 4 from bullets.', 200, 5],
  ['Kevlar Vest w/ Inserts', 'Armor', 4, 4, 'Ceramic inserts; torso · Min Str d8. Ballistic: soaks 4 from bullets.', 500, 17],
  ['Kevlar Helmet', 'Armor', 4, 4, 'Head · Min Str d4. Ballistic: soaks 4 from bullets.', 80, 5],
  ['Bombproof Suit', 'Armor', 10, 0, 'Entire body · Min Str d12. Only the hands are dexterous: Agility and skills needing more than hand-work cap at d6, and Pace drops 2 on top of any Min Str penalty.', 25000, 25],
  // ---- Futuristic ----
  ['Body Armor', 'Armor', 4, 4, 'Light armored clothing of complex polymers; torso, arms and legs · Min Str d4. Ballistic: soaks 4 from bullets.', 200, 4],
  ['Infantry Battle Suit', 'Armor', 6, 4, 'Full suit with boots and gloves; torso, arms and legs · Min Str d6. Ballistic: soaks 4 from bullets.', 800, 12],
  ['Battle Helmet', 'Armor', 6, 4, 'Head, full face · Min Str d6. Ballistic: soaks 4 from bullets.', 100, 2],
  // ---- Shields. Medieval and modern give +2 to anyone shooting through
  //      them; polymer gives +4. Cover is the penalty an attacker takes. ----
  ['Small Shield', 'Shield', 1, 2, '+1 Parry · no Cover · Min Str d4', 50, 4],
  ['Medium Shield', 'Shield', 2, 2, '+2 Parry · Cover −2 · Min Str d6', 100, 8],
  ['Large Shield', 'Shield', 3, 2, '+3 Parry · Cover −4 · Min Str d8', 200, 12],
  ['Riot Shield', 'Shield', 3, 2, '+3 Parry · Cover −4 · Min Str d4', 80, 5],
  ['Ballistic Shield', 'Shield', 3, 4, '+3 Parry · Cover −4 · Min Str d6. Soaks 4 from firearms shot through it.', 250, 9],
  ['Polymer Shield, Small', 'Shield', 1, 4, '+1 Parry · no Cover · Min Str d4', 200, 2],
  ['Polymer Shield, Medium', 'Shield', 2, 4, '+2 Parry · Cover −2 · Min Str d4', 300, 4],
  ['Polymer Shield, Large', 'Shield', 3, 4, '+3 Parry · Cover −4 · Min Str d6', 400, 6],
  // ---- Not from the core tables: kept for settings that want them. ----
  ['Leather Armor', 'Armor', 2, 0, 'Covers torso/arms/legs'],
  ['Hide Armor', 'Armor', 2, 0, 'Layered animal hide'],
  ['Scale Armor', 'Armor', 3, 0, 'Overlapping metal scales'],
  ['Brigandine', 'Armor', 3, 0, 'Plates riveted inside a cloth coat'],
  ['Half Plate', 'Armor', 4, 0, 'Rigid plate over the torso and limbs'],
  ['Full Plate', 'Armor', 5, 0, 'Complete articulated harness; heavy'],
  ['Helmet (Leather)', 'Armor', 1, 0, 'Protects the head only'],
  ['Helmet (Steel)', 'Armor', 3, 0, 'Protects the head only'],
  ['Riot Gear', 'Armor', 3, 0, 'Full-body modern protective suit'],
  ['Body Armor (Military)', 'Armor', 4, 0, 'Plate carrier with ballistic inserts'],
  ['Powered Battle Armor', 'Armor', 10, 0, 'Sci-fi powered exoskeleton; sealed and strength-boosting'],
  ['Energy Shield', 'Shield', 2, 4, '+2 Parry, +4 Armor vs ranged energy'],
];

// [name, ppCost, rankReq, subtitle, mech?]
// mech carries the machine-usable bits: damage/heal, range, resistance trait,
// area template, inflicted condition. Powers without mech stay descriptive.
interface PowerMech {
  damage?: string;
  heal?: boolean;
  rangeFt?: number;
  save?: string;
  onSave?: 'half' | 'negate';
  aoe?: { shape: 'sphere' | 'cone' | 'line' | 'cube'; sizeFt?: number; sizeHexes?: number };
  condition?: string;
}
type P = [string, number, string, string, PowerMech?];
const POWERS: P[] = [
  ['Arcane Protection', 1, 'Novice', 'Foes suffer a penalty to affect you with powers'],
  ['Armor', 1, 'Novice', '+2 Armor for 5 rounds — toggle "Armor" on the sheet while maintained'],
  // Medium Blast Template ≈ 24 ft across; no dodging it by the book.
  ['Blast', 3, 'Seasoned', 'Medium blast template of damage', { damage: '2d6!', rangeFt: 144, aoe: { shape: 'sphere', sizeHexes: 3 } }],
  // Direct missile: arcane skill vs TN 4 to hit (raise = +1d6!).
  ['Bolt', 1, 'Novice', 'A missile of arcane energy', { damage: '2d6!', rangeFt: 144 }],
  ['Boost/Lower Trait', 2, 'Novice', 'Raise or lower a target trait one die type'],
  ['Burrow', 2, 'Novice', 'Meld into and move through earth'],
  // Cone Template ≈ 54 ft long; Evasion (Agility) avoids it entirely.
  ['Burst', 2, 'Novice', 'Cone template of damage', { damage: '2d6!', save: 'agility', onSave: 'negate', aoe: { shape: 'cone', sizeFt: 54 } }],
  ['Confusion', 1, 'Novice', 'Target must make a Smarts roll or be Distracted', { rangeFt: 72, save: 'smarts', onSave: 'negate', condition: 'distracted' }],
  ['Deflection', 3, 'Novice', 'Attacks against you suffer −2 — toggle "Deflection" on the sheet while maintained'],
  ['Detect/Conceal Arcana', 2, 'Novice', 'Sense or hide the supernatural'],
  ['Dispel', 1, 'Seasoned', 'Cancel an enemy power'],
  ['Empathy', 1, 'Novice', 'Read emotions; bonus to social rolls'],
  ['Entangle', 2, 'Novice', 'Target is Entangled (Bound with a raise)', { rangeFt: 72, save: 'agility', onSave: 'negate', condition: 'entangled' }],
  ['Environmental Protection', 2, 'Novice', 'Breathe/operate in a hostile environment'],
  ['Fear', 2, 'Novice', 'Target makes a Spirit roll or panics', { rangeFt: 72, save: 'spirit', onSave: 'negate', condition: 'frightened' }],
  ['Fly', 3, 'Veteran', 'Fly at Pace 12'],
  // Healing is resolved as a trait roll vs TN 4 (see combat.ts healsWounds):
  // a success mends one Wound, a raise two. The amount below is vestigial.
  ['Healing', 3, 'Novice', 'Heal a Wound (two with a raise) within the golden hour', { damage: '5', heal: true, rangeFt: 5 }],
  ['Illusion', 3, 'Novice', 'Create a visual illusion'],
  ['Invisibility', 5, 'Seasoned', 'Turn a willing target invisible (harder to hit or notice)', { heal: true, rangeFt: 5, condition: 'invisible' }],
  ['Light/Darkness', 1, 'Novice', 'Create or extinguish light'],
  ['Protection', 1, 'Novice', '+2 Toughness — toggle "Protection" on the sheet while maintained'],
  ['Puppet', 3, 'Veteran', 'Control a target’s actions (opposed by Spirit)'],
  ['Relief', 1, 'Novice', 'Remove Fatigue or Shaken'],
  ['Smite', 2, 'Novice', 'A weapon gains +2 damage — toggle "Smite" + mark the weapon wielded'],
  ['Speed', 2, 'Novice', 'Double a target’s Pace'],
  ['Stun', 2, 'Novice', 'Target makes a Vigor roll or is Stunned', { rangeFt: 72, save: 'vigor', onSave: 'negate', condition: 'stunned' }],
  ['Telekinesis', 5, 'Seasoned', 'Move objects or creatures with your mind'],
  ['Teleport', 2, 'Seasoned', 'Instantly move up to 12″ (double with a raise)'],
  // --- additional powers ---
  ['Banish', 5, 'Veteran', 'Send an extraplanar creature back where it came from', { rangeFt: 72, save: 'spirit', onSave: 'negate' }],
  ['Barrier', 2, 'Novice', 'Raise a wall of force, ice, or flame'],
  ['Beast Friend', 2, 'Novice', 'Command animals within earshot'],
  ['Blind', 2, 'Novice', 'Target rolls Agility or is Blinded', { rangeFt: 72, save: 'agility', onSave: 'negate', condition: 'blinded' }],
  ['Bolt (Greater)', 4, 'Veteran', 'A heavier missile of arcane force', { damage: '3d6!', rangeFt: 144 }],
  ['Damage Field', 4, 'Veteran', 'Anyone touching you takes damage', { damage: '2d4!', rangeFt: 5 }],
  ['Darksight', 1, 'Novice', 'See clearly in darkness'],
  ['Detect Life', 2, 'Novice', 'Sense living creatures nearby'],
  ['Disguise', 2, 'Novice', 'Change a target’s appearance'],
  ['Divination', 5, 'Veteran', 'Ask a higher power one pointed question'],
  ['Drain Power Points', 2, 'Veteran', 'Steal Power Points from a rival caster', { rangeFt: 72, save: 'spirit', onSave: 'negate' }],
  ['Elemental Manipulation', 1, 'Novice', 'Shape a small amount of air, earth, fire, or water'],
  ['Farsight', 2, 'Seasoned', 'See distant places as though present'],
  ['Growth/Shrink', 2, 'Novice', 'Change a target’s Size, Strength, and Toughness'],
  ['Havoc', 2, 'Novice', 'Fling everyone in a blast area 2d6″ and knock them Prone', { rangeFt: 144, save: 'strength', onSave: 'negate', aoe: { shape: 'sphere', sizeHexes: 3 }, condition: 'prone' }],
  ['Intangibility', 5, 'Veteran', 'Become insubstantial and pass through matter'],
  ['Mind Link', 1, 'Novice', 'Silent communication with willing allies'],
  ['Mind Reading', 2, 'Novice', 'Pull one honest answer from a subject’s thoughts', { rangeFt: 30, save: 'smarts', onSave: 'negate' }],
  ['Mind Wipe', 3, 'Seasoned', 'Erase or alter a subject’s recent memories', { rangeFt: 30, save: 'smarts', onSave: 'negate' }],
  ['Object Reading', 2, 'Novice', 'See the past events attached to an object'],
  ['Sanctuary', 2, 'Novice', 'Evil creatures must resist or cannot approach', { rangeFt: 5, save: 'spirit', onSave: 'negate' }],
  ['Shape Change', 3, 'Veteran', 'Take the form of a beast you know'],
  ['Silence', 2, 'Novice', 'Muffle all sound in an area'],
  ['Slow', 2, 'Novice', 'Halve a target’s Pace and actions', { rangeFt: 72, save: 'agility', onSave: 'negate', condition: 'distracted' }],
  ['Slumber', 2, 'Seasoned', 'Targets fall asleep unless they resist', { rangeFt: 72, save: 'spirit', onSave: 'negate', condition: 'unconscious' }],
  ['Sound/Silence', 1, 'Novice', 'Create or suppress noise at a distance'],
  ['Speak Language', 1, 'Novice', 'Understand and be understood in any tongue'],
  ['Summon Ally', 3, 'Novice', 'Call a servitor creature to fight for you'],
  ['Wall Walker', 2, 'Novice', 'Walk on walls and ceilings at full Pace'],
  ['Warrior’s Gift', 4, 'Veteran', 'Grant a target a combat Edge for the scene'],
  ['Zombie', 3, 'Veteran', 'Raise a corpse as an obedient servant'],
];

// Ammunition, per the SWADE gear table: [name, caliber, batch qty, subtitle].
// The caliber key matches the 'caliber: x' prop on the weapons it feeds, so
// the sheet can tell at a glance which rounds fit which gun.
// [name, caliber, batch qty, subtitle, cost, weight] — cost and weight are for
// the whole batch the row buys, since that is how the tables price ammunition
// (per 50 rounds, per 25 shells) rather than per round.
type Ammo = [string, string, number, string, number, number];
const AMMUNITION: Ammo[] = [
  ['Arrows (20)', 'arrows', 20, 'For bows of every era', 10, 4],
  ['Crossbow Bolts (20)', 'bolts', 20, 'For crossbows, arbalests, and repeaters', 10, 4],
  ['Bullets, Small (50)', 'bullets-small', 50, '.22 to .32 caliber', 10, 1],
  ['Bullets, Medium (50)', 'bullets-medium', 50, '9mm to .45 caliber', 20, 2],
  ['Bullets, Large (50)', 'bullets-large', 50, '.50 caliber and larger rounds', 30, 15],
  ['Laser Battery (Pistol)', 'battery-pistol', 24, 'One full magazine for a laser sidearm', 20, 0.25],
  ['Laser Battery (Rifle/SMG)', 'battery-rifle', 30, 'One full magazine for a laser long arm', 20, 0.5],
  ['Laser Battery (Gatling)', 'battery-gatling', 100, 'One full drum for a laser gatling', 50, 4],
  ['Shot & Powder (10)', 'shot', 10, 'For black powder weapons', 1, 0.5],
  ['Shotgun Shells (25)', 'shells', 25, 'Standard buckshot', 15, 1.5],
  ['Shotgun Slugs (25)', 'slugs', 25, 'Solid slugs — trade spread for reach', 20, 1.5],
  ['Sling Stones (20)', 'stones', 20, 'Smooth river stones', 2, 1],
];

// [name, subtitle, traitBonus?, mech?] — a trait bonus becomes a live "+N to
// trait" on the sheet once the item is marked equipped. `mech` carries the
// machine-usable bits for gear that becomes a real action: how far a healing
// item reaches, whether its range is a hard cap, whether only Wild Cards can
// be targeted, and how many charges it arrives with.
type GearMech = { healRangeFt?: number; wildCardOnly?: boolean; hardRange?: boolean; qty?: number };
// [name, subtitle, cost?, weight?, traitBonus?, mech?]
// Cost is the list price and weight is in pounds, both from the core gear
// tables. A weight of 0 is the tables' "—": pocket stuff that never troubles
// encumbrance. Entries with no cost/weight predate the tables being entered
// and fall back to the per-kind price and the weights.ts lookup.
type G = [string, string, number?, number?, { trait: string; amount: number }?, GearMech?];
const GEAR: G[] = [
  // ---- Animals & tack ----
  ['Horse', 'A riding horse; carries a rider and their kit', 300, 0],
  ['War Horse', 'Trained to stay steady in a fight', 750, 0],
  ['Saddle', 'Plain riding saddle and harness', 10, 10],
  ['Elaborate Saddle', 'Fine tack, worked leather and fittings', 50, 10],
  // ---- Adventuring gear ----
  ['Backpack', 'Standard load carrier', 50, 2],
  ['Bedroll', 'Sleeping bag, winterised', 25, 4],
  ['Blanket', 'Wool blanket', 10, 4],
  ['Camera (Disposable)', 'One roll, then throw it away', 10, 1],
  ['Camera (Regular)', 'Film camera with a changeable lens', 75, 2],
  ['Camera (Digital)', 'Digital stills and video', 300, 1],
  ['Candle', 'One hour of light, 2″ radius', 1, 1],
  ['Rope (10 yards)', 'Hemp climbing rope', 10, 15],
  ['Rope, Nylon (20 yards)', 'Lighter and stronger than hemp', 10, 3],
  ['Grappling Hook', 'Anchors a rope', 100, 2],
  ['Torch', '1 hour of light, 4″ radius', 5, 1],
  ['Flashlight', '10″ beam', 20, 3],
  ['Lantern', '4 hours of light, 4″ radius', 25, 3],
  ['Lighter', 'Pocket flame', 2, 0],
  ['Flint & Steel', 'Start fires', 3, 1],
  ['Canteen', 'A day of water', 5, 1],
  ['Flask (Ceramic)', 'Holds a pint of anything', 5, 1],
  ['Goggles', 'Keeps grit and glare out of your eyes', 20, 1],
  ['Hammer', 'Drives pitons, nails and stakes', 10, 1],
  ['Shovel', 'Digs in, or out', 5, 5],
  ['Soap', 'A bar of it', 1, 0.2],
  ['Umbrella', 'Keeps the weather off', 5, 2],
  ['Quiver', 'Holds 20 arrows or bolts', 25, 2],
  ['Rations (5 days)', 'Trail food; keeps about a week', 10, 5],
  ['First Aid Kit', 'Field dressing: +1 to Healing rolls while carried. Three uses. Treating a Wound is a Healing roll — a success mends one, a raise two, and either steadies the Shaken.', 10, 1, { trait: 'Healing', amount: 1 }],
  ['Lockpicks', '+1 to Thievery to open locks', 200, 1, { trait: 'Thievery', amount: 1 }],
  ['Crowbar', '+1 Strength to force things open', 10, 2, { trait: 'Strength', amount: 1 }],
  ['Binoculars', 'See distant detail'],
  ['Gas Mask', 'Protects against inhaled toxins'],
  ['Cell Phone', 'Modern communication'],
  ['Climbing Gear', '+2 to Athletics (climbing)', undefined, undefined, { trait: 'Athletics', amount: 2 }],
  ['Whetstone', 'Weapon maintenance', 1, 0],
  ['Healing Potion', 'Drink to treat a Wound: a Healing roll mends one on a success, two on a raise, and steadies the Shaken. Used up.'],
  // Flies the treatment to the patient: the Healing roll is made at range
  // rather than at arm's length. 40 tiles is a hard ceiling, not a Short band,
  // and only Wild Cards — the people who track Wounds — can be treated.
  ['Healing Drone', 'Single-use drone that carries a Healing roll to one Wild Card up to 40 tiles away. Treating a Wound is a Healing roll — a success mends one, a raise two, and either steadies the Shaken.',
    undefined, undefined, undefined, { healRangeFt: 200, wildCardOnly: true, hardRange: true, qty: 1 }],
  ['Antitoxin', 'Shrugs off one poison. Used up.'],
  ['Bandages', 'Basic field dressing; +1 Healing while equipped', undefined, undefined, { trait: 'Healing', amount: 1 }],
  ['Surgical Kit', 'Full medical instruments; +2 Healing while equipped', undefined, undefined, { trait: 'Healing', amount: 2 }],
  ['Camouflage Cloak', '+2 Stealth in matching terrain while worn', undefined, undefined, { trait: 'Stealth', amount: 2 }],
  ['Disguise Kit', '+2 Performance when impersonating someone', undefined, undefined, { trait: 'Performance', amount: 2 }],
  ['Forgery Kit', '+2 Thievery when faking documents', undefined, undefined, { trait: 'Thievery', amount: 2 }],
  ['Research Library', '+2 Research while you have access to it', undefined, undefined, { trait: 'Research', amount: 2 }],
  ['Toolkit', '+2 Repair while equipped', 200, 5, { trait: 'Repair', amount: 2 }],
  ['Electronics Kit', '+2 Hacking while equipped', undefined, undefined, { trait: 'Hacking', amount: 2 }],
  ['Musical Instrument', '+1 Performance while carried', undefined, undefined, { trait: 'Performance', amount: 1 }],
  ['Riding Tack', '+1 Riding with a properly fitted saddle', undefined, undefined, { trait: 'Riding', amount: 1 }],
  ['Survival Rations', 'A week of trail food'],
  ['Tent', 'Two-person shelter'],
  ['Waterskin', 'A day of water'],
  ['Chalk & Charcoal', 'Marking and sketching'],
  ['Spyglass', 'See distant detail'],
  ['Compass', 'Never lose your bearing; +1 Survival to navigate', undefined, undefined, { trait: 'Survival', amount: 1 }],
  ['Manacles', 'Handcuffs; restrain a captive', 15, 1],
  ['Caltrops', 'Scatter to slow pursuers'],
  ['Oil Flask', 'A pint of lantern oil, or a makeshift firebomb', 2, 1],
  ['Holy Symbol', 'Focus for Faith-based powers'],
  ['Spell Components', 'Material focus for arcane powers'],
  ['Signal Whistle', 'Carries far; coordinate in the field', 2, 0],
  ['Radio', 'Short-range team communication'],
  ['Night Vision Goggles', 'Ignore Dim and Dark lighting penalties. Twice the price buys "active" goggles that ignore every Illumination penalty.', 500, 1],
  ['Motion Detector', '+2 Notice for approaching movement', undefined, undefined, { trait: 'Notice', amount: 2 }],
  ['Medkit (Modern)', 'Trauma kit: +2 to Healing rolls while carried, and ignores 1 point of Wound penalties. Five uses; $25 to refill. Treating a Wound is a Healing roll — a success mends one, a raise two, and either steadies the Shaken.', 100, 4, { trait: 'Healing', amount: 2 }],
  ['Vacc Suit', 'Sealed suit for vacuum and hostile atmospheres'],
  ['Jetpack', 'Short bursts of powered flight'],
  ['Comm Unit', 'Personal communicator with encryption'],
  // ---- Clothing ----
  ['Boots, Hiking', 'Broken-in boots for long ground', 100, 2],
  ['Camouflage Fatigues', 'Field dress in a matching pattern', 20, 3],
  ['Clothing, Casual', 'Everyday wear', 20, 2],
  ['Clothing, Formal', 'Good enough for the embassy party', 200, 3],
  ['Winter Gear', 'Cloak or parka against the cold', 200, 3],
  ['Winter Boots', 'Insulated and waterproof', 100, 1],
  // ---- Computers & electronics ----
  ['Desktop Computer', 'A full workstation; not going anywhere', 800, 20],
  ['GPS', 'Tells you exactly where you are', 250, 1],
  ['Hand Held Computer', 'Pocket machine', 250, 1],
  ['Laptop', 'Portable workstation', 1200, 5],
  // ---- Firearms accessories ----
  ['Bipod/Tripod', 'An action to deploy; then negates Recoil and minimum Strength penalties', 100, 2],
  ['Laser/Red Dot Sight', '+1 Shooting at Short and Medium range', 150, 1, { trait: 'Shooting', amount: 1 }],
  ['Rifle Scope', 'Cancels 2 further points of penalty when Aiming', 100, 2],
  // ---- Food ----
  ['Fast Food Meal', 'Quick and forgettable', 8, 1],
  ['Good Meal', 'A restaurant sit-down; more if the place is fine', 15, 0],
  ['MRE (Meal Ready to Eat)', 'Military ration, one meal', 10, 1],
  // ---- Surveillance ----
  ['"Bug" (Micro Transmitter)', '12 hours of continuous transmission', 30, 0],
  ['Button Camera', '12 hours of continuous recording', 50, 0],
  ['Cellular Interceptor', 'Pulls mobile traffic out of the air', 650, 5],
  ["Lineman's Telephone", 'A Repair roll taps it into a phone line', 150, 2],
  ['Parabolic Microphone', 'Hear a whisper up to 200 yards off', 750, 4],
  ['Telephone Tap', 'Listens in on a wired line', 250, 0],
  ['Transmitter Detector', 'Sweeps a room for bugs', 525, 1],
];

// ---------- Edges ----------
// [name, category, requires, effect, mods?]
// `mods` carries the machine-usable part; everything else is a described
// Edge the table adjudicates. Effects are original short summaries.
interface TraitMods {
  bonusSkill?: string;
  bonusAmt?: number;
  parryBonus?: number;
  toughnessBonus?: number;
  paceBonus?: number;
}
type E = [string, string, string, string, TraitMods?];
const EDGES: E[] = [
  // Background
  ['Alertness', 'Background', 'Novice', '+2 to Notice rolls.', { bonusSkill: 'Notice', bonusAmt: 2 }],
  ['Ambidextrous', 'Background', 'Novice, Agility d8+', 'Ignore the off-hand penalty when acting with either hand.'],
  ['Arcane Background', 'Background', 'Novice', 'Grants access to powers and an arcane skill.'],
  ['Aristocrat', 'Background', 'Novice', '+2 to Persuasion with the highborn and to Common Knowledge about etiquette.', { bonusSkill: 'Persuasion', bonusAmt: 2 }],
  ['Attractive', 'Background', 'Novice, Vigor d6+', '+1 to Performance and Persuasion.', { bonusSkill: 'Persuasion', bonusAmt: 1 }],
  ['Very Attractive', 'Background', 'Novice, Attractive', '+2 to Performance and Persuasion.', { bonusSkill: 'Persuasion', bonusAmt: 2 }],
  ['Berserk', 'Background', 'Novice', 'After a Wound you may go berserk: +1 die to melee damage, −2 Parry.', { parryBonus: 0 }],
  ['Brave', 'Background', 'Novice, Spirit d6+', '+2 to resist Fear and −2 on Fear table results.', { bonusSkill: 'Spirit', bonusAmt: 2 }],
  ['Brawny', 'Background', 'Novice, Strength d6+, Vigor d6+', '+1 Toughness; treat Strength as a die higher for encumbrance.', { toughnessBonus: 1 }],
  ['Fast Healer', 'Background', 'Novice, Vigor d8+', '+2 to Vigor rolls for natural healing; check every three days.', { bonusSkill: 'Vigor', bonusAmt: 2 }],
  ['Fleet-Footed', 'Background', 'Novice, Agility d6+', '+2 Pace and a running die of d10.', { paceBonus: 2 }],
  ['Linguist', 'Background', 'Novice, Smarts d6+', 'Speak a number of extra languages equal to half your Smarts die.', { bonusSkill: 'Language', bonusAmt: 2 }],
  ['Luck', 'Background', 'Novice', 'Draw one extra Benny at the start of each session.'],
  ['Great Luck', 'Background', 'Novice, Luck', 'Draw two extra Bennies at the start of each session.'],
  ['Quick', 'Background', 'Novice, Agility d8+', 'Discard an Action Card of 5 or lower and draw again.'],
  ['Rich', 'Background', 'Novice', 'Three times the standard starting funds and a healthy annual income.'],
  ['Filthy Rich', 'Background', 'Novice, Rich', 'Five times the standard starting funds and a substantial income.'],
  ['Arcane Resistance', 'Background', 'Novice, Spirit d8+', '+2 to Trait rolls resisting magical effects; magical damage against you is reduced by 2.'],
  ['Improved Arcane Resistance', 'Background', 'Novice, Arcane Resistance', '+4 to Trait rolls resisting magical effects; magical damage against you is reduced by 4.'],
  ['Brute', 'Background', 'Novice, Strength d6+, Vigor d6+', 'Link Athletics to Strength instead of Agility; +1 hex to thrown Short Range, doubled Medium/Long.'],
  ['Elan', 'Background', 'Novice, Spirit d8+', '+2 when spending a Benny to reroll a Trait roll.'],
  ['Fame', 'Background', 'Novice', '+1 Persuasion when recognized; double the usual fee for Performance.'],
  ['Famous', 'Background', 'Seasoned, Fame', '+2 Persuasion when recognized; five times the usual fee for Performance.'],
  // Combat
  ['Block', 'Combat', 'Seasoned, Fighting d8+', '+1 Parry and ignore 1 point of Gang Up bonus.', { parryBonus: 1 }],
  ['Improved Block', 'Combat', 'Veteran, Block', '+2 Parry and ignore 2 points of Gang Up bonus.', { parryBonus: 2 }],
  ['Brawler', 'Combat', 'Novice, Strength d8+, Vigor d8+', '+1 Toughness and a bigger unarmed damage die.', { toughnessBonus: 1 }],
  ['Bruiser', 'Combat', 'Seasoned, Brawler', '+1 Toughness again and another step of unarmed damage.', { toughnessBonus: 1 }],
  ['Combat Reflexes', 'Combat', 'Seasoned', '+2 to Spirit rolls made to recover from being Shaken or Stunned.', { bonusSkill: 'Spirit', bonusAmt: 2 }],
  ['Counterattack', 'Combat', 'Seasoned, Fighting d8+', 'Once per round, a free attack against a foe who misses you in melee.'],
  ['Dodge', 'Combat', 'Seasoned, Agility d8+', 'Ranged attacks against you suffer −2.'],
  ['Extraction', 'Combat', 'Novice, Agility d8+', 'Ignore one foe’s free attack when you withdraw from melee.'],
  ['First Strike', 'Combat', 'Novice, Agility d8+', 'Once per round, a free attack when a foe moves adjacent to you.'],
  ['Frenzy', 'Combat', 'Seasoned, Fighting d8+', 'Roll an extra Fighting die on one melee attack per turn.'],
  ['Hard to Kill', 'Combat', 'Novice, Spirit d8+', 'Ignore Wound penalties on Vigor rolls made to avoid Bleeding Out.'],
  ['Level Headed', 'Combat', 'Seasoned, Smarts d8+', 'Draw an extra Action Card each round and keep the better.'],
  ['Marksman', 'Combat', 'Seasoned', 'Take the Aim manoeuvre as a free action if you don’t move.'],
  ['Nerves of Steel', 'Combat', 'Novice, Vigor d8+', 'Ignore one point of Wound penalties.'],
  ['Rock and Roll', 'Combat', 'Seasoned, Shooting d8+', 'Ignore the recoil penalty when firing fully automatic if you don’t move.'],
  ['Steady Hands', 'Combat', 'Novice, Agility d8+', 'Ignore the Unstable Platform penalty; reduce running penalties.'],
  ['Sweep', 'Combat', 'Novice, Strength d8+, Fighting d8+', 'Attack all adjacent foes at −2.'],
  ['Trademark Weapon', 'Combat', 'Novice, Fighting or Shooting d8+', '+1 to attack rolls with one specific weapon; +1 Parry while it is readied.', { bonusSkill: 'Fighting', bonusAmt: 1 }],
  ['Improved Trademark Weapon', 'Combat', 'Seasoned, Trademark Weapon', '+2 to attack rolls with the trademark weapon; +2 Parry while it is readied.', { bonusSkill: 'Fighting', bonusAmt: 1 }],
  ['Two-Fisted', 'Combat', 'Novice, Agility d8+', 'Attack with a weapon in each hand without the multi-action penalty.'],
  ['Two-Gun Kid', 'Combat', 'Novice, Agility d8+', 'One extra Shooting (or thrown Athletics) roll with a second ranged weapon in the off hand at no Multi-Action penalty.'],
  ['Calculating', 'Combat', 'Novice, Smarts d8+', 'Ignore up to 2 points of penalties on one action per turn when your Action Card is a Five or lower.'],
  ['Improved Counterattack', 'Combat', 'Veteran, Counterattack', 'Free attacks against up to three foes per turn who fail a Fighting roll against you.'],
  ['Dead Shot', 'Combat', 'Wild Card, Novice, Athletics or Shooting d8+', 'Once per turn, double damage from a thrown or Shooting attack when dealt a Joker.'],
  ['Improved Dodge', 'Combat', 'Seasoned, Dodge', '+2 to Evasion totals.'],
  ['Double Tap', 'Combat', 'Seasoned, Shooting d6+', '+1 to hit and damage when firing no more than RoF 1 per action.'],
  ['Improved Extraction', 'Combat', 'Seasoned, Extraction', 'Up to three adjacent foes lose their free attack when you withdraw from close combat.'],
  ['Feint', 'Combat', 'Novice, Fighting d8+', 'On a Fighting Test, you may make the foe resist with Smarts instead of Agility.'],
  ['Improved First Strike', 'Combat', 'Heroic, First Strike', 'Free Fighting attack against up to three foes per turn who move within Reach.'],
  ['Free Runner', 'Combat', 'Novice, Agility d8+', 'Ignore Difficult Ground; +2 to Athletics in foot chases.'],
  ['Improved Frenzy', 'Combat', 'Veteran, Frenzy', 'Roll an extra Fighting die on up to two melee attacks per turn.'],
  ['Giant Killer', 'Combat', 'Veteran', '+1d6 damage against creatures three or more Sizes larger than you.'],
  ['Harder to Kill', 'Combat', 'Veteran, Hard to Kill', 'Roll a die if you would perish — on an even result you survive somehow.'],
  ['Improvisational Fighter', 'Combat', 'Seasoned, Smarts d6+', 'Ignore the −2 penalty for attacking with improvised weapons.'],
  ['Iron Jaw', 'Combat', 'Novice, Vigor d8+', '+2 to Soak rolls and to Vigor rolls to avoid Knockout Blows.'],
  ['Killer Instinct', 'Combat', 'Seasoned', 'A free reroll in any opposed Test you initiate.'],
  ['Improved Level Headed', 'Combat', 'Seasoned, Level Headed', 'Draw two additional Action Cards each round and choose which to use.'],
  ['Martial Artist', 'Combat', 'Novice, Fighting d6+', 'Unarmed Fighting +1; fists and feet count as Natural Weapons and add d4 damage (or a die step if they already have one).', { bonusSkill: 'Fighting', bonusAmt: 1 }],
  ['Martial Warrior', 'Combat', 'Seasoned, Martial Artist', 'Unarmed Fighting +2; unarmed damage die increases a step.', { bonusSkill: 'Fighting', bonusAmt: 1 }],
  ['Mighty Blow', 'Combat', 'Wild Card, Novice, Fighting d8+', 'Once per turn, double Fighting damage when dealt a Joker.'],
  ['Improved Nerves of Steel', 'Combat', 'Novice, Nerves of Steel', 'Ignore up to two points of Wound penalties.'],
  ['No Mercy', 'Combat', 'Seasoned', '+2 damage when spending a Benny to reroll damage.'],
  ['Rapid Fire', 'Combat', 'Seasoned, Shooting d6+', 'Increase RoF by 1 for one Shooting attack per turn.'],
  ['Improved Rapid Fire', 'Combat', 'Veteran, Rapid Fire', 'Increase RoF by 1 for up to two Shooting attacks per turn.'],
  ['Improved Sweep', 'Combat', 'Veteran, Sweep', 'Attack all foes in Reach without the −2 penalty.'],
  // Professional
  ['Acrobat', 'Professional', 'Novice, Agility d8+, Athletics d8+', '+1 to Athletics rolls for acrobatics and +1 Parry.', { parryBonus: 1 }],
  ['Assassin', 'Professional', 'Novice, Agility d8+, Fighting d6+, Stealth d8+', '+2 damage against Vulnerable foes or those unaware of you.'],
  ['Investigator', 'Professional', 'Novice, Smarts d8+, Research d8+', '+2 to Research and to Notice rolls sifting through evidence.', { bonusSkill: 'Research', bonusAmt: 2 }],
  ['Scholar', 'Professional', 'Novice, chosen skill d8+', '+2 to one Academics, Battle, Occult, or Science skill.', { bonusSkill: 'Academics', bonusAmt: 2 }],
  ['Soldier', 'Professional', 'Novice, Strength d6+, Vigor d6+', 'Treat Strength as a die higher for encumbrance; +2 vs environmental hazards.', { bonusSkill: 'Vigor', bonusAmt: 2 }],
  ['Thief', 'Professional', 'Novice, Agility d8+, Stealth d6+, Thievery d6+', '+1 to Thievery, Athletics for climbing, and urban Stealth.', { bonusSkill: 'Thievery', bonusAmt: 1 }],
  ['Woodsman', 'Professional', 'Novice, Spirit d6+, Survival d6+', '+2 to Survival and to Stealth in the wilds.', { bonusSkill: 'Survival', bonusAmt: 2 }],
  ['Healer', 'Professional', 'Novice, Spirit d8+', '+2 to Healing rolls.', { bonusSkill: 'Healing', bonusAmt: 2 }],
  ['Ace', 'Professional', 'Novice, Agility d8+', 'Spend Bennies to Soak damage for your vehicle, and ignore up to 2 points of vehicle-handling penalties.'],
  ['Combat Acrobat', 'Professional', 'Seasoned, Acrobat', 'Ranged and melee attacks against you suffer −1.'],
  ['Jack-of-all-Trades', 'Professional', 'Novice, Smarts d10+', 'With a Smarts roll, gain d4 in a skill (d6 with a raise) until replaced.'],
  ['McGyver', 'Professional', 'Novice, Smarts d6+, Repair d6+, Notice d8+', 'Quickly improvise devices from scraps.'],
  ['Mr. Fix It', 'Professional', 'Novice, Repair d8+', '+2 to Repair rolls; a raise halves the time required.', { bonusSkill: 'Repair', bonusAmt: 2 }],
  // Social & Leadership
  ['Charismatic', 'Social', 'Novice, Spirit d8+', '+2 to Persuasion rolls.', { bonusSkill: 'Persuasion', bonusAmt: 2 }],
  ['Command', 'Leadership', 'Novice, Smarts d6+', 'Allies within earshot get +1 to recover from being Shaken.'],
  ['Fervor', 'Leadership', 'Veteran, Spirit d8+, Command', 'Allies within earshot get +1 to melee damage.'],
  ['Hold the Line!', 'Leadership', 'Seasoned, Smarts d8+, Command', 'Allies within earshot get +1 Toughness.'],
  ['Inspire', 'Leadership', 'Seasoned, Command', 'Once per turn, roll Battle to Support one type of Trait roll for everyone in Command Range.'],
  ['Command Presence', 'Leadership', 'Seasoned, Command', 'Command Range increases to 10 hexes (20 yards).'],
  ['Natural Leader', 'Leadership', 'Seasoned, Spirit d8+, Command', 'Your Leadership Edges also apply to Wild Cards.'],
  ['Tactician', 'Leadership', 'Seasoned, Smarts d8+, Command, Battle d6+', 'Draw an extra Action Card each turn to assign to any allied Extra in Command Range.'],
  ['Master Tactician', 'Leadership', 'Veteran, Tactician', 'Draw and distribute two extra Action Cards instead of one.'],
  ['Common Bond', 'Social', 'Novice, Spirit d8+', 'Freely give your Bennies to allies you can communicate with.'],
  ['Connections', 'Social', 'Novice', 'Call on a powerful contact for aid once per session.'],
  ['Strong Willed', 'Social', 'Novice, Spirit d8+', '+2 to resist Smarts- or Spirit-based Tests.', { bonusSkill: 'Spirit', bonusAmt: 2 }],
  ['Iron Will', 'Social', 'Veteran, Strong Willed', '+2 more to resist Smarts- or Spirit-based Tests (with Strong Willed, +4 total).', { bonusSkill: 'Spirit', bonusAmt: 2 }],
  ['Bolster', 'Social', 'Novice, Spirit d8+', 'A successful Test also removes an ally’s Distracted or Vulnerable state.'],
  ['Humiliate', 'Social', 'Novice, Taunt d8+', 'Free reroll when making Taunt rolls.'],
  ['Menacing', 'Social', 'Novice, see text', '+2 to Intimidation.', { bonusSkill: 'Intimidation', bonusAmt: 2 }],
  ['Provoke', 'Social', 'Novice, Taunt d6+', 'A raise on a Taunt Test provokes the foe into focusing on you — see text.'],
  ['Rabble-Rouser', 'Social', 'Seasoned, Spirit d8+', 'Once per turn, Test every foe in a Medium Blast Template with one Intimidation or Taunt roll.'],
  ['Reliable', 'Social', 'Novice, Spirit d8+', 'Free reroll when making Support rolls.'],
  ['Retort', 'Social', 'Novice, Taunt d6+', 'A raise when resisting a Taunt or Intimidation attack makes the attacker Distracted.'],
  ['Streetwise', 'Social', 'Novice, Smarts d6+', '+2 to Common Knowledge and criminal networking.', { bonusSkill: 'Common Knowledge', bonusAmt: 2 }],
  ['Work the Room', 'Social', 'Novice, Spirit d8+', 'Once per turn, roll a second die when Supporting via Performance or Persuasion and apply the result to an additional ally.'],
  ['Work the Crowd', 'Social', 'Seasoned, Work the Room', 'As Work the Room, but up to twice per turn.'],
  // Power
  ['New Powers', 'Power', 'Novice, Arcane Background', 'Learn two new powers.'],
  ['Power Points', 'Power', 'Novice, Arcane Background', 'Gain 5 additional Power Points.'],
  ['Rapid Recharge', 'Power', 'Seasoned, Spirit d6+, Arcane Background', 'Recover 10 Power Points per hour instead of 5.'],
  ['Soul Drain', 'Power', 'Seasoned, Arcane skill d10+', 'Trade a level of Fatigue for 5 Power Points.'],
  ['Wizard', 'Power', 'Seasoned, Arcane Background (Magic)', 'Spend an extra Power Point to change a power’s trapping.'],
  ['Artificer', 'Power', 'Seasoned, Arcane Background', 'You may create Arcane Devices.'],
  ['Channeling', 'Power', 'Seasoned, Arcane Background', 'Reduce a power’s cost by 1 Power Point with a raise on the activation roll.'],
  ['Concentration', 'Power', 'Seasoned, Arcane Background', 'Shaken results don’t cause Disruption of maintained powers (only Stun or Wounds do).'],
  ['Extra Effort', 'Power', 'Seasoned, Arcane Background (Gifted), Focus d6+', 'Increase a Focus roll by +1 for 1 Power Point or +2 for 3.'],
  ['Gadgeteer', 'Power', 'Seasoned, Arcane Background (Weird Science), Weird Science d6+', 'Spend 3 Power Points to jury-rig a device that replicates another power.'],
  ['Holy/Unholy Warrior', 'Power', 'Seasoned, Arcane Background (Miracles), Faith d6+', 'Add +1 to +4 to Soak rolls for each Power Point spent.'],
  ['Mentalist', 'Power', 'Seasoned, Arcane Background (Psionics), Psionics d6+', '+2 to opposed Psionics rolls.'],
  ['Power Surge', 'Power', 'Wild Card, Novice, Arcane Background, arcane skill d8+', 'Recover 10 Power Points when dealt a Joker in combat.'],
  ['Improved Rapid Recharge', 'Power', 'Veteran, Rapid Recharge', 'Recover 20 Power Points per hour.'],
  // Weird
  ['Beast Bond', 'Weird', 'Novice', 'You may spend Bennies for animals under your control.'],
  ['Beast Master', 'Weird', 'Novice, Spirit d8+', 'Animals like you, and a loyal beast of some sort travels with you.'],
  ['Champion', 'Weird', 'Novice, Spirit d8+, Fighting d6+', '+2 damage against supernaturally evil creatures.'],
  ['Chi', 'Weird', 'Veteran, Martial Warrior', 'Once per combat: reroll a failed attack, force an enemy to reroll a successful attack, or add +d6 to an unarmed Fighting attack.'],
  ['Danger Sense', 'Weird', 'Novice', 'Notice roll at +2 to sense ambushes or similar imminent surprises.'],
  ['Liquid Courage', 'Weird', 'Novice, Vigor d8+', 'Alcohol raises your Vigor a die type and ignores one level of Wound penalty; −1 to Agility, Smarts, and related skills.'],
  ['Scavenger', 'Weird', 'Novice, Luck', 'Once per encounter, you may conveniently find or remember a needed piece of equipment.'],
  // Legendary
  ['Followers', 'Legendary', 'Wild Card, Legendary', 'Five loyal followers join your cause.'],
  ['Professional (Trait)', 'Legendary', 'Legendary, d12 in the Trait', 'The chosen Trait and its limit increase one step.'],
  ['Expert (Trait)', 'Legendary', 'Legendary, Professional in the Trait', 'The chosen Trait and its limit increase one more step.'],
  ['Master (Trait)', 'Legendary', 'Wild Card, Legendary, Expert in the Trait', 'Your Wild Die is a d10 with the chosen Trait.'],
  ['Sidekick', 'Legendary', 'Wild Card, Legendary', 'You gain a Wild Card sidekick.'],
  ['Tough as Nails', 'Legendary', 'Legendary, Vigor d8+', 'You can take four Wounds before being Incapacitated.'],
  ['Tougher than Nails', 'Legendary', 'Legendary, Tough as Nails, Vigor d12+', 'You can take five Wounds before being Incapacitated.'],
  ['Weapon Master', 'Legendary', 'Legendary, Fighting d12+', '+1 Parry; your Fighting bonus damage die is d8.', { parryBonus: 1 }],
  ['Master of Arms', 'Legendary', 'Legendary, Weapon Master', '+1 Parry again; your Fighting bonus damage die is d10.', { parryBonus: 1 }],
];

// ---------- Hindrances ----------
// [name, severity, effect, mods?]
type H = [string, 'Minor' | 'Major', string, TraitMods?];
const HINDRANCES: H[] = [
  ['All Thumbs', 'Minor', '−2 to Repair rolls; devices glitch on a critical failure.', { bonusSkill: 'Repair', bonusAmt: -2 }],
  ['Anemic', 'Minor', '−2 to Vigor rolls resisting disease, poison, and fatigue.', { bonusSkill: 'Vigor', bonusAmt: -2 }],
  ['Arrogant', 'Major', 'You must humiliate your opponent and always challenge the strongest foe.'],
  ['Bad Eyes', 'Minor', '−1 to attack and Notice rolls relying on sight beyond close range.', { bonusSkill: 'Notice', bonusAmt: -1 }],
  ['Bad Luck', 'Major', 'One fewer Benny at the start of each session.'],
  ['Big Mouth', 'Minor', 'You cannot keep a secret; plans get shared.'],
  ['Blind', 'Major', '−6 to any action requiring sight; +2 to other social interactions.'],
  ['Bloodthirsty', 'Major', 'You never take prisoners and are known for it.'],
  ['Can’t Swim', 'Minor', '−2 to swimming (Athletics) rolls; each hex of water costs 2 hexes of Pace.'],
  ['Cautious', 'Minor', 'You plan excessively and are reluctant to act without one.'],
  ['Clueless', 'Minor', '−1 to Common Knowledge and Notice rolls.', { bonusSkill: 'Common Knowledge', bonusAmt: -1 }],
  ['Clumsy', 'Major', '−2 to Athletics and Stealth rolls.', { bonusSkill: 'Athletics', bonusAmt: -2 }],
  ['Code of Honor', 'Major', 'You keep your word and behave honourably at real cost.'],
  ['Curious', 'Major', 'You investigate everything, whatever the danger.'],
  ['Death Wish', 'Minor', 'You seek an end, but only after fulfilling some goal.'],
  ['Delusional', 'Minor', 'You hold a belief others find strange; it occasionally causes trouble.'],
  ['Doubting Thomas', 'Minor', 'You refuse to believe in the supernatural, even when it bites.'],
  ['Driven', 'Minor', 'A cause guides you; you rarely stray from it.'],
  ['Elderly', 'Major', 'Pace −1, and Strength and Vigor cannot exceed d6 — but you have more skill points.', { paceBonus: -1 }],
  ['Enemy', 'Minor', 'Someone with resources wants you gone.'],
  ['Greedy', 'Major', 'You demand more than your fair share and will fight for it.'],
  ['Habit', 'Minor', 'An annoying or addictive vice you suffer without.'],
  ['Hard of Hearing', 'Minor', '−4 to Notice rolls involving sound.', { bonusSkill: 'Notice', bonusAmt: -4 }],
  ['Heroic', 'Major', 'You always help those in need, whatever the risk.'],
  ['Hesitant', 'Minor', 'Draw two Action Cards and act on the lower (a Joker may still be kept).'],
  ['Illiterate', 'Minor', 'You cannot read or write.'],
  ['Impulsive', 'Major', 'You leap before you look.'],
  ['Jealous', 'Minor', 'You covet what others have and resent them for it.'],
  ['Loyal', 'Minor', 'You never abandon a friend.'],
  ['Mean', 'Minor', '−1 to Persuasion rolls.', { bonusSkill: 'Persuasion', bonusAmt: -1 }],
  ['Mild Mannered', 'Minor', '−2 to Intimidation rolls.', { bonusSkill: 'Intimidation', bonusAmt: -2 }],
  ['Mute', 'Major', 'You cannot speak.'],
  ['Obese', 'Minor', 'Pace −1, but +1 Toughness from sheer size.', { paceBonus: -1, toughnessBonus: 1 }],
  ['Obligation', 'Minor', 'A duty regularly claims your time.'],
  ['One Arm', 'Major', '−4 on tasks requiring two hands.'],
  ['One Eye', 'Major', '−2 to actions at range beyond close.'],
  ['Outsider', 'Minor', '−2 to Persuasion with anyone but your own kind.', { bonusSkill: 'Persuasion', bonusAmt: -2 }],
  ['Overconfident', 'Major', 'You believe you can do anything, and act like it.'],
  ['Pacifist', 'Minor', 'You fight only in self-defence and never kill needlessly.'],
  ['Phobia', 'Minor', '−1 to trait rolls in the presence of the thing you fear.'],
  ['Poverty', 'Minor', 'Half starting funds and money slips through your fingers.'],
  ['Quirk', 'Minor', 'A harmless but distinctive habit or belief.'],
  ['Ruthless', 'Minor', 'You do whatever it takes to reach your goals.'],
  ['Secret', 'Minor', 'Something in your past would ruin you if known.'],
  ['Shamed', 'Minor', 'A past failure haunts you.'],
  ['Slow', 'Minor', 'Pace −1 and a running die of d4.', { paceBonus: -1 }],
  ['Small', 'Major', '−1 Toughness from a slight frame.', { toughnessBonus: -1 }],
  ['Stubborn', 'Minor', 'You always want your way and rarely admit error.'],
  ['Suspicious', 'Minor', 'You trust no one; allies suffer for it.'],
  ['Thin Skinned', 'Minor', '−2 to resist Taunt.', { bonusSkill: 'Spirit', bonusAmt: -2 }],
  ['Tongue-Tied', 'Major', '−1 to Intimidation, Persuasion, and Taunt rolls.', { bonusSkill: 'Persuasion', bonusAmt: -1 }],
  ['Ugly', 'Minor', '−1 to Persuasion rolls.', { bonusSkill: 'Persuasion', bonusAmt: -1 }],
  ['Vengeful', 'Minor', 'You pay back insults and injuries, eventually.'],
  ['Vow', 'Minor', 'You are pledged to a group, deity, or cause that directs your actions.'],
  ['Wanted', 'Minor', 'The law or a powerful group is hunting you.'],
  ['Yellow', 'Major', '−2 to resist Fear and Intimidation.', { bonusSkill: 'Spirit', bonusAmt: -2 }],
  ['Young', 'Major', 'Fewer attribute and skill points, but an extra Benny each session.'],
];

export const CONTENT_SWADE: ContentEntry[] = [
  ...WEAPONS.map(([name, category, damage, damageType, ability, props, cost, weight], i): ContentEntry => ({
    id: contentSlug('swade', 'weapon', name),
    system: 'swade', kind: 'weapon', name, category, order: i,
    subtitle: `${damage ? `${ability === 'str' ? `Str+${damage}` : damage} ${damageType}` : `Str ${damageType}`}${props.length ? ` · ${props.join(', ')}` : ''}`,
    weapon: { damage, damageType, ability, props },
    ...(cost !== undefined || weight !== undefined
      ? { gear: { ...(cost !== undefined ? { cost } : {}), ...(weight !== undefined ? { weight } : {}) } }
      : {}),
  })),
  ...ARMOR.map(([name, category, baseAc, rangedArmor, notes, cost, weight], i): ContentEntry => ({
    id: contentSlug('swade', 'armor', name),
    system: 'swade', kind: 'armor', name, category, order: i,
    subtitle: category === 'Shield'
      ? `+${baseAc} Parry${rangedArmor ? `, +${rangedArmor} Armor vs ranged` : ''}`
      : `+${baseAc} Armor`,
    armor: { baseAc, addDex: false, rangedArmor, notes },
    ...(cost !== undefined || weight !== undefined
      ? { gear: { ...(cost !== undefined ? { cost } : {}), ...(weight !== undefined ? { weight } : {}) } }
      : {}),
  })),
  ...POWERS.map(([name, cost, rank, subtitle, mech], i): ContentEntry => ({
    id: contentSlug('swade', 'power', name),
    system: 'swade', kind: 'power', name, category: rank, order: i,
    subtitle: `${cost} PP · ${rank} · ${subtitle}`,
    power: {
      discipline: rank, level: cost, notes: subtitle,
      ...(mech?.damage ? { damage: mech.damage } : {}),
      ...(mech?.heal !== undefined ? { heal: mech.heal } : {}),
      ...(mech?.rangeFt !== undefined ? { rangeFt: mech.rangeFt } : {}),
      ...(mech?.save ? { save: mech.save, onSave: mech.onSave ?? 'negate' } : {}),
      ...(mech?.aoe ? { aoe: mech.aoe } : {}),
      ...(mech?.condition ? { condition: mech.condition } : {}),
    },
  })),
  ...GEAR.map(([name, subtitle, cost, weight, traitBonus, mech], i): ContentEntry => ({
    id: contentSlug('swade', 'gear', name),
    system: 'swade', kind: 'gear', name, category: 'Gear', order: i,
    subtitle,
    gear: {
      ...(traitBonus ? { traitBonus } : {}),
      ...(cost !== undefined ? { cost } : {}),
      ...(weight !== undefined ? { weight } : {}),
      ...(mech ?? {}),
    },
  })),
  ...AMMUNITION.map(([name, caliber, qty, subtitle, cost, weight], i): ContentEntry => ({
    id: contentSlug('swade', 'gear', name),
    system: 'swade', kind: 'gear', name, category: 'Ammunition', order: i,
    subtitle: `${subtitle} · caliber: ${caliber}`,
    gear: { qty, caliber, cost, weight },
  })),
  ...EDGES.map(([name, category, requires, effect, mods], i): ContentEntry => ({
    id: contentSlug('swade', 'edge', name),
    system: 'swade', kind: 'edge', name, category: `Edge: ${category}`, order: i,
    subtitle: effect,
    detail: `Requires: ${requires}`,
    trait: { requires, ...(mods ?? {}) },
  })),
  ...HINDRANCES.map(([name, severity, effect, mods], i): ContentEntry => ({
    id: contentSlug('swade', 'hindrance', name),
    system: 'swade', kind: 'hindrance', name, category: `Hindrance: ${severity}`, order: i,
    subtitle: effect,
    trait: { severity, ...(mods ?? {}) },
  })),
];
