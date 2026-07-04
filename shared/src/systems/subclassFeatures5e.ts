// Named subclass features (with short descriptions) for the popular 5e
// subclasses, keyed by the subclass display name. The level-up wizard records
// the real feature at each subclass-feature level instead of a placeholder.
// Numeric ones (Champion crit, Battle Master dice, EK/AT casting, etc.) are
// mechanized separately in features5e.ts; this table is the descriptive layer.

export interface SubclassFeature {
  level: number;
  name: string;
  desc: string;
}

const f = (level: number, name: string, desc: string): SubclassFeature => ({ level, name, desc });

export const SUBCLASS_FEATURES_5E: Record<string, SubclassFeature[]> = {
  // ---- Barbarian ----
  'Path of the Berserker': [
    f(3, 'Frenzy', 'Rage into a frenzy for a bonus-action melee attack each turn (then exhaustion).'),
    f(6, 'Mindless Rage', "Can't be charmed or frightened while raging."),
    f(10, 'Intimidating Presence', 'Frighten a creature as an action.'),
    f(14, 'Retaliation', 'Reaction melee attack against a creature that damages you.'),
  ],
  'Path of the Totem Warrior': [
    f(3, 'Spirit Seeker / Totem Spirit', 'Beast Sense & Speak with Animals; a totem (Bear = resistance to all but psychic).'),
    f(6, 'Aspect of the Beast', 'A persistent bestial boon (e.g. carry heavy loads, track).'),
    f(10, 'Spirit Walker', 'Cast Commune with Nature as a ritual.'),
    f(14, 'Totemic Attunement', 'A combat totem (Bear = adjacent foes have disadvantage attacking others).'),
  ],
  'Path of the Zealot': [
    f(3, 'Divine Fury / Warrior of the Gods', '+1d6+½ level damage on your first hit each turn while raging; easier resurrection.'),
    f(6, 'Fanatical Focus', 'Reroll a failed save once per rage.'),
    f(10, 'Zealous Presence', 'Give up to 10 allies advantage on attacks and saves.'),
    f(14, 'Rage Beyond Death', "Rage keeps you fighting at 0 HP until it ends."),
  ],

  // ---- Bard ----
  'College of Lore': [
    f(3, 'Bonus Proficiencies / Cutting Words', 'Three skills; subtract a Bardic die from a foe’s roll as a reaction.'),
    f(6, 'Additional Magical Secrets', 'Learn two spells from any class.'),
    f(14, 'Peerless Skill', 'Add a Bardic Inspiration die to your own ability check.'),
  ],
  'College of Valor': [
    f(3, 'Bonus Proficiencies / Combat Inspiration', 'Armor & martial weapons; allies add the die to damage or AC.'),
    f(6, 'Extra Attack', 'Attack twice when you take the Attack action.'),
    f(14, 'Battle Magic', 'Bonus-action weapon attack after casting a spell.'),
  ],

  // ---- Cleric ----
  'Life Domain': [
    f(1, 'Bonus Proficiency / Disciple of Life', 'Heavy armor; healing spells restore +2 + spell level.'),
    f(2, 'Channel Divinity: Preserve Life', 'Restore HP equal to 5 × your level, split among creatures.'),
    f(6, 'Blessed Healer', 'Your healing spells also heal you.'),
    f(8, 'Divine Strike', 'Once/turn, weapon hits deal +1d8 (2d8 at 14) radiant.'),
    f(17, 'Supreme Healing', 'Healing dice are maximized.'),
  ],
  'War Domain': [
    f(1, 'Bonus Proficiencies / War Priest', 'Heavy armor & martial weapons; bonus-action attack a few times/rest.'),
    f(2, 'Channel Divinity: Guided Strike', '+10 to an attack roll.'),
    f(6, 'Channel Divinity: War God’s Blessing', 'Reaction to grant an ally +10 attack.'),
    f(8, 'Divine Strike', 'Once/turn, weapon hits deal +1d8 (2d8 at 14) damage.'),
    f(17, 'Avatar of Battle', 'Resistance to nonmagical bludgeoning/piercing/slashing.'),
  ],
  'Light Domain': [
    f(1, 'Bonus Cantrip / Warding Flare', 'Light cantrip; impose disadvantage on an attacker as a reaction.'),
    f(2, 'Channel Divinity: Radiance of the Dawn', 'Dispel darkness and deal 2d10 + level radiant nearby.'),
    f(6, 'Improved Flare', 'Warding Flare can protect allies too.'),
    f(8, 'Potent Spellcasting', 'Add WIS mod to cantrip damage.'),
    f(17, 'Corona of Light', 'Emit sunlight; foes have disadvantage on fire/radiant saves.'),
  ],
  'Knowledge Domain': [
    f(1, 'Blessings of Knowledge', 'Two languages; expertise in two Knowledge-related skills.'),
    f(2, 'Channel Divinity: Knowledge of the Ages', 'Grant yourself proficiency in a skill or tool briefly.'),
    f(6, 'Channel Divinity: Read Thoughts', 'Read a creature’s surface thoughts; optionally charm it.'),
    f(8, 'Potent Spellcasting', 'Add WIS mod to cantrip damage.'),
    f(17, 'Visions of the Past', 'Glimpse recent events tied to an object or place.'),
  ],
  'Nature Domain': [
    f(1, 'Acolyte of Nature', 'A druid cantrip; proficiency in a nature-related skill.'),
    f(2, 'Channel Divinity: Charm Animals and Plants', 'Charm beasts and plant creatures nearby.'),
    f(6, 'Dampen Elements', 'Reaction: grant resistance to acid/cold/fire/lightning/thunder.'),
    f(8, 'Divine Strike', 'Once/turn, weapon hits deal +1d8 (2d8 at 14) damage of your domain’s type.'),
    f(17, 'Master of Nature', 'Command charmed animals and plant creatures.'),
  ],
  'Tempest Domain': [
    f(1, 'Wrath of the Storm', 'Reaction: deal lightning or thunder damage to a creature that hits you.'),
    f(2, 'Channel Divinity: Destructive Wrath', 'Max the damage of a lightning/thunder spell.'),
    f(6, 'Thunderbolt Strike', 'Lightning damage you deal can push a Large or smaller creature back.'),
    f(8, 'Divine Strike', 'Once/turn, weapon hits deal +1d8 (2d8 at 14) thunder damage.'),
    f(17, 'Stormborn', 'Fly speed equal to your walking speed whenever you’re outdoors.'),
  ],
  'Trickery Domain': [
    f(1, 'Blessing of the Trickster', 'Grant an ally advantage on Stealth checks.'),
    f(2, 'Channel Divinity: Invoke Duplicity', 'Create an illusory duplicate of yourself.'),
    f(6, 'Channel Divinity: Cloak of Shadows', 'Turn invisible until you attack, cast, or your turn ends.'),
    f(8, 'Divine Strike', 'Once/turn, weapon hits deal +1d8 (2d8 at 14) poison damage.'),
    f(17, 'Improved Duplicity', 'Create up to four duplicates of Invoke Duplicity.'),
  ],
  'Death Domain': [
    f(1, 'Bonus Proficiency / Reaper', 'Martial weapon proficiency; necromancy cantrips can target one extra creature.'),
    f(2, 'Channel Divinity: Touch of Death', 'Melee hits deal extra necrotic damage.'),
    f(6, 'Inescapable Destruction', 'Your necrotic damage ignores resistance.'),
    f(8, 'Divine Strike', 'Once/turn, weapon hits deal +1d8 (2d8 at 14) necrotic damage.'),
    f(17, 'Improved Reaper', 'Necromancy cantrips gain range and can target two creatures.'),
  ],
  'Forge Domain': [
    f(1, 'Bonus Proficiency / Blessing of the Forge', 'Heavy armor & smith’s tools; imbue a weapon/armor with +1 overnight.'),
    f(2, 'Channel Divinity: Artisan’s Blessing', 'Magically craft a simple item.'),
    f(6, 'Soul of the Forge', 'Resistance to fire; +1 AC while wearing heavy armor.'),
    f(8, 'Divine Strike', 'Once/turn, weapon hits deal +1d8 (2d8 at 14) fire damage.'),
    f(17, 'Saint of Forge and Fire', 'Resistance to nonmagical bludgeoning/piercing/slashing; immune to fire.'),
  ],
  'Grave Domain': [
    f(1, 'Circle of Mortality / Eyes of the Grave', 'Max healing on a dying creature; sense undead nearby.'),
    f(2, 'Channel Divinity: Path to the Grave', 'Curse a creature: the next hit against it is a critical.'),
    f(6, 'Sentinel at Death’s Door', 'Reaction: turn a critical hit against a creature into a normal hit.'),
    f(8, 'Potent Spellcasting', 'Add WIS mod to cantrip damage.'),
    f(17, 'Keeper of Souls', 'Regain HP when a creature dies near you.'),
  ],
  'Order Domain': [
    f(1, 'Bonus Proficiency / Voice of Authority', 'Heavy armor; an ally can immediately use their reaction to attack after your spell.'),
    f(2, 'Channel Divinity: Order’s Demand', 'Frighten or compel nearby foes to obey a one-word command.'),
    f(6, 'Embodiment of the Law', 'Cast certain enchantment spells as a bonus action a few times per rest.'),
    f(8, 'Divine Strike', 'Once/turn, weapon hits deal +1d8 (2d8 at 14) psychic damage.'),
    f(17, 'Order’s Wrath', 'Extra damage against creatures marked by your Order’s Demand.'),
  ],
  'Peace Domain': [
    f(1, 'Implement of Peace / Emboldening Bond', 'Bond up to allies who share bonus dice on attacks/checks/saves/damage.'),
    f(2, 'Channel Divinity: Balm of Peace', 'Move and heal several creatures without provoking opportunity attacks.'),
    f(6, 'Protective Bond', 'Bonded allies can teleport to intercept damage meant for each other.'),
    f(8, 'Potent Spellcasting', 'Add WIS mod to cantrip damage.'),
    f(17, 'Expansive Bond', 'Bond more allies; the bond’s benefits grow.'),
  ],
  'Twilight Domain': [
    f(1, 'Bonus Proficiency / Eyes of Night', 'Martial weapons; share darkvision with nearby allies.'),
    f(2, 'Channel Divinity: Twilight Sanctuary', 'A protective aura granting temp HP and easing fear each round.'),
    f(6, 'Steps of Night', 'Fly during dim light or darkness.'),
    f(8, 'Divine Strike', 'Once/turn, weapon hits deal +1d8 (2d8 at 14) radiant/necrotic damage.'),
    f(17, 'Twilight Shroud', 'Your Sanctuary aura also lightly obscures and dampens noise.'),
  ],

  // ---- Druid ----
  'Circle of the Moon': [
    f(2, 'Combat Wild Shape / Circle Forms', 'Wild Shape as a bonus action into stronger beasts (CR 1+).'),
    f(6, 'Primal Strike', 'Beast-form attacks count as magical.'),
    f(10, 'Elemental Wild Shape', 'Spend 2 uses to become an elemental.'),
    f(14, 'Thousand Forms', 'Cast Alter Self at will.'),
  ],
  'Circle of the Land': [
    f(2, 'Bonus Cantrip / Natural Recovery', 'A cantrip; recover spell slots on a short rest.'),
    f(6, "Land's Stride", 'Move through difficult plant terrain freely; resist plant hazards.'),
    f(10, "Nature's Ward", "Can't be charmed/frightened by elementals/fey; immune to poison & disease."),
    f(14, "Nature's Sanctuary", 'Beasts and plants must save to attack you.'),
  ],

  // ---- Fighter ----
  'Champion': [
    f(3, 'Improved Critical', 'Your weapon attacks crit on a 19–20.'),
    f(7, 'Remarkable Athlete', 'Half proficiency to STR/DEX/CON checks; better running jump.'),
    f(10, 'Additional Fighting Style', 'Adopt a second fighting style.'),
    f(15, 'Superior Critical', 'Your weapon attacks crit on an 18–20.'),
    f(18, 'Survivor', 'Regain HP each turn when below half and not at 0.'),
  ],
  'Battle Master': [
    f(3, 'Combat Superiority', 'Learn maneuvers fueled by superiority dice (d8).'),
    f(7, 'Know Your Enemy', 'Study a creature to learn its relative capabilities.'),
    f(10, 'Improved Combat Superiority', 'Superiority dice become d10.'),
    f(15, 'Relentless', 'Regain a superiority die when you roll initiative with none.'),
    f(18, 'Improved Combat Superiority', 'Superiority dice become d12.'),
  ],
  'Eldritch Knight': [
    f(3, 'Spellcasting / Weapon Bond', 'INT third-caster (mostly abjuration/evocation); bond to summon weapons.'),
    f(7, 'War Magic', 'Bonus-action weapon attack after casting a cantrip.'),
    f(10, 'Eldritch Strike', 'Weapon hits give a foe disadvantage on your next spell save.'),
    f(15, 'Arcane Charge', 'Teleport when you Action Surge.'),
    f(18, 'Improved War Magic', 'Bonus-action weapon attack after casting any spell.'),
  ],
  'Rune Knight': [
    f(3, 'Bonus Proficiency / Rune Carver', 'Smith’s tools; etch magic runes (Cloud, Fire, Frost, Stone) into gear for their effects.'),
    f(7, "Giant's Might", 'Bonus action: grow a size, advantage on STR checks, +1d6 melee damage (tracked pool).'),
    f(10, 'Great Stature', 'Permanently grow slightly taller; +1d4 to Giant’s Might damage.'),
    f(15, 'Master of Runes', 'Use each rune’s effect twice per rest instead of once.'),
    f(18, 'Runic Juggernaut', 'Giant’s Might can grow you to Huge, doubling your reach.'),
  ],
  'Psi Warrior': [
    f(3, 'Psionic Power', 'A Psionic Energy die pool (tracked) fuels Protective Field, Psionic Strike, and telekinetic movement.'),
    f(7, 'Telekinetic Adept', 'Telekinetic Thrust (shove/knock prone) and share your telekinetic movement.'),
    f(10, 'Guarded Mind', 'Resistance to psychic damage; charm/fear end early on a successful save.'),
    f(15, 'Bulwark of Force', 'Grant nearby allies half cover with a barrier of force.'),
    f(18, 'Telekinetic Master', 'Cast Telekinesis at will without spending psionic energy.'),
  ],
  'Echo Knight': [
    f(3, 'Manifest Echo', 'Summon a spectral duplicate of yourself to attack or teleport through.'),
    f(7, 'Unleash Incarnation', 'Make an extra attack through your Echo a few times per rest (tracked pool).'),
    f(10, 'Echo Avatar', 'Send your Echo scouting far beyond your normal range.'),
    f(15, "Shield Echo", 'Reaction: your Echo intercepts an attack, redirecting it to itself.'),
    f(18, 'Legion of One', 'Manifest two Echoes at once.'),
  ],

  // ---- Monk ----
  'Way of the Open Hand': [
    f(3, 'Open Hand Technique', 'Flurry hits can knock prone, push, or deny reactions.'),
    f(6, 'Wholeness of Body', 'Heal yourself 3 × level once per long rest.'),
    f(11, 'Tranquility', 'Start each day under a Sanctuary effect.'),
    f(17, 'Quivering Palm', 'Set up a lethal vibration you can trigger later.'),
  ],
  'Way of Shadow': [
    f(3, 'Shadow Arts', 'Spend ki for Darkness, Silence, Pass without Trace, etc.'),
    f(6, 'Shadow Step', 'Teleport between shadows with advantage on the next melee attack.'),
    f(11, 'Cloak of Shadows', 'Become invisible in dim light or darkness.'),
    f(17, 'Opportunist', 'Reaction attack when a nearby creature is hit by someone else.'),
  ],
  'Way of the Four Elements': [
    f(3, 'Disciple of the Elements', 'Spend ki to fuel elemental disciplines (Fangs of the Fire Snake, Water Whip, etc.).'),
    f(6, 'Elemental disciplines', 'Learn another discipline; existing ones scale with your ki spent.'),
    f(11, 'Elemental disciplines', 'Learn another discipline (higher-ki options like Wave of Rolling Earth).'),
    f(17, 'Elemental disciplines', 'Learn another discipline (top-tier options like Fist of Unbroken Air).'),
  ],
  'Way of the Kensei': [
    f(3, 'Path of the Kensei', 'Chosen weapons count as monk weapons; Agile Parry and Kensei’s Shot.'),
    f(6, 'One with the Blade', 'Extra kensei-weapon damage die; redirect a deflected missile at a target.'),
    f(11, 'Sharpen the Blade', 'Spend ki for a temporary +1 to +3 on a kensei weapon’s attack/damage.'),
    f(17, 'Unerring Accuracy', 'Reroll a missed kensei-weapon attack once per turn.'),
  ],

  // ---- Paladin ----
  'Oath of Devotion': [
    f(3, 'Channel Divinity: Sacred Weapon / Turn the Unholy', '+CHA to attacks and magical weapon light; turn fiends/undead.'),
    f(7, 'Aura of Devotion', 'You and nearby allies can’t be charmed.'),
    f(15, 'Purity of Spirit', 'Always under a Protection from Evil and Good effect.'),
    f(20, 'Holy Nimbus', 'Emit damaging sunlight and gain advantage vs fiend/undead spells.'),
  ],
  'Oath of Vengeance': [
    f(3, 'Channel Divinity: Abjure Enemy / Vow of Enmity', 'Frighten a foe; advantage on attacks against one target.'),
    f(7, 'Relentless Avenger', 'Move when you hit with an opportunity attack.'),
    f(15, 'Soul of Vengeance', 'Reaction attack against a creature under your Vow.'),
    f(20, 'Avenging Angel', 'Sprout wings, frighten nearby foes.'),
  ],

  // ---- Ranger ----
  'Hunter': [
    f(3, 'Hunter’s Prey', "Colossus Slayer, Giant Killer, or Horde Breaker."),
    f(7, 'Defensive Tactics', 'Escape multiattack, evasive step, or ignore half/three-quarters cover.'),
    f(11, 'Multiattack', 'Volley or Whirlwind Attack.'),
    f(15, 'Superior Hunter’s Defense', 'Reduce damage as a reaction (Uncanny Dodge-like).'),
  ],
  'Gloom Stalker': [
    f(3, 'Dread Ambusher / Umbral Sight', '+initiative and an extra first-round attack; invisible in darkness to darkvision.'),
    f(7, 'Iron Mind', 'Proficiency in Wisdom saves.'),
    f(11, 'Stalker’s Flurry', 'Miss? Make another weapon attack.'),
    f(15, 'Shadowy Dodge', 'Reaction to impose disadvantage on an attacker.'),
  ],
  'Beast Master': [
    f(3, 'Primal Companion', 'A loyal beast that acts on your turn.'),
    f(7, 'Exceptional Training', 'Command your beast as a bonus action; its attacks are magical.'),
    f(11, 'Bestial Fury', 'Your beast attacks twice.'),
    f(15, 'Share Spells', 'Target your beast with spells that target only you.'),
  ],
  'Drakewarden': [
    f(3, 'Summon Draconic Spirit', 'A Small dragon companion (Tiny while not fighting) fights at your side.'),
    f(7, "Dragon's Wrath", 'Extra damage when you and your companion both hit the same target in a turn.'),
    f(11, 'Dragon Rider', 'Your companion grows Large enough to ride and fly.'),
    f(15, 'Climb the Ranks', 'Your companion grows Huge and gains a breath weapon.'),
  ],

  // ---- Rogue ----
  'Thief': [
    f(3, 'Fast Hands / Second-Story Work', 'Use objects/tools as a bonus action; climb at full speed.'),
    f(9, 'Supreme Sneak', 'Advantage on Stealth if you move under half speed.'),
    f(13, 'Use Magic Device', 'Ignore class/level/race requirements on magic items.'),
    f(17, 'Thief’s Reflexes', 'Take two turns during the first combat round.'),
  ],
  'Assassin': [
    f(3, 'Assassinate', 'Advantage vs foes who haven’t acted; auto-crit surprised targets.'),
    f(9, 'Infiltration Expertise', 'Craft a false identity.'),
    f(13, 'Impostor', 'Convincingly mimic another person.'),
    f(17, 'Death Strike', 'Double damage vs a surprised target that fails a CON save.'),
  ],
  'Arcane Trickster': [
    f(3, 'Spellcasting / Mage Hand Legerdemain', 'INT third-caster (mostly enchantment/illusion); a stealthy spectral hand.'),
    f(9, 'Magical Ambush', 'Foes have disadvantage vs your spells if you’re hidden.'),
    f(13, 'Versatile Trickster', 'Use Mage Hand to gain advantage on attacks.'),
    f(17, 'Spell Thief', 'Steal a spell cast at you.'),
  ],

  // ---- Sorcerer ----
  'Draconic Bloodline': [
    f(1, 'Dragon Ancestor / Draconic Resilience', 'A draconic heritage; +1 HP per level and 13 + DEX unarmored AC.'),
    f(6, 'Elemental Affinity', 'Add CHA to one damage type; spend a point for resistance.'),
    f(14, 'Dragon Wings', 'Sprout wings and fly.'),
    f(18, 'Draconic Presence', 'Aura of awe or fear.'),
  ],
  'Wild Magic': [
    f(1, 'Wild Magic Surge / Tides of Chaos', 'Random magic surges; gain advantage once per long rest.'),
    f(6, 'Bend Luck', 'Spend 2 sorcery points to add or subtract 1d4 from a roll.'),
    f(14, 'Controlled Chaos', 'Reroll on the Wild Magic table.'),
    f(18, 'Spell Bombardment', 'Reroll a max damage die and add it.'),
  ],

  // ---- Warlock ----
  'The Fiend': [
    f(1, 'Dark One’s Blessing', 'Gain temp HP when you drop a foe.'),
    f(6, 'Dark One’s Own Luck', 'Add 1d10 to a check or save once per rest.'),
    f(10, 'Fiendish Resilience', 'Choose a damage type to resist.'),
    f(14, 'Hurl Through Hell', 'Banish a creature through the Lower Planes for big damage.'),
  ],
  'The Hexblade': [
    f(1, 'Hexblade’s Curse / Hex Warrior', 'Curse a foe for bonus damage & crits; use CHA for a bonded weapon.'),
    f(6, 'Accursed Specter', 'Raise a slain foe as a spectral servant.'),
    f(10, 'Armor of Hexes', 'The cursed target may miss you entirely.'),
    f(14, 'Master of Hexes', 'Spread your curse when the target dies.'),
  ],
  'The Great Old One': [
    f(1, 'Awakened Mind', 'Telepathy with nearby creatures.'),
    f(6, 'Entropic Ward', 'Reaction to impose disadvantage; gain advantage if it misses.'),
    f(10, 'Thought Shield', 'Resist psychic damage and reflect it.'),
    f(14, 'Create Thrall', 'Charm an incapacitated humanoid indefinitely.'),
  ],

  // ---- Wizard ----
  'School of Evocation': [
    f(2, 'Evocation Savant / Sculpt Spells', 'Copy evocations cheaply; shield allies from your area spells.'),
    f(6, 'Potent Cantrip', 'Cantrips deal half damage even on a save.'),
    f(10, 'Empowered Evocation', 'Add INT mod to evocation damage.'),
    f(14, 'Overchannel', 'Maximize a spell’s damage (with a cost).'),
  ],
  'School of Abjuration': [
    f(2, 'Abjuration Savant / Arcane Ward', 'Copy abjurations cheaply; a damage-absorbing ward.'),
    f(6, 'Projected Ward', 'Shield an ally with your Arcane Ward.'),
    f(10, 'Improved Abjuration', 'Add proficiency to some abjuration checks.'),
    f(14, 'Spell Resistance', 'Advantage on saves vs spells; resistance to spell damage.'),
  ],
  'School of Divination': [
    f(2, 'Divination Savant / Portent', 'Copy divinations cheaply; replace rolls with foreseen d20s.'),
    f(6, 'Expert Divination', 'Regain a lower slot when you cast a divination.'),
    f(10, 'The Third Eye', 'Gain darkvision, see invisibility, and more.'),
    f(14, 'Greater Portent', 'Three Portent rolls per long rest.'),
  ],

  // ---- Artificer ----
  'Alchemist': [
    f(3, 'Experimental Elixir', 'Brew random beneficial elixirs on a rest.'),
    f(5, 'Alchemical Savant', 'Add INT mod to acid/fire/necrotic/poison spell rolls.'),
    f(9, 'Restorative Reagents', 'Elixirs also grant temp HP; cast Lesser Restoration.'),
    f(15, 'Chemical Mastery', 'Resistance to acid & poison; cast Heal and Greater Restoration.'),
  ],
  'Battle Smith': [
    f(3, 'Battle Ready / Steel Defender', 'Use INT for magic weapons; a loyal construct ally.'),
    f(5, 'Extra Attack', 'Attack twice when you take the Attack action.'),
    f(9, 'Arcane Jolt', 'Extra force damage or healing when your weapon/defender hits.'),
    f(15, 'Improved Defender', 'A tougher Steel Defender with a better Deflect Attack.'),
  ],
};

/** The subclass feature granted at a given level, if the subclass is covered. */
export function subclassFeatureAt(subclass: string, level: number): SubclassFeature | undefined {
  const list = SUBCLASS_FEATURES_5E[subclass.trim()];
  return list?.find((x) => x.level === level);
}
