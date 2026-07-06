// Pre-built Stars Without Number NPCs (based on the free-edition statblock style).
// Rows: [name, category, class, hitDice, ac, hp, attackBonus, attacks, skills, note]

import { swn } from '../systems/swn.js';
import { weaponRangeFtSwn } from './compendiumTypes.js';
import { CONTENT_SWN } from './contentSwn.js';
import { attackRows, slug, type AttackRow, type NpcEntry, type WeaponLookup } from './npcTypes.js';

// Named-weapon lookup so a prebuilt NPC's plain attacks ("Rifle", "Laser
// Pistol", ...) get the same real range a player gets from adding that
// weapon via the compendium, instead of falling back to melee.
const WEAPONS_BY_NAME_SWN = new Map(
  CONTENT_SWN
    .filter((c) => c.kind === 'weapon' && c.weapon)
    .map((c) => [c.name.toLowerCase(), c.weapon!]),
);
const lookupWeaponSwn: WeaponLookup = (name) => {
  const w = WEAPONS_BY_NAME_SWN.get(name.toLowerCase().trim());
  return w ? { range: weaponRangeFtSwn(w.props), dtype: w.damageType } : null;
};

type SkillRow = [string, number, string?]; // name, level, attr
type Row = [
  string, string, 'Warrior' | 'Expert' | 'Psychic' | 'Adventurer',
  number, number, number, number, AttackRow[], SkillRow[], string?,
];

const ROWS: Row[] = [
  // ---------- Civilians ----------
  ['Peasant', 'Civilians', 'Expert', 1, 10, 1, 0, [['Knife', 0, '1d4']], [['Work', 1]], 'Morale 6'],
  ['Dock Worker', 'Civilians', 'Expert', 1, 10, 4, 1, [['Wrench', 1, '1d4']], [['Exert', 1], ['Work', 1]]],
  ['Merchant', 'Civilians', 'Expert', 1, 10, 4, 0, [['Holdout Pistol', 1, '1d4']], [['Trade', 1], ['Talk', 1]]],
  ['Technician', 'Civilians', 'Expert', 1, 10, 4, 0, [['Spanner', 0, '1d4']], [['Fix', 1], ['Program', 1]]],
  ['Physician', 'Civilians', 'Expert', 2, 10, 7, 0, [['Scalpel', 1, '1d4']], [['Heal', 2], ['Know', 1]]],
  ['Corporate Executive', 'Civilians', 'Expert', 2, 10, 8, 1, [['Holdout Pistol', 2, '1d4']], [['Administer', 2], ['Talk', 2]]],
  ['Politician', 'Civilians', 'Expert', 3, 10, 10, 1, [['Holdout Pistol', 2, '1d4']], [['Talk', 3], ['Lead', 2]]],
  ['Cult Devotee', 'Civilians', 'Expert', 1, 10, 4, 1, [['Knife', 1, '1d4']], [], 'Fanatic — never checks morale'],
  ['Cult Leader', 'Civilians', 'Expert', 3, 12, 15, 3, [['Mono Knife', 3, '1d6+1']], [['Talk', 2], ['Lead', 2]], 'Fanatic followers'],
  ['Scavenger', 'Civilians', 'Expert', 1, 12, 5, 1, [['Laser Pistol', 1, '1d6']], [['Notice', 1], ['Survive', 1]]],
  ['Colonist', 'Civilians', 'Expert', 1, 10, 4, 1, [['Hunting Rifle', 1, '1d10+1']], [['Survive', 1], ['Work', 1]]],

  // ---------- Criminals ----------
  ['Gang Member', 'Criminals', 'Warrior', 1, 12, 4, 1, [['Knife', 1, '1d4'], ['Pistol', 1, '1d6']], [['Sneak', 1]]],
  ['Enforcer', 'Criminals', 'Warrior', 2, 14, 12, 2, [['Shotgun', 3, '3d4'], ['Brass Knuckles', 3, '1d4+1']], [['Exert', 1]], 'Intimidating presence'],
  ['Smuggler', 'Criminals', 'Expert', 2, 13, 10, 2, [['Laser Pistol', 3, '1d6+1']], [['Pilot', 2], ['Trade', 1]]],
  ['Gang Boss', 'Criminals', 'Warrior', 3, 14, 15, 3, [['Mag Pistol', 4, '2d6+1']], [['Lead', 1], ['Shoot', 1]]],
  ['Pirate', 'Criminals', 'Warrior', 1, 13, 6, 1, [['Combat Rifle', 2, '1d12'], ['Cutlass', 2, '1d8']], []],
  ['Pirate Captain', 'Criminals', 'Warrior', 4, 15, 22, 4, [['Mag Rifle', 6, '2d8+2'], ['Mono Blade', 6, '1d8+2']], [['Lead', 2], ['Pilot', 2]]],
  ['Assassin', 'Criminals', 'Expert', 4, 14, 20, 5, [['Mono Knife', 6, '1d6+2'], ['Silenced Pistol', 6, '1d6+2']], [['Sneak', 3], ['Notice', 1]], 'Strikes from ambush'],
  ['Crime Lord', 'Criminals', 'Expert', 6, 15, 30, 5, [['Mag Pistol', 6, '2d6+2']], [['Lead', 3], ['Connect', 3]], 'Bodyguards nearby'],

  // ---------- Military ----------
  ['Militia Trooper', 'Military', 'Warrior', 1, 13, 4, 1, [['Rifle', 1, '1d10+1']], [['Shoot', 0]]],
  ['Regular Soldier', 'Military', 'Warrior', 1, 15, 6, 2, [['Combat Rifle', 3, '1d12'], ['Frag Grenade', 1, '2d6']], [['Shoot', 1]]],
  ['Officer', 'Military', 'Warrior', 3, 15, 15, 3, [['Mag Pistol', 4, '2d6+1']], [['Lead', 2], ['Shoot', 1]]],
  ['Elite Soldier', 'Military', 'Warrior', 3, 16, 18, 4, [['Mag Rifle', 5, '2d8+1'], ['Mono Knife', 5, '1d6+1']], [['Shoot', 2]]],
  ['Heavy Trooper', 'Military', 'Warrior', 3, 18, 20, 4, [['Heavy Machine Gun', 5, '3d6']], [['Shoot', 2]], 'Powered armor'],
  ['Sniper', 'Military', 'Warrior', 3, 14, 15, 5, [['Sniper Rifle', 7, '2d8']], [['Sneak', 2], ['Notice', 2]], 'Lethal from concealment'],
  ['Void Marine', 'Military', 'Warrior', 4, 17, 25, 5, [['Mag Rifle', 6, '2d8+1']], [['Shoot', 2], ['Exert', 1]], 'Vacuum-rated armor'],
  ['Special Forces Operative', 'Military', 'Warrior', 5, 17, 30, 6, [['Mag Rifle', 7, '2d8+2'], ['Mono Knife', 7, '1d6+2']], [['Sneak', 2], ['Shoot', 2]]],
  ['Mercenary', 'Military', 'Warrior', 2, 15, 12, 3, [['Combat Rifle', 4, '1d12+1']], [['Shoot', 1]]],
  ['Mercenary Captain', 'Military', 'Warrior', 5, 16, 28, 5, [['Mag Rifle', 6, '2d8+2']], [['Lead', 2], ['Trade', 1]]],

  // ---------- Psychics ----------
  ['Novice Psychic', 'Psychics', 'Psychic', 1, 10, 4, 0, [['Knife', 0, '1d4']], [['Telepathy', 1]], 'Effort 2'],
  ['Trained Psychic', 'Psychics', 'Psychic', 3, 12, 12, 1, [['Pistol', 2, '1d6']], [['Telepathy', 2], ['Telekinesis', 1]], 'Effort 3'],
  ['Combat Psychic', 'Psychics', 'Psychic', 4, 15, 22, 4, [['Mag Pistol', 5, '2d6'], ['TK Strike', 5, '2d8']], [['Telekinesis', 3]], 'Effort 4; Telekinetic Armory'],
  ['Psychic Assassin', 'Psychics', 'Psychic', 5, 15, 25, 5, [['Mono Knife', 6, '1d6+2']], [['Teleportation', 3], ['Sneak', 2]], 'Effort 4; blink-strikes'],
  ['Master Psychic', 'Psychics', 'Psychic', 6, 13, 25, 3, [['Laser Pistol', 4, '1d6+1']], [['Telepathy', 4], ['Precognition', 3]], 'Effort 5'],
  ['Void Cultist Psychic', 'Psychics', 'Psychic', 3, 11, 14, 2, [['Ritual Knife', 2, '1d4']], [['Metapsionics', 2], ['Telepathy', 2]], 'Effort 3; unstable torching'],

  // ---------- Robots & VIs ----------
  ['Janitor Bot', 'Robots & VIs', 'Expert', 1, 13, 5, 0, [['Slam', 0, '1d4']], [['Work', 1]], 'Robot: immune to poison/vacuum'],
  ['Companion Bot', 'Robots & VIs', 'Expert', 1, 12, 6, 0, [['Slam', 0, '1d2']], [['Talk', 2]], 'Robot'],
  ['Labor Bot', 'Robots & VIs', 'Warrior', 2, 14, 15, 2, [['Crush', 3, '1d8']], [['Work', 2]], 'Robot'],
  ['Security Bot', 'Robots & VIs', 'Warrior', 2, 16, 15, 3, [['Integral Pistol', 4, '1d6'], ['Stun Baton', 4, '1d8']], [['Notice', 1]], 'Robot'],
  ['Expert System VI', 'Robots & VIs', 'Expert', 3, 13, 15, 1, [['Defense Drone', 2, '1d6']], [['Program', 3], ['Know', 3]], 'Virtual intelligence core'],
  ['Assassin Bot', 'Robots & VIs', 'Warrior', 5, 17, 30, 6, [['Mono Blade', 7, '1d6+2']], [['Sneak', 3]], 'Robot; holographic disguise'],
  ['War Bot', 'Robots & VIs', 'Warrior', 6, 18, 40, 6, [['Integral Mag Rifle', 8, '2d8'], ['Slam', 8, '1d10']], [['Shoot', 2]], 'Robot; military chassis'],
  ['Warbot Alpha', 'Robots & VIs', 'Warrior', 8, 20, 60, 8, [['Heavy Laser', 9, '3d6'], ['Micro-missile', 8, '4d6']], [['Shoot', 3]], 'Robot; command-grade warframe'],

  // ---------- Alien Fauna & Sophonts ----------
  ['Lesser Predator', 'Alien Fauna & Sophonts', 'Warrior', 1, 13, 5, 2, [['Bite', 2, '1d6']], [['Survive', 1]]],
  ['Pack Hunter', 'Alien Fauna & Sophonts', 'Warrior', 1, 13, 6, 2, [['Bite', 2, '1d6']], [], 'Hunts in packs of 2d4'],
  ['Venomous Crawler', 'Alien Fauna & Sophonts', 'Warrior', 2, 14, 10, 3, [['Venomous Bite', 3, '1d4']], [], 'Venom: Physical save or 2d6 damage'],
  ['Flying Ambusher', 'Alien Fauna & Sophonts', 'Warrior', 2, 15, 12, 3, [['Talons', 4, '1d8']], [], 'Dives from above with surprise'],
  ['Swarm Fauna', 'Alien Fauna & Sophonts', 'Warrior', 2, 12, 15, 2, [['Swarming Bites', 3, '1d6']], [], 'Swarm: unharmed by single-target effects'],
  ['Armored Herbivore', 'Alien Fauna & Sophonts', 'Warrior', 3, 18, 25, 3, [['Trample', 4, '1d10']], [], 'Placid unless provoked'],
  ['Greater Predator', 'Alien Fauna & Sophonts', 'Warrior', 4, 15, 25, 5, [['Bite', 6, '1d10'], ['Claw', 6, '1d8']], [['Survive', 2]]],
  ['Apex Predator', 'Alien Fauna & Sophonts', 'Warrior', 7, 16, 45, 8, [['Bite', 9, '2d8'], ['Tail Lash', 9, '1d10']], [], 'Terrifies local fauna'],
  ['Alien Sophont Warrior', 'Alien Fauna & Sophonts', 'Warrior', 2, 14, 12, 3, [['Native Weapon', 4, '1d8']], [['Survive', 1]]],
  ['Alien Sophont Envoy', 'Alien Fauna & Sophonts', 'Expert', 2, 11, 8, 1, [['Ceremonial Blade', 1, '1d6']], [['Talk', 2], ['Know', 1]]],

  // ---------- Spacers & Adventurers ----------
  ['Void Pilot', 'Spacers & Adventurers', 'Expert', 2, 13, 10, 2, [['Laser Pistol', 3, '1d6']], [['Pilot', 3], ['Fix', 1]]],
  ['Free Trader Captain', 'Spacers & Adventurers', 'Expert', 3, 13, 16, 3, [['Laser Pistol', 4, '1d6+1']], [['Trade', 3], ['Pilot', 2]]],
  ['Bounty Hunter', 'Spacers & Adventurers', 'Warrior', 4, 15, 24, 5, [['Mag Pistol', 6, '2d6+1'], ['Stun Baton', 6, '1d8']], [['Notice', 2], ['Connect', 1]]],
  ['Explorer', 'Spacers & Adventurers', 'Expert', 3, 14, 15, 3, [['Rifle', 4, '1d10+1']], [['Survive', 2], ['Notice', 2]]],
  ['Archaeotech Hunter', 'Spacers & Adventurers', 'Expert', 4, 14, 20, 4, [['Laser Rifle', 5, '1d8+1']], [['Know', 3], ['Fix', 2]], 'Obsessed with pretech relics'],
  ['Ship Medic', 'Spacers & Adventurers', 'Expert', 2, 12, 9, 1, [['Laser Pistol', 2, '1d6']], [['Heal', 3]]],

  // ---------- More Civilians & Criminals ----------
  ['Street Urchin', 'Civilians', 'Expert', 1, 11, 3, 0, [['Shiv', 0, '1d4']], [['Sneak', 1]]],
  ['Bureaucrat', 'Civilians', 'Expert', 2, 10, 6, 0, [['Holdout Pistol', 1, '1d4']], [['Administer', 2], ['Know', 1]]],
  ['Ship Engineer', 'Civilians', 'Expert', 3, 12, 12, 1, [['Wrench', 1, '1d4']], [['Fix', 3], ['Program', 2]]],
  ['Journalist', 'Civilians', 'Expert', 1, 10, 4, 0, [['Holdout Pistol', 1, '1d4']], [['Connect', 2], ['Notice', 1]]],
  ['Slaver', 'Criminals', 'Warrior', 3, 14, 16, 3, [['Shock Whip', 4, '1d6'], ['Stun Gun', 4, '1d4']], [['Talk', 1]]],
  ['Data Thief', 'Criminals', 'Expert', 3, 13, 12, 2, [['Silenced Pistol', 3, '1d6']], [['Program', 3], ['Sneak', 2]]],
  ['Cartel Sicario', 'Criminals', 'Warrior', 4, 15, 22, 4, [['Mag Rifle', 6, '2d8+1']], [['Shoot', 2]]],

  // ---------- More Military & Robots ----------
  ['Ship Trooper', 'Military', 'Warrior', 2, 16, 10, 3, [['Combat Rifle', 4, '1d12']], [['Shoot', 1]], 'Vacuum-rated'],
  ['Field Commander', 'Military', 'Warrior', 6, 16, 34, 6, [['Mag Pistol', 7, '2d6+2']], [['Lead', 3], ['Shoot', 2]]],
  ['Drone Operator', 'Military', 'Expert', 3, 13, 14, 2, [['Combat Drone', 4, '1d10']], [['Program', 2], ['Pilot', 2]]],
  ['Maintenance Bot', 'Robots & VIs', 'Expert', 1, 12, 6, 0, [['Tool Arm', 0, '1d4']], [['Fix', 2]], 'Robot'],
  ['Medical Bot', 'Robots & VIs', 'Expert', 2, 13, 10, 0, [['Injector', 1, '1d4']], [['Heal', 3]], 'Robot'],
  ['Hunter-Killer Drone', 'Robots & VIs', 'Warrior', 4, 16, 20, 5, [['Integral Laser', 6, '1d8']], [['Shoot', 2]], 'Robot; Fly'],

  // ---------- More Alien Fauna ----------
  ['Burrowing Ambusher', 'Alien Fauna & Sophonts', 'Warrior', 3, 15, 18, 4, [['Claws', 5, '1d10']], [], 'Burrows; surprise attack'],
  ['Aquatic Hunter', 'Alien Fauna & Sophonts', 'Warrior', 4, 14, 22, 5, [['Bite', 6, '1d12']], [], 'Swim only; drags prey under'],
  ['Hive Drone', 'Alien Fauna & Sophonts', 'Warrior', 1, 13, 4, 2, [['Mandibles', 2, '1d6']], [], 'Swarms; mindless'],
  ['Hive Queen', 'Alien Fauna & Sophonts', 'Warrior', 8, 16, 50, 8, [['Mandibles', 9, '2d8'], ['Acid Spray', 8, '2d6']], [], 'Spawns drones; terrifying'],
  ['Xenobeast Alpha', 'Alien Fauna & Sophonts', 'Warrior', 6, 15, 38, 7, [['Bite', 8, '1d12'], ['Tail', 8, '1d10']], [['Survive', 2]], 'Regenerates'],
];

export const NPCS_SWN: NpcEntry[] = ROWS.map((row) => {
  const [name, category, klass, level, ac, hp, ab, attacks, skills, note = ''] = row;
  const sheet = {
    ...swn.defaultSheet(),
    class: klass,
    background: category,
    level,
    ac,
    hp,
    maxHp: hp,
    attackBonus: ab,
    visionRange: 24,
    darkvision: 0,
    attacks: attackRows(attacks, lookupWeaponSwn),
    skills: skills.map(([n, lvl, attr]) => ({ name: n, level: lvl, attr: attr ?? 'dex', notes: '' })),
    notes: note,
  };
  return {
    id: slug('swn', name),
    system: 'swn' as const,
    name,
    category,
    challenge: level,
    challengeLabel: `HD ${level}`,
    ac,
    hp,
    sheet,
  };
});
