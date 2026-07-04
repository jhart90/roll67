// "Tracked picks" for the three 5e class features that are really catalogs of
// named options a player chooses from over time: Warlock Eldritch Invocations,
// Sorcerer Metamagic, and Artificer Infusions. Per the roadmap these are
// recorded/displayed choices (a chip + a feature entry), not individually
// simulated mechanics — same depth as how most subclass features are handled.

import type { SheetData } from '../types.js';
import { rows } from './types.js';

export interface NamedPick {
  id: string;
  name: string;
  desc: string;
  prereq?: string;
}

export function takenPickIds(sheet: SheetData, listId: string): string[] {
  const v = sheet[listId];
  return Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : [];
}

/** Sheet patch for recording a named pick: adds its id to `sheet[listId]` and
 *  a feature entry, same shape as `applyFeat`. No-ops for an already-taken or
 *  unknown id (unlike feats, these don't stack). */
export function applyNamedPick(sheet: SheetData, listId: string, catalog: NamedPick[], pickId: string): SheetData {
  const pick = catalog.find((p) => p.id === pickId);
  if (!pick) return {};
  const taken = takenPickIds(sheet, listId);
  if (taken.includes(pickId)) return {};
  const features = rows(sheet, 'features').slice();
  features.push({ name: pick.name, source: 'Feature', description: pick.desc });
  return { [listId]: [...taken, pickId], features };
}

export const INVOCATIONS_5E: NamedPick[] = [
  { id: 'agonizing-blast', name: 'Agonizing Blast', prereq: 'Eldritch Blast cantrip', desc: 'Add your Charisma modifier to Eldritch Blast’s damage.' },
  { id: 'armor-of-shadows', name: 'Armor of Shadows', desc: 'Cast Mage Armor on yourself at will, without a spell slot.' },
  { id: 'ascendant-step', name: 'Ascendant Step', prereq: '9th level', desc: 'Cast Levitate on yourself at will, without a spell slot.' },
  { id: 'beast-speech', name: 'Beast Speech', desc: 'Cast Speak with Animals at will, without a spell slot.' },
  { id: 'beguiling-influence', name: 'Beguiling Influence', desc: 'Gain proficiency in Deception and Persuasion.' },
  { id: 'devils-sight', name: "Devil's Sight", desc: 'See normally in darkness, magical or not, out to 120 feet.' },
  { id: 'eldritch-mind', name: 'Eldritch Mind', desc: 'Advantage on Constitution saves to maintain concentration.' },
  { id: 'eldritch-sight', name: 'Eldritch Sight', desc: 'Cast Detect Magic at will, without a spell slot.' },
  { id: 'fiendish-vigor', name: 'Fiendish Vigor', desc: 'Cast False Life on yourself at will as a 1st-level spell, without a slot.' },
  { id: 'gaze-of-two-minds', name: 'Gaze of Two Minds', desc: 'Touch a willing creature to perceive through its senses until the start of your next turn.' },
  { id: 'mask-of-many-faces', name: 'Mask of Many Faces', desc: 'Cast Disguise Self at will, without a spell slot.' },
  { id: 'misty-visions', name: 'Misty Visions', desc: 'Cast Silent Image at will, without a spell slot.' },
  { id: 'repelling-blast', name: 'Repelling Blast', prereq: 'Eldritch Blast cantrip', desc: 'Eldritch Blast can push a target up to 10 feet away.' },
  { id: 'thirsting-blade', name: 'Thirsting Blade', prereq: '5th level, Pact of the Blade', desc: 'Attack twice, instead of once, when you take the Attack action on your turn.' },
  { id: 'voice-of-the-chain-master', name: 'Voice of the Chain Master', prereq: 'Pact of the Chain', desc: 'Communicate telepathically with your familiar and perceive through its senses.' },
];

export const METAMAGIC_5E: NamedPick[] = [
  { id: 'careful-spell', name: 'Careful Spell', desc: 'Spend 1 sorcery point to protect chosen creatures from your spell’s effects.' },
  { id: 'distant-spell', name: 'Distant Spell', desc: 'Spend 1 sorcery point to double a spell’s range (or make a touch spell reach 30 ft).' },
  { id: 'empowered-spell', name: 'Empowered Spell', desc: 'Spend 1 sorcery point to reroll damage dice, up to a number equal to your Charisma modifier.' },
  { id: 'extended-spell', name: 'Extended Spell', desc: 'Spend 1 sorcery point to double a spell’s duration, to a max of 24 hours.' },
  { id: 'heightened-spell', name: 'Heightened Spell', desc: 'Spend 3 sorcery points to give one target disadvantage on its save against the spell.' },
  { id: 'quickened-spell', name: 'Quickened Spell', desc: 'Spend 2 sorcery points to cast a 1-action spell as a bonus action instead.' },
  { id: 'subtle-spell', name: 'Subtle Spell', desc: 'Spend 1 sorcery point to cast without verbal or somatic components.' },
  { id: 'twinned-spell', name: 'Twinned Spell', desc: 'Spend sorcery points equal to the spell’s level (min 1) to target a second creature with a single-target spell.' },
];

export const INFUSIONS_5E: NamedPick[] = [
  { id: 'enhanced-arcane-focus', name: 'Enhanced Arcane Focus', desc: '+1 to spell attack rolls while using this item as your spellcasting focus.' },
  { id: 'enhanced-defense', name: 'Enhanced Defense', desc: '+1 AC to a suit of armor or a shield.' },
  { id: 'enhanced-weapon', name: 'Enhanced Weapon', desc: '+1 to attack and damage rolls with a weapon.' },
  { id: 'homunculus-servant', name: 'Homunculus Servant', desc: 'Create a tiny construct companion that fights and scouts for you.' },
  { id: 'repeating-shot', name: 'Repeating Shot', desc: 'A nonmagical weapon fires magic ammunition, never needs reloading, and gets +1 to attack/damage.' },
  { id: 'returning-weapon', name: 'Returning Weapon', desc: 'A thrown weapon flies back to your hand immediately after it is thrown.' },
  { id: 'boots-of-the-winding-path', name: 'Boots of the Winding Path', desc: 'Teleport to a space you have stood on earlier this turn.' },
  { id: 'goggles-of-night', name: 'Goggles of Night', desc: 'Darkvision out to 60 feet, or +30 feet if you already have darkvision.' },
  { id: 'radiant-weapon', name: 'Radiant Weapon', desc: 'A weapon that stores radiant energy to blind foes or heal its wielder.' },
  { id: 'replicate-magic-item', name: 'Replicate Magic Item', desc: 'Replicate a known common/uncommon magic item schematic (e.g. Bag of Holding, Wand of Magic Detection).' },
];
