// Stars Without Number (free edition) content: weapons, armor, gear,
// cyberware, and psychic powers.
import { contentSlug, type ContentEntry } from './compendiumTypes.js';

// [name, category, damage, type, props]
type W = [string, string, string, string, string[]];
const WEAPONS: W[] = [
  ['Knife', 'Melee', '1d4', 'kinetic', ['1 enc']],
  ['Sword', 'Melee', '1d8', 'kinetic', ['1 enc']],
  ['Mono-blade', 'Melee', '1d8', 'kinetic', ['shock 2/AC 15', '1 enc']],
  ['Combat Rifle Butt', 'Melee', '1d6', 'kinetic', []],
  ['Vibro-dagger', 'Melee', '1d6', 'kinetic', ['shock 2/AC 13']],
  ['Unarmed', 'Melee', '1d2', 'kinetic', []],
  ['Semi-auto Pistol', 'Ranged', '1d6', 'kinetic', ['range 30/100', 'mag 15']],
  ['Revolver', 'Ranged', '1d8', 'kinetic', ['range 30/100', 'mag 6']],
  ['Rifle', 'Ranged', '1d10+1', 'kinetic', ['range 200/400', 'mag 6']],
  ['Combat Rifle', 'Ranged', '1d12', 'kinetic', ['range 100/300', 'mag 30']],
  ['Shotgun', 'Ranged', '3d4', 'kinetic', ['range 10/30', 'mag 2']],
  ['Sniper Rifle', 'Ranged', '2d8+2', 'kinetic', ['range 500/1000', 'mag 1']],
  ['Laser Pistol', 'Ranged', '1d6', 'energy', ['range 100/300', '10 shots']],
  ['Laser Rifle', 'Ranged', '1d8', 'energy', ['range 300/500', '20 shots']],
  ['Mag Pistol', 'Ranged', '2d6+1', 'kinetic', ['range 100/300', 'mag 15']],
  ['Mag Rifle', 'Ranged', '2d8+2', 'kinetic', ['range 300/500', 'mag 20']],
  ['Thermal Grenade', 'Ranged', '2d6', 'energy', ['thrown', 'blast']],
  ['Frag Grenade', 'Ranged', '2d6', 'kinetic', ['thrown', 'blast']],
  ['Plasma Projector', 'Ranged', '2d10', 'energy', ['range 50/100', 'mag 4']],
  ['Heavy Machine Gun', 'Ranged', '3d6', 'kinetic', ['range 100/300', 'burst']],
];

// [name, category, ac, notes]
type A = [string, string, number, string];
const ARMOR: A[] = [
  ['Primitive Armor', 'Armor', 12, 'Leathers/plate; TL0'],
  ['Woven Body Armor', 'Armor', 13, 'Concealable street armor'],
  ['Deflec Field', 'Armor', 15, 'Personal energy field vs ranged'],
  ['Armored Undersuit', 'Armor', 13, 'Worn under clothing'],
  ['Combat Field Uniform', 'Armor', 15, 'Standard military kit'],
  ['Assault Suit', 'Armor', 18, 'Powered; vacuum-sealed'],
  ['Storm Armor', 'Armor', 17, 'Heavy powered infantry armor'],
  ['Shield', 'Shield', 1, '+1 AC vs one attacker'],
];

// [name, category, subtitle]
type G = [string, string, string];
const GEAR: G[] = [
  ['Backpack', 'Gear', 'Standard load carrier'],
  ['Compad', 'Gear', 'Handheld comm/computer'],
  ['Dataslab', 'Gear', 'Tablet computer'],
  ['Lazarus Patch', 'Gear', 'Emergency medical nanite patch; stabilize + heal'],
  ['Medkit', 'Gear', 'First aid supplies for Heal checks'],
  ['Metatool', 'Gear', 'Universal repair/fabrication tool'],
  ['Rebreather', 'Gear', 'Filters air / short vacuum use'],
  ['Survival Kit', 'Gear', 'Shelter, water, rations for harsh worlds'],
  ['Vacc Skin', 'Gear', 'Skintight vacuum suit'],
  ['Thermal Flashlight', 'Gear', 'Light + thermal imaging'],
  ['Climbing Harness', 'Gear', 'Powered ascension gear'],
  ['Glowbug Lamp', 'Gear', 'Bioluminescent light source'],
  ['Spike Thrower Ammo', 'Gear', 'Reload magazine'],
  ['Ammo, Type A Cell', 'Gear', 'Energy weapon power cell'],
  ['Ration Bars (week)', 'Gear', 'Compressed nutrition'],
  ['Toolkit (Postech)', 'Gear', 'Fix modern tech'],
  ['Toolkit (Pretech)', 'Gear', 'Fix advanced pretech'],
  ['Data Cube', 'Gear', 'Data storage'],
  ['Grav Harness', 'Gear', 'Short-range personal lift'],
  ['Stim Injector', 'Gear', 'Combat stimulant, temporary boost'],
];

// [name, subtitle]
type C = [string, string];
const CYBER: C[] = [
  ['Cybereye (Basic)', 'Vision enhancement, low-light/thermal'],
  ['Dermal Plating', '+1 armor; subdermal weave'],
  ['Boosted Reflexes', 'React faster; init bonus'],
  ['Neural Interface Seat', 'Direct machine/ship control'],
  ['Suboccipital Databank', 'Perfect skill recall for one skill'],
  ['Metabolic Optimizer', 'Improved healing/system strain'],
  ['Grip Feet', 'Cling to surfaces; climb'],
  ['Prosthetic Limb', 'Replacement limb, integral tool'],
];

// [name, discipline, level, notes]
type P = [string, string, number, string];
const POWERS: P[] = [
  ['Sense Danger', 'Precognition', 1, 'Sixth sense for imminent threats'],
  ['See Future Prospects', 'Precognition', 2, 'Divine likely outcome of a plan'],
  ['Precognitive Dodge', 'Precognition', 2, 'Foresee attacks; boost AC/save'],
  ['Foretelling', 'Precognition', 4, 'Answer a question about the future'],
  ['Attunement', 'Telepathy', 1, 'Sense emotions and surface thoughts'],
  ['Mind Link', 'Telepathy', 2, 'Silent communication with allies'],
  ['Read Mind', 'Telepathy', 2, 'Probe a subject for deeper thoughts'],
  ['Domination', 'Telepathy', 4, 'Command a subject briefly'],
  ['Telekinetic Grip', 'Telekinesis', 1, 'Move objects with your mind'],
  ['Telekinetic Manipulation', 'Telekinesis', 2, 'Fine manipulation at range'],
  ['Kinetic Barrier', 'Telekinesis', 2, 'Deflect incoming attacks'],
  ['Telekinetic Ram', 'Telekinesis', 3, 'Blast a target: 2d8 kinetic'],
  ['Personal Apport', 'Teleportation', 1, 'Blink a short distance'],
  ['Astral Wandering', 'Teleportation', 2, 'Project awareness elsewhere'],
  ['Rift Step', 'Teleportation', 3, 'Teleport with allies'],
  ['Banishment', 'Teleportation', 4, 'Fling a target far away'],
  ['Healing Touch', 'Biopsionics', 1, 'Heal wounds; treat one subject'],
  ['Purge Toxin', 'Biopsionics', 2, 'Neutralize poison/disease'],
  ['Bio-Aegis', 'Biopsionics', 3, 'Regenerate; resist harm'],
  ['Revivification', 'Biopsionics', 4, 'Restore the recently dead'],
  ['Psychic Static', 'Metapsionics', 1, 'Disrupt hostile psychics'],
  ['Amplify Power', 'Metapsionics', 2, 'Boost another psionic effect'],
  ['Psionic Assault', 'Metapsionics', 3, 'Mental attack: 3d6 vs Mental save'],
  ['Suppress Discipline', 'Metapsionics', 4, 'Shut down a subject\'s powers'],
];

export const CONTENT_SWN: ContentEntry[] = [
  ...WEAPONS.map(([name, category, damage, damageType, props], i): ContentEntry => ({
    id: contentSlug('swn', 'weapon', name),
    system: 'swn', kind: 'weapon', name, category: `Weapon: ${category}`, order: i,
    subtitle: `${damage} ${damageType}${props.length ? ' · ' + props.join(', ') : ''}`,
    weapon: { damage, damageType, ability: 'none', props },
  })),
  ...ARMOR.map(([name, category, ac, notes], i): ContentEntry => ({
    id: contentSlug('swn', 'armor', name),
    system: 'swn', kind: 'armor', name, category, order: i,
    subtitle: `AC ${ac}${notes ? ' · ' + notes : ''}`,
    armor: { baseAc: ac, addDex: false, notes },
  })),
  ...GEAR.map(([name, category, subtitle], i): ContentEntry => ({
    id: contentSlug('swn', 'gear', name),
    system: 'swn', kind: 'gear', name, category, order: i, subtitle,
  })),
  ...CYBER.map(([name, subtitle], i): ContentEntry => ({
    id: contentSlug('swn', 'gear', 'cyber-' + name),
    system: 'swn', kind: 'magicitem', name, category: 'Cyberware', order: i, subtitle,
  })),
  ...POWERS.map(([name, discipline, level, notes], i): ContentEntry => ({
    id: contentSlug('swn', 'power', name),
    system: 'swn', kind: 'power', name, category: `Psionics: ${discipline}`, order: level * 100 + i,
    subtitle: `${discipline} · Level ${level} · ${notes}`,
    power: { discipline, level, notes },
  })),
];
