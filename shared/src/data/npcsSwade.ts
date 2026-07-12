// Pre-built Savage Worlds (SWADE) NPCs, in the core-book bestiary style.
// Attributes/skills are trait-die strings; `wild` marks Wild Cards (they roll
// the d6 wild die on traits and, by the book, take 3 wounds — reflected here
// as a larger HP pool). `ac` on the entry is derived Parry; `challenge` is a
// rough tier for sorting.

import { swade, dieSides } from '../systems/swade.js';
import { slug, type NpcEntry } from './npcTypes.js';
import type { SheetData } from '../types.js';

type Attrs = [string, string, string, string, string]; // agility, smarts, spirit, strength, vigor
type Skill = [string, string];                          // name, die
type Attack = [string, 'Fighting' | 'Shooting' | 'Athletics', string, string, number]; // name, skill, damage, dtype, range ft
type Armor = [string, number, number];                  // name, armor, parryBonus

interface Row {
  name: string;
  category: string;
  tier: number;
  wild: boolean;
  attrs: Attrs;
  skills: Skill[];
  attacks: Attack[];
  armor?: Armor[];
  hp: number;
  pace?: number;
  note?: string;
}

const ROWS: Row[] = [
  // ---------- People ----------
  { name: 'Townsfolk', category: 'People', tier: 0, wild: false, attrs: ['d6', 'd6', 'd6', 'd6', 'd6'], skills: [['Common Knowledge', 'd6'], ['Notice', 'd4'], ['Persuasion', 'd6']], attacks: [['Fists', 'Fighting', '1d6!', 'bludgeoning', 5]], hp: 8, note: 'An ordinary citizen.' },
  { name: 'Thug', category: 'People', tier: 1, wild: false, attrs: ['d6', 'd4', 'd6', 'd8', 'd6'], skills: [['Fighting', 'd6'], ['Intimidation', 'd6'], ['Stealth', 'd4']], attacks: [['Club', 'Fighting', '1d8!+1d4!', 'bludgeoning', 5]], hp: 10, note: 'Hired muscle.' },
  { name: 'Bandit', category: 'People', tier: 1, wild: false, attrs: ['d8', 'd6', 'd6', 'd6', 'd6'], skills: [['Fighting', 'd6'], ['Shooting', 'd6'], ['Stealth', 'd8'], ['Notice', 'd6']], attacks: [['Short Sword', 'Fighting', '1d6!+1d6!', 'slashing', 5], ['Bow', 'Shooting', '2d6!', 'piercing', 72]], armor: [['Leather Jacket', 1, 0]], hp: 10, note: 'Highway robber.' },
  { name: 'Cultist', category: 'People', tier: 1, wild: false, attrs: ['d6', 'd6', 'd8', 'd6', 'd6'], skills: [['Fighting', 'd6'], ['Occult', 'd6'], ['Stealth', 'd6']], attacks: [['Ritual Dagger', 'Fighting', '1d6!+1d4!', 'piercing', 5]], hp: 10, note: 'Fanatic — fights to the death.' },
  { name: 'Cult Leader', category: 'People', tier: 3, wild: true, attrs: ['d6', 'd8', 'd10', 'd6', 'd8'], skills: [['Fighting', 'd6'], ['Occult', 'd10'], ['Spellcasting', 'd10'], ['Intimidation', 'd8']], attacks: [['Sacrificial Blade', 'Fighting', '1d6!+1d6!', 'slashing', 5], ['Bolt', 'Shooting', '2d6!', 'energy', 288]], hp: 25, note: 'Wild Card. Arcane Background (Magic), 15 PP.' },
  { name: 'Gunslinger', category: 'People', tier: 3, wild: true, attrs: ['d10', 'd6', 'd8', 'd6', 'd8'], skills: [['Shooting', 'd10'], ['Fighting', 'd6'], ['Notice', 'd8'], ['Intimidation', 'd8']], attacks: [['.44 Magnum', 'Shooting', '2d6!+1', 'kinetic', 72], ['Knife', 'Fighting', '1d6!+1d4!', 'piercing', 5]], hp: 25, note: 'Wild Card. Quick; Marksman.' },

  // ---------- Soldiers & Lawmen ----------
  { name: 'Town Guard', category: 'Soldiers & Lawmen', tier: 1, wild: false, attrs: ['d6', 'd6', 'd6', 'd6', 'd6'], skills: [['Fighting', 'd6'], ['Shooting', 'd6'], ['Notice', 'd6'], ['Intimidation', 'd6']], attacks: [['Spear', 'Fighting', '1d6!+1d6!', 'piercing', 10], ['Crossbow', 'Shooting', '2d6!', 'piercing', 90]], armor: [['Chain Mail', 3, 0], ['Medium Shield', 0, 2]], hp: 12 },
  { name: 'Soldier', category: 'Soldiers & Lawmen', tier: 2, wild: false, attrs: ['d6', 'd6', 'd6', 'd8', 'd8'], skills: [['Fighting', 'd8'], ['Shooting', 'd8'], ['Athletics', 'd6'], ['Notice', 'd6']], attacks: [['Assault Rifle', 'Shooting', '2d8!', 'kinetic', 144], ['Combat Knife', 'Fighting', '1d8!+1d4!', 'piercing', 5]], armor: [['Kevlar Vest', 2, 0]], hp: 14, note: 'Modern infantry.' },
  { name: 'Knight', category: 'Soldiers & Lawmen', tier: 3, wild: false, attrs: ['d6', 'd6', 'd8', 'd10', 'd8'], skills: [['Fighting', 'd10'], ['Riding', 'd8'], ['Intimidation', 'd8']], attacks: [['Long Sword', 'Fighting', '1d10!+1d8!', 'slashing', 5]], armor: [['Plate Corselet', 4, 0], ['Large Shield', 0, 3]], hp: 16 },
  { name: 'Veteran Officer', category: 'Soldiers & Lawmen', tier: 3, wild: true, attrs: ['d8', 'd8', 'd8', 'd8', 'd8'], skills: [['Fighting', 'd8'], ['Shooting', 'd8'], ['Battle', 'd8'], ['Notice', 'd8'], ['Intimidation', 'd8']], attacks: [['9mm Pistol', 'Shooting', '2d6!', 'kinetic', 72], ['Saber', 'Fighting', '1d8!+1d6!', 'slashing', 5]], armor: [['Kevlar Vest', 2, 0]], hp: 25, note: 'Wild Card. Command; Hold the Line.' },

  // ---------- Creatures ----------
  { name: 'Wolf', category: 'Creatures', tier: 1, wild: false, attrs: ['d8', 'd4', 'd6', 'd6', 'd6'], skills: [['Fighting', 'd6'], ['Notice', 'd10'], ['Athletics', 'd8']], attacks: [['Bite', 'Fighting', '1d6!+1d4!', 'piercing', 5]], hp: 10, pace: 8, note: 'Go for the Throat: attacks the least-armored spot on a raise.' },
  { name: 'Bear', category: 'Creatures', tier: 3, wild: false, attrs: ['d6', 'd4', 'd8', 'd12', 'd10'], skills: [['Fighting', 'd8'], ['Notice', 'd8'], ['Athletics', 'd8']], attacks: [['Claws', 'Fighting', '1d12!+1d6!', 'slashing', 5], ['Bite', 'Fighting', '1d12!+1d4!', 'piercing', 5]], hp: 20, note: 'Size 2 — large and hard to put down.' },
  { name: 'Lion', category: 'Creatures', tier: 2, wild: false, attrs: ['d8', 'd6', 'd10', 'd12', 'd8'], skills: [['Fighting', 'd8'], ['Notice', 'd8'], ['Athletics', 'd10'], ['Stealth', 'd8']], attacks: [['Claws & Bite', 'Fighting', '1d12!+1d6!', 'slashing', 5]], hp: 16, pace: 8, note: 'Pounce: +4 damage on a leaping attack.' },
  { name: 'Giant Spider', category: 'Creatures', tier: 2, wild: false, attrs: ['d10', 'd4', 'd6', 'd10', 'd6'], skills: [['Fighting', 'd8'], ['Stealth', 'd10'], ['Athletics', 'd10']], attacks: [['Bite', 'Fighting', '1d10!+1d4!', 'piercing', 5], ['Web', 'Athletics', '0', '', 36]], hp: 12, pace: 8, note: 'Poison: Vigor roll on a Shaken/wound result or take Fatigue. Webs Entangle.' },
  { name: 'Orc', category: 'Creatures', tier: 1, wild: false, attrs: ['d6', 'd4', 'd6', 'd8', 'd8'], skills: [['Fighting', 'd6'], ['Shooting', 'd6'], ['Intimidation', 'd8'], ['Notice', 'd6']], attacks: [['Battle Axe', 'Fighting', '1d8!+1d8!', 'slashing', 5]], armor: [['Leather Armor', 2, 0]], hp: 12, note: 'Size 1; brutish humanoid.' },
  { name: 'Orc Chieftain', category: 'Creatures', tier: 3, wild: true, attrs: ['d8', 'd6', 'd8', 'd10', 'd10'], skills: [['Fighting', 'd10'], ['Intimidation', 'd10'], ['Battle', 'd6'], ['Notice', 'd6']], attacks: [['Great Sword', 'Fighting', '1d10!+1d10!', 'slashing', 5]], armor: [['Chain Mail', 3, 0]], hp: 30, note: 'Wild Card. Sweep; Command.' },
  { name: 'Goblin', category: 'Creatures', tier: 0, wild: false, attrs: ['d8', 'd6', 'd6', 'd4', 'd6'], skills: [['Fighting', 'd6'], ['Shooting', 'd8'], ['Stealth', 'd10'], ['Notice', 'd6']], attacks: [['Spear', 'Fighting', '1d4!+1d6!', 'piercing', 10], ['Sling', 'Shooting', '1d4!', 'bludgeoning', 24]], hp: 8, note: 'Size −1; sneaky.' },
  { name: 'Ogre', category: 'Creatures', tier: 3, wild: false, attrs: ['d6', 'd4', 'd6', 'd12', 'd12'], skills: [['Fighting', 'd8'], ['Intimidation', 'd8'], ['Notice', 'd4']], attacks: [['Massive Club', 'Fighting', '1d12!+1d8!', 'bludgeoning', 10]], hp: 22, note: 'Size 3; Sweep.' },
  { name: 'Troll', category: 'Creatures', tier: 4, wild: false, attrs: ['d8', 'd4', 'd8', 'd12', 'd10'], skills: [['Fighting', 'd8'], ['Notice', 'd6'], ['Athletics', 'd8']], attacks: [['Claws', 'Fighting', '1d12!+1d6!', 'slashing', 10]], armor: [['Rubbery Hide', 1, 0]], hp: 26, note: 'Size 2; Fast Regeneration (Vigor roll each round to heal) — fire stops it.' },
  { name: 'Young Dragon', category: 'Creatures', tier: 5, wild: true, attrs: ['d8', 'd8', 'd10', 'd12', 'd12'], skills: [['Fighting', 'd10'], ['Notice', 'd8'], ['Intimidation', 'd12'], ['Athletics', 'd8']], attacks: [['Claws & Bite', 'Fighting', '1d12!+1d8!', 'slashing', 10], ['Fiery Breath', 'Athletics', '3d6!', 'fire', 0]], armor: [['Scaly Hide', 4, 0]], hp: 40, pace: 8, note: 'Wild Card. Size 6; flight; breath weapon uses the cone template.' },

  // ---------- Undead & Horrors ----------
  { name: 'Skeleton', category: 'Undead & Horrors', tier: 1, wild: false, attrs: ['d8', 'd4', 'd4', 'd6', 'd6'], skills: [['Fighting', 'd6'], ['Shooting', 'd6'], ['Notice', 'd4'], ['Intimidation', 'd6']], attacks: [['Rusty Sword', 'Fighting', '1d6!+1d6!', 'slashing', 5], ['Bony Claws', 'Fighting', '1d6!+1d4!', 'slashing', 5]], hp: 10, note: 'Undead: +2 Toughness, no wound penalties; piercing does half damage.' },
  { name: 'Zombie', category: 'Undead & Horrors', tier: 1, wild: false, attrs: ['d6', 'd4', 'd4', 'd6', 'd6'], skills: [['Fighting', 'd6'], ['Notice', 'd4'], ['Intimidation', 'd6']], attacks: [['Claws & Bite', 'Fighting', '1d6!+1d4!', 'slashing', 5]], hp: 12, pace: 4, note: 'Undead: +2 Toughness, no wound penalties; slow but relentless.' },
  { name: 'Ghost', category: 'Undead & Horrors', tier: 3, wild: false, attrs: ['d8', 'd6', 'd10', 'd6', 'd6'], skills: [['Fighting', 'd6'], ['Notice', 'd10'], ['Stealth', 'd12'], ['Intimidation', 'd10']], attacks: [['Chilling Touch', 'Fighting', '1d6!+1d4!', 'cold', 5]], hp: 14, note: 'Ethereal: only magic or the supernatural can hurt it. Causes Fear checks.' },
  { name: 'Werewolf', category: 'Undead & Horrors', tier: 4, wild: true, attrs: ['d10', 'd6', 'd8', 'd12', 'd10'], skills: [['Fighting', 'd10'], ['Notice', 'd10'], ['Stealth', 'd8'], ['Intimidation', 'd10']], attacks: [['Claws', 'Fighting', '1d12!+1d6!', 'slashing', 5], ['Bite', 'Fighting', '1d12!+1d4!', 'piercing', 5]], hp: 30, pace: 8, note: 'Wild Card. Invulnerable except to silver; Infection on a bite.' },
  { name: 'Vampire', category: 'Undead & Horrors', tier: 5, wild: true, attrs: ['d10', 'd8', 'd10', 'd12', 'd10'], skills: [['Fighting', 'd10'], ['Notice', 'd8'], ['Stealth', 'd10'], ['Intimidation', 'd12'], ['Persuasion', 'd10']], attacks: [['Claws', 'Fighting', '1d12!+1d6!', 'slashing', 5], ['Bite', 'Fighting', '1d12!+1d4!', 'piercing', 5]], hp: 35, note: 'Wild Card. Undead; Charm; weakness: sunlight, stake, holy symbols.' },
];

function sheetFor(r: Row): SheetData {
  const sheet = swade.defaultSheet();
  const [agility, smarts, spirit, strength, vigor] = r.attrs;
  Object.assign(sheet, {
    concept: r.name, wildCard: r.wild, agility, smarts, spirit, strength, vigor,
    hp: r.hp, maxHp: r.hp, pace: r.pace ?? 6, bennies: r.wild ? 2 : 0,
    skills: r.skills.map(([name, die]) => ({ name, die, notes: '' })),
    attacks: r.attacks.map(([name, skill, damage, dtype, range]) => ({ name, skill, damage, dtype, range, notes: '' })),
    armor: (r.armor ?? []).map(([name, armor, parryBonus]) => ({ name, armor, parryBonus, equipped: true, notes: '' })),
    notes: r.note ?? '',
  });
  return sheet;
}

function parryOf(r: Row): number {
  const fighting = r.skills.find(([n]) => n === 'Fighting');
  const shields = (r.armor ?? []).reduce((sum, [, , p]) => sum + p, 0);
  return 2 + Math.floor(dieSides(fighting ? fighting[1] : '') / 2) + shields;
}

export const NPCS_SWADE: NpcEntry[] = ROWS.map((r) => ({
  id: slug('swade', r.name),
  system: 'swade',
  name: r.name,
  category: r.category,
  challenge: r.tier,
  challengeLabel: r.wild ? 'Wild Card' : 'Extra',
  ac: parryOf(r),
  hp: r.hp,
  sheet: sheetFor(r),
}));
