// Rules-term glossary: hover-tooltip descriptions for every term a player
// meets in the character creators (attributes, skills, ancestries/species,
// core concepts). Hindrances, Edges, custom-race traits, classes,
// backgrounds, foci, and packages carry their own `desc` fields in their
// data modules — this file covers everything that was previously just a
// bare name. Text is a concise paraphrase of each game's rules, not a
// verbatim transcription.

import { SKILLS_SWADE, ANCESTRIES_SWADE } from './swade.js';
import { SKILLS_SWN, SPECIES_SWN } from './swn.js';

// ---------- SWADE ----------

const SWADE_ATTRIBUTES: Record<string, string> = {
  Agility: 'Nimbleness, dexterity, and overall physical coordination. Governs Athletics, Fighting, Shooting, Stealth, and most vehicle skills.',
  Smarts: 'Raw intellect, perception, and mental agility. Governs knowledge skills, Notice, Healing, and arcane skills like Spellcasting.',
  Spirit: 'Inner willpower and confidence. Governs social skills like Persuasion and Intimidation, resisting Tests, and recovering from being Shaken.',
  Strength: 'Physical power. Sets melee damage (your Strength die is rolled with the weapon die) and how much you can carry.',
  Vigor: 'Endurance and toughness. Half your Vigor die sets your Toughness, and Vigor rolls resist poison, disease, and fatigue.',
};

const SWADE_SKILLS: Record<string, string> = {
  Academics: 'Knowledge of the liberal arts, social sciences, history, and law.',
  Athletics: 'Climbing, jumping, swimming, throwing, wrestling, and general physical coordination. A core skill everyone starts with at d4.',
  Battle: 'Military strategy and tactics — the commander’s skill in Mass Battles and coordinated actions.',
  Boating: 'Piloting watercraft, from rowboats to sailing ships.',
  'Common Knowledge': 'General knowledge of your world: customs, notable people, geography. A core skill everyone starts with at d4.',
  Driving: 'Operating ground vehicles — cars, trucks, hovercraft.',
  Electronics: 'Operating and manipulating electronic devices and systems — sensors, comms, security panels.',
  Faith: 'The arcane skill for Miracles — casting powers granted by a higher power.',
  Fighting: 'All melee and unarmed combat. Half your Fighting die (+2) sets your Parry — the number enemies must hit in melee.',
  Focus: 'The arcane skill for Gifted characters — activating innate supernatural talents.',
  Gambling: 'Games of chance and reading the table — win money, spot cheats.',
  Hacking: 'Breaking into and manipulating computer systems.',
  Healing: 'Treating Wounds within the Golden Hour, stabilizing the dying, and long-term care.',
  Intimidation: 'Threats and fearsome presence — a Test opposed by the target’s Spirit.',
  Language: 'Fluency in an additional language.',
  Notice: 'Awareness: spotting hidden foes, hearing footsteps, sensing lies. A core skill everyone starts with at d4.',
  Occult: 'Knowledge of supernatural lore, rituals, and creatures of the dark.',
  Performance: 'Singing, acting, dancing, or playing to an audience.',
  Persuasion: 'Convincing others to see things your way; shifts an NPC’s attitude. A core skill everyone starts with at d4.',
  Piloting: 'Flying aircraft and spacecraft.',
  Psionics: 'The arcane skill for psionicists — activating powers of the mind.',
  Repair: 'Fixing gadgets, vehicles, and machines.',
  Research: 'Digging facts out of libraries, archives, and the net.',
  Riding: 'Riding and controlling mounts, in and out of combat.',
  Science: 'Knowledge of the hard sciences: biology, chemistry, physics, engineering theory.',
  Shooting: 'All ranged weapons: bows, pistols, rifles, vehicle-mounted guns.',
  Spellcasting: 'The arcane skill for Magic — casting spells with arcane formulae.',
  Stealth: 'Moving unseen and unheard; palming objects. A core skill everyone starts with at d4.',
  Survival: 'Tracking, foraging, and staying alive in the wilds.',
  Taunt: 'Insults and mockery that rattle a foe — a Test opposed by the target’s Smarts.',
  Thievery: 'Picking locks and pockets, sleight of hand, and disabling traps.',
  'Weird Science': 'The arcane skill for mad inventors — powers built into strange devices.',
};

const SWADE_ANCESTRIES: Record<string, string> = {
  Human: 'Versatile and ambitious. Humans begin with a free Edge of their choice (this wizard grants Adaptable: once per session, re-roll a Trait roll).',
  Android: 'Constructed beings: tireless, logical, and unliving — they don’t breathe, eat, or suffer disease, but healing them takes Repair, not medicine.',
  Aquarian: 'Amphibious folk of the deep: at home underwater, tough in the crush of the depths, but dependent on regular immersion.',
  Avion: 'Winged humanoids: they fly, and hollow bones keep them light — and fragile.',
  Dwarf: 'Stout mountain folk: slow of Pace but tough as stone, with low-light vision from a life underground.',
  Elf: 'Graceful and long-lived, agile beyond human measure, with keen low-light vision — but slighter of build.',
  'Half-Elf': 'Caught between two worlds: inherits a measure of elven grace and human adaptability.',
  'Half-Folk': 'Small, lucky, and unassuming — hard to hit and harder to demoralize, but weaker of limb.',
  Rakashan: 'Feline humanoids: quick, with natural claws and low-light hunter’s eyes; their bloodlust is infamous.',
  Saurian: 'Reptilian warriors: scaled hide for natural armor and a keen predator’s senses, but cold-blooded in the chill.',
};

const SWADE_CONCEPTS: Record<string, string> = {
  Size: 'How big it is, and the whole Size Table in one number. Size IS the Toughness bonus. It also sets the Scale band — Tiny −6, Very Small −4, Small −2, Normal 0, Large +2, Huge +4, Gargantuan +6 — and when two different Scales fight, the smaller adds the difference to its attacks and the larger subtracts it. Large and up carry extra Wounds. 0 is an adult human.',
  'Wound cap': 'How many Wounds this creature carries before it is Incapacitated. Blank (0) derives it: three for a Wild Card, none for an Extra — who drops at the first Wound — plus Size (Large +1, Huge +2, Gargantuan +3). Set a number to override that outright, for a boss who should simply take more punishment than its Size says.',
  Cover: 'Cover this character has that the MAP cannot see — furniture, a crowd, a raised shield. Light −2, Medium −4, Heavy −6, Near Total −8, applied to melee and ranged attacks against them. The map keeps working out its own cover from walls; an attack uses whichever of the two protects the target more, so claiming light here never strips away medium cover the map can see.',
  'Wild Card': 'A hero or major character: rolls a d6 Wild Die alongside every Trait roll (keep the better), takes three Wounds before going down, and holds Bennies.',
  'Wild Die': 'The extra d6 Wild Cards roll with every Trait roll — keep the higher of the two dice. Both dice can ace (explode).',
  Benny: 'A fate chip. Spend one to re-roll a Trait roll, Soak damage, recover from Shaken, or draw a new Action Card. You start each session with three.',
  Bennies: 'Fate chips. Spend one to re-roll a Trait roll, Soak damage, recover from Shaken, or draw a new Action Card. You start each session with three.',
  Hindrance: 'A character flaw you choose for points: up to 2 Minor (1 point each) and 1 Major (2 points), spent on funds, attribute or skill points, or Edges.',
  Edge: 'A special talent or knack that bends the rules in your favor — bought at creation with Hindrance points, or earned through Advances.',
  Trait: 'Any attribute or skill. A Trait roll is that die (plus your Wild Die if you’re a Wild Card) against Target Number 4; every 4 over is a raise.',
  Pace: 'How many inches (tabletop) you move on your turn — 6 for most characters. Roll your Running die as a free action to move farther.',
  Parry: '2 plus half your Fighting die, plus shield and weapon modifiers — the Target Number enemies must hit you in melee.',
  Toughness: '2 plus half your Vigor die, plus Armor — the number damage rolls must beat to Shake or Wound you.',
  'Running Die': 'The die you roll and add to Pace when you run (d6 for most). Running is a free action.',
  'Power Points': 'The energy pool that fuels powers. Each power costs its listed Points to activate; they recover with rest.',
  Rank: 'Experience tier — Novice, Seasoned, Veteran, Heroic, Legendary. Advances raise it, and higher-Rank Edges and powers unlock as you climb.',
  Ancestry: 'Your species or folk. Each grants racial abilities — pick a preset or build one from racial trait points.',
  'Starting funds': 'Cash for gear: $500 by default. Spend it after creation from your sheet’s + Compendium button.',
};

const TERMS_SWADE: Record<string, string> = {
  ...SWADE_ATTRIBUTES, ...SWADE_SKILLS, ...SWADE_ANCESTRIES, ...SWADE_CONCEPTS,
};

// ---------- SWN ----------

const SWN_ATTRIBUTES: Record<string, string> = {
  Strength: 'Raw muscle: melee and thrown-weapon punch, carrying capacity, and feats of might.',
  Dexterity: 'Speed and coordination: ranged accuracy, Armor Class, and initiative.',
  Constitution: 'Health and stamina: bonus hit points every level and resistance to physical trauma.',
  Intelligence: 'Learning and reason: technical skills, memory, and analysis.',
  Wisdom: 'Perception and judgment: noticing danger, willpower, and Mental saving throws.',
  Charisma: 'Presence and leadership: winning people over, commanding loyalty, striking deals.',
};

const SWN_SKILLS: Record<string, string> = {
  Administer: 'Run organizations: bureaucracy, logistics, law, and management.',
  Connect: 'Find people who can help — contacts, favors, and knowing who to ask.',
  Exert: 'Athletics: climbing, swimming, running, throwing, and feats of endurance.',
  Fix: 'Repair and build devices, vehicles, and structures; jury-rig solutions.',
  Heal: 'Treat wounds, cure diseases, and stabilize the dying with medicine or psionics-adjacent tech.',
  Know: 'Academic and scientific knowledge: history, the sciences, and planetary lore.',
  Lead: 'Inspire and command others — keeping NPCs loyal and coordinated under fire.',
  Notice: 'Spot hidden things, read people, and stay alert to ambushes.',
  Perform: 'Artistic expression: music, acting, oratory, and dance.',
  Pilot: 'Fly or drive anything — from gravcars to starships.',
  Program: 'Code, hack, and operate computerized systems.',
  Punch: 'Unarmed combat: fists, kicks, and martial arts.',
  Shoot: 'Ranged combat: pistols, rifles, energy weapons, and heavy guns.',
  Sneak: 'Stealth, disguise, lockpicking, and sleight of hand.',
  Stab: 'Melee combat with weapons: knives, blades, clubs, and spears.',
  Survive: 'Endure the wilds: tracking, foraging, shelter, and hazard sense.',
  Talk: 'Persuade, deceive, and negotiate face to face.',
  Trade: 'Buy low, sell high: commerce, smuggling, and appraising goods.',
  Work: 'A profession’s craft — farming, mining, manufacturing, or any honest trade.',
  Biopsionics: 'Psychic discipline: mend flesh, purge toxins, and reshape living bodies.',
  Metapsionics: 'Psychic discipline: shape psychic energy itself — boost, suppress, or disrupt other powers.',
  Precognition: 'Psychic discipline: glimpse the future — sense danger and divine outcomes.',
  Telekinesis: 'Psychic discipline: move and strike objects with pure mental force.',
  Telepathy: 'Psychic discipline: read thoughts, link minds, and dominate the unwilling.',
  Teleportation: 'Psychic discipline: cross space in a blink, alone or with company.',
};

const SWN_SPECIES: Record<string, string> = {
  Human: 'Baseline humanity — the vast majority of the settled galaxy after the Scream.',
  Android: 'Human-shaped robots with human-level minds; some pass unnoticed among true humans.',
  'VI (True AI)': 'A Virtual Intelligence: a self-aware artificial mind riding a chassis or mainframe core.',
  'Uplifted Bioform': 'An animal lineage engineered up to sapience — moddable, loyal, and often underestimated.',
  'Alien Sophont': 'A member of a nonhuman starfaring species, with a physiology and psychology all their own.',
  Transhuman: 'Humanity upgraded: gene-lines and augments pushed past the baseline into something new.',
};

const SWN_CONCEPTS: Record<string, string> = {
  Class: 'Your calling: Warriors fight, Experts master skills, Psychics wield mental powers, and Adventurers blend two of those callings.',
  Background: 'Where you came from before the stars — grants a free level-0 skill that reflects that life.',
  Focus: 'A specialty talent (like a feat): grants a skill and a unique ability, growing stronger at level 2.',
  'Skill points': 'Spent to raise skills. Level-0 is competent, level-1 professional; higher levels come with experience.',
  Attributes: 'Rolled 3d6 each, straight down. 14+ gives a +1 modifier, 18 a +2; 7 or less takes penalties.',
  HP: 'Hit points: your capacity to keep fighting. At zero you’re down and dying without swift aid.',
  AC: 'Armor Class: the roll an attacker must meet or beat to hit you — set by armor worn plus Dexterity.',
  Effort: 'A psychic’s power reserve: committed to fuel disciplines, returned when powers end or after rest.',
  'Equipment package': 'A ready-made loadout of weapons, armor, and gear so you can skip line-item shopping.',
  Credits: 'The interstellar currency. Spend them after creation from your sheet’s + Compendium button.',
  Homeworld: 'The world that raised you — pure flavor here, but a hook your GM can build on.',
  Species: 'Your origin stock. Mechanically neutral in this wizard — the flavor drives roleplay and GM rulings.',
};

const SWN_SHEET: Record<string, string> = {
  'Attack bonus': 'Your class attack bonus, added to every attack roll (1d20 + attack bonus + skill + modifier vs the target’s AC).',
  'Hit bonus': 'A bonus specific to this weapon, on top of your class attack bonus.',
  Shock: 'Damage a weapon inflicts even on a miss, against targets whose AC is at or below its shock threshold.',
  'Shock vs AC ≤': 'The highest AC that still takes this weapon’s shock damage on a miss.',
  'Ammo left': 'Rounds remaining in the magazine. Firing spends one; at zero the weapon can’t fire until reloaded.',
  'Mag size': 'The weapon’s full magazine — what a reload refills it to.',
  'Reload item': 'The inventory item a reload consumes (a Spare Magazine or a Type A Cell).',
  Effort: 'A psychic’s reserve of power. Committed to activate disciplines, and returned when the power ends or the scene closes.',
  'Max Effort': 'Your Effort capacity: 1 + the best of your highest psychic skill, Wisdom modifier, or Constitution modifier.',
  Committed: 'Effort currently spent on active powers — unavailable until those powers end.',
  'System strain': 'Physical toll from cyberware, psychic mishaps, and hard healing. At your maximum you can take no more.',
  Implant: 'Installed cyberware. Each implant costs System Strain but grants a permanent benefit.',
  'Init bonus': 'Added to your initiative roll (1d8 + Dexterity modifier + bonuses).',
  Physical: 'The Physical saving throw — resisting poison, disease, and bodily trauma. Roll d20 at or above the target number.',
  Evasion: 'The Evasion saving throw — dodging blasts, traps, and area effects. Roll d20 at or above the target number.',
  Mental: 'The Mental saving throw — resisting psychic intrusion, fear, and mind-affecting effects. Roll d20 at or above the target number.',
  Discipline: 'The psychic discipline a power belongs to — you must be trained in it to use the power.',
  Enc: 'Encumbrance: how much this item weighs against your carrying capacity (6 + 3 × Strength modifier).',
  Carried: 'Total encumbrance you’re hauling right now.',
  Capacity: 'How much you can carry before being slowed: 6 + 3 × your Strength modifier.',
  'Effective AC': 'Your final Armor Class after worn armor, natural armor, shields, and gear bonuses — what attackers actually roll against.',
  Credits: 'The interstellar currency. Spend them in shops or via the compendium.',
  Goal: 'What your character is chasing — a hook for your GM to build on.',
  STR: 'Strength — melee punch, carrying capacity, and feats of might.',
  DEX: 'Dexterity — ranged accuracy, Armor Class, and initiative.',
  CON: 'Constitution — bonus hit points per level and physical resilience.',
  INT: 'Intelligence — technical skills, memory, and analysis.',
  WIS: 'Wisdom — perception, willpower, and Mental saves.',
  CHA: 'Charisma — presence, leadership, and winning people over.',
  Attribute: 'Which of the six attributes this skill rolls with — its modifier is added to the check.',
  Armor: 'Worn protection. Equipping an armor row sets your Armor Class from its value.',
  'AC bonus': 'A flat bonus this item or implant adds to your Armor Class.',
  'Save bonus': 'A flat bonus this item adds to your saving throws while equipped.',
  Save: 'Which saving throw resists this effect: Physical, Evasion, or Mental. Roll d20 at or above the target number.',
  Skill: 'A trained ability. Level-0 is competent and level-1 professional; the die is 2d6 + level + attribute modifier.',
  Weapon: 'A weapon you can attack with — use it from the Actions list to target a foe on the map.',
  Power: 'A psychic power. Activating it commits Effort and rolls its discipline’s skill check.',
  Level: 'Your character level: it drives hit points, attack bonus, and skill points.',
  Remaining: 'Effort still available to commit to new powers.',
  XP: 'Experience points earned from adventuring — they drive your level-ups.',
  'Adventurer: 2nd class': 'An Adventurer blends two callings — pick the second class whose perks you also gain.',
};

const TERMS_SWN: Record<string, string> = {
  ...SWN_ATTRIBUTES, ...SWN_SKILLS, ...SWN_SPECIES, ...SWN_CONCEPTS, ...SWN_SHEET,
};

// ---------- SWADE sheet-only labels ----------

const SWADE_SHEET: Record<string, string> = {
  Wounds: 'Injuries taken. Each Wound is −1 to every trait roll (max −3); a fourth takes a Wild Card out of the fight.',
  Fatigue: 'Exhaustion from strain, poison, or cold. Each level is −1 to trait rolls; two levels leave you Incapacitated.',
  'Wound/Fatigue penalty': 'The running total your Wounds and Fatigue subtract from every trait roll — applied automatically.',
  'Weight carried': 'Everything on your sheet that has a weight, times how many you carry — gear, weapons and armour together.',
  'Weight capacity': 'What your Strength carries for free: d4 20 lbs, d6 40, d8 60, d10 80, d12 100, and +20 per step beyond d12. Four times this is the absolute most you can lift or carry.',
  Load: 'Whether the weight you carry has become a problem. Past your capacity you are Encumbered: −2 to Pace (minimum 1), running, Agility and its linked skills, and to Vigor rolls made to resist Fatigue.',
  Encumbered: 'Carrying more than your Strength allows: −2 to Pace (minimum 1), running, Agility and all linked skills, and to Vigor rolls made to resist Fatigue.',
  Advances: 'Earned improvements. Every Advance raises a skill, an attribute, or grants a new Edge; four Advances raise your Rank.',
  'Arcane Background': 'The source of your powers — Magic, Miracles, Psionics, Weird Science, or Gifted. It sets your arcane skill.',
  'Arcane skill': 'The skill you roll to activate powers: Spellcasting, Faith, Psionics, Weird Science, or Focus.',
  AP: 'Armor Piercing: this much of the target’s armor is ignored when the attack hits.',
  'Parry mod': 'This weapon’s effect on your Parry while wielded — a Rapier adds +1, a Great Sword subtracts 1.',
  Wielded: 'Check while this weapon is in hand: its Parry modifier applies and Smite can enhance its damage.',
  'Armor vs ranged': 'Extra armor that counts only against ranged attacks — a Medium or Large Shield’s +2.',
  'Toughness vs ranged': 'Your effective Toughness against ranged attacks, including any shield bonus.',
  'Ammo left': 'Shots remaining. Firing spends one; at zero the weapon can’t fire until reloaded.',
  RoF: 'Rate of Fire. RoF 2+ weapons fire bursts: −2 Recoil on the attack, an extra round of damage on a raise, and ammo drains by the RoF table (2→5, 3→10, 4→20, 5→40, 6→50 rounds per attack).',
  Caliber: 'The ammunition type this weapon chambers (or this ammo feeds): arrows, bolts, bullets small/medium/large, laser batteries, shot, shells, slugs, stones. Match the gun to its rounds.',
  Mag: 'Magazine capacity — what a Reload refills Ammo left to. Reloading is an action (it counts toward the Multi-Action penalty).',
  'Running die': 'The die added to your Pace when you run — d6 for most characters. Running is a free action.',
  'Boosts trait': 'While equipped, this item adds its bonus to the named skill or attribute roll.',
  'Affects trait': 'The skill or attribute this Hindrance modifies — its penalty folds into that roll automatically.',
  'Resisted by': 'The trait the target rolls to resist this power. Success negates or halves the effect.',
  'On success': 'What happens when the target resists: the effect is negated entirely, or damage is halved.',
  Severity: 'Minor Hindrances are worth 1 build point, Major ones 2 — and Major flaws bite harder in play.',
  Concept: 'A one-line summary of who your character is — pure flavor, but it anchors everything else.',
  'Currency ($)': 'Your cash on hand for buying gear.',
  Unskilled: 'Rolling a trait you have no die in: d4−2 instead of your usual die.',
  HP: 'A simplified hit-point pool standing in for the wound track — damage subtracts from it directly.',
  PP: 'Power Points: the pool that fuels your powers. Each power costs its listed Points to activate.',
  'Max HP': 'The top of your hit-point pool — what healing restores you toward.',
  Die: 'The trait die you roll for this skill: d4 through d12. Bigger is better, and the die aces (explodes) on its max.',
  Skill: 'A trained ability, rated as a die from d4 to d12. Untrained skills roll d4−2 instead.',
  Weapon: 'A weapon you can attack with — use it from the Actions list to target a foe on the map.',
  Power: 'A power fueled by Power Points. Activating it rolls your arcane skill against target number 4.',
  Armor: 'Protective gear. Worn armor adds to your Toughness; shields add to Parry instead.',
  'Armor (+Toughness)': 'How much this armor adds to your Toughness while worn.',
  'Armor (+2 Toughness)': 'The Armor power: while maintained, it grants +2 Toughness. Toggle it on for the duration.',
  'Protection (+2 Toughness)': 'The Protection power: while maintained, it grants +2 Toughness. Toggle it on for the duration.',
  'Deflection (+2 Parry)': 'The Deflection power: attacks against you suffer −2, tracked here as +2 Parry while maintained.',
  'Smite (+2 wielded dmg)': 'The Smite power: your wielded weapon deals +2 damage while maintained.',
  Duration: 'How long the power lasts. A bare number is a count of rounds and gets clocked automatically when you cast it; 10m, 1H, Instant and Special are left to the table.',
  'Rounds left': 'Rounds this power has still to run, counting the current one. It drops at the end of each of your turns and the power falls off at zero.',
  'PP/round': 'Power Points to hold the power open for another round. Deducted by hand — the countdown is automatic, the upkeep is yours to pay.',
};

// ---------- D&D 5e ----------

const DND_ABILITIES: Record<string, string> = {
  STR: 'Strength — raw physical power. Sets melee attack and damage, Athletics, and carrying capacity.',
  DEX: 'Dexterity — agility and reflexes. Sets Armor Class, initiative, ranged attacks, and finesse weapons.',
  CON: 'Constitution — health and stamina. Adds hit points every level and resists poison and exhaustion.',
  INT: 'Intelligence — reasoning and memory. Powers wizard spellcasting and knowledge skills.',
  WIS: 'Wisdom — perception and insight. Powers cleric and druid spellcasting, Perception, and Insight.',
  CHA: 'Charisma — force of personality. Powers bard, sorcerer, warlock, and paladin magic and all social skills.',
};

const DND_SKILLS: Record<string, string> = {
  Acrobatics: 'Dexterity — balance, tumbling, and staying on your feet in a tricky spot.',
  'Animal Handling': 'Wisdom — calming, driving, or reading the intentions of animals.',
  Arcana: 'Intelligence — recalling lore about spells, magic items, and planes of existence.',
  Athletics: 'Strength — climbing, jumping, swimming, and grappling.',
  Deception: 'Charisma — convincing lies, disguises, and misleading a mark.',
  History: 'Intelligence — recalling past events, legends, kingdoms, and wars.',
  Insight: 'Wisdom — reading body language to sense a lie or true intention.',
  Intimidation: 'Charisma — threats, hostile displays, and forcing cooperation through fear.',
  Investigation: 'Intelligence — searching for clues and making deductions from evidence.',
  Medicine: 'Wisdom — stabilizing the dying and diagnosing illness.',
  Nature: 'Intelligence — knowledge of terrain, plants, animals, and weather.',
  Perception: 'Wisdom — spotting, hearing, or otherwise noticing something.',
  Performance: 'Charisma — delighting an audience with music, dance, acting, or storytelling.',
  Persuasion: 'Charisma — influencing others with tact, social grace, or good nature.',
  Religion: 'Intelligence — knowledge of deities, rites, holy symbols, and cults.',
  'Sleight of Hand': 'Dexterity — pickpocketing, palming objects, and manual trickery.',
  Stealth: 'Dexterity — hiding, moving silently, and escaping notice.',
  Survival: 'Wisdom — tracking, foraging, navigating, and predicting the weather.',
};

const DND_CONCEPTS: Record<string, string> = {
  AC: 'Armor Class: the number an attack roll must meet or beat to hit you. Set by armor, Dexterity, and shields.',
  'Base AC': 'The armor’s own AC value before Dexterity and other bonuses are added.',
  'Effective AC': 'Your final Armor Class after armor, Dexterity, shields, and item bonuses — what attackers actually roll against.',
  'Add Dex': 'Whether this armor adds your Dexterity modifier to AC (light: full, medium: capped, heavy: none).',
  HP: 'Hit points: how much damage you can take. At 0 you fall unconscious and start making death saving throws.',
  'Max HP': 'Your hit point maximum — the full total you heal back up to.',
  'Temp HP': 'Temporary hit points: a buffer spent before real HP. They don’t stack and don’t heal you.',
  'Hit Dice': 'Dice spent on a short rest to heal — one per level, sized by your class.',
  Initiative: 'A d20 + Dexterity modifier roll that sets turn order at the start of combat.',
  Proficiency: 'Your proficiency bonus (+2 at level 1, rising to +6) added to attacks, saves, and skills you’re trained in.',
  Inspiration: 'A GM-granted reward: spend it to roll one d20 with advantage.',
  'Death Saves ✓': 'Successful death saving throws. Three successes stabilize you at 0 HP.',
  'Death Saves ✗': 'Failed death saving throws. Three failures and your character dies.',
  'Save DC': 'The number a target must beat on their saving throw to resist your effect.',
  'Spell Attack': 'Your bonus for spells that require an attack roll: proficiency + spellcasting ability.',
  'Passive Perc.': 'Passive Perception: 10 + your Perception bonus. The GM compares it against hidden things without a roll.',
  'Spellcasting Class': 'Which class’s spellcasting rules you use — it sets your spell slots and casting ability.',
  Prep: 'Whether this spell is currently prepared and therefore castable.',
  'Conc.': 'Concentration: this spell ends if you cast another concentration spell or fail a Constitution save after taking damage.',
  Alignment: 'Your moral and ethical outlook, from Lawful Good to Chaotic Evil.',
  Background: 'Your life before adventuring — grants skill proficiencies, tools, and a roleplaying feature.',
  Race: 'Your ancestry: elf, dwarf, human, and so on. It grants ability bonuses, speed, and racial traits.',
  Subclass: 'Your class specialization, chosen as you level — it grants the features that most define your build.',
  'Fighting Style': 'A combat specialization (Archery, Defense, Dueling…) that grants a passive bonus.',
  XP: 'Experience points earned from adventuring — they drive your level-ups.',
  'Divine Smite': 'A paladin’s signature strike: spend a spell slot on a melee hit for a burst of radiant damage.',
  'Unarmed Strike': 'Attacking with fists, feet, or head — a monk’s Martial Arts die makes it a real weapon.',
};

const DND_SHEET: Record<string, string> = {
  Ability: 'Which ability score this roll keys off — its modifier is added to the total.',
  'Atk bonus': 'The total added to this weapon’s attack roll: ability modifier plus proficiency if you’re trained.',
  'AC bonus': 'A flat bonus this item adds to your Armor Class while equipped.',
  'Save bonus': 'A flat bonus this item adds to all your saving throws while equipped.',
  Save: 'A saving throw: d20 + ability modifier (+ proficiency if proficient) against the effect’s DC.',
  'Rider save': 'An extra saving throw the target makes after being hit, to resist a tacked-on condition.',
  'Rider DC': 'The DC for that follow-up save.',
  'Area width ft': 'How wide the area is — used by lines and cones.',
  Armor: 'Worn protection. Equipping a body armor sets your AC from its base value plus any allowed Dexterity.',
  'Max Dex': 'The most Dexterity modifier this armor lets you add to AC (−1 means no limit).',
  Class: 'Your character class — it drives hit dice, proficiencies, spellcasting, and your feature progression.',
  Level: 'Your character level: it sets proficiency bonus, hit points, spell slots, and class features.',
  Lvl: 'The spell’s level. Casting it spends a slot of that level or higher; level 0 means a cantrip.',
  PP: 'Platinum pieces — worth 10 gold each.',
  GP: 'Gold pieces — the standard coin of the realm.',
  EP: 'Electrum pieces — worth half a gold each.',
  SP: 'Silver pieces — ten to the gold.',
  CP: 'Copper pieces — a hundred to the gold.',
  'Personality Traits': 'Small habits and mannerisms that make your character feel like a person.',
  Ideals: 'The beliefs and principles your character will not compromise.',
  Bonds: 'The people, places, and things your character is tied to.',
  Flaws: 'The weakness, vice, or fear that gets your character into trouble.',
  Backstory: 'Where your character came from and what brought them to adventuring.',
  'Proficiencies & Languages': 'Tools, weapons, armor, and tongues your character has trained in.',
};

const SPELL_SLOT_DESC = 'Spell slots of this level. Casting a leveled spell spends one; they come back on a long rest.';
for (let lvl = 1; lvl <= 9; lvl++) DND_SHEET[`L${lvl}`] = SPELL_SLOT_DESC;

const TERMS_5E: Record<string, string> = { ...DND_ABILITIES, ...DND_SKILLS, ...DND_CONCEPTS, ...DND_SHEET };

// ---------- terms every system's sheet shares ----------

const COMMON: Record<string, string> = {
  Resistances: 'Damage types you take half damage from — list them comma-separated (e.g. "fire, cold").',
  Vulnerabilities: 'Damage types you take double damage from.',
  Immunities: 'Damage types that don’t affect you at all.',
  'Dmg type': 'The kind of damage dealt — it interacts with the target’s resistances, vulnerabilities, and immunities.',
  'Range ft': 'How far away this can reach, in feet. Targets beyond it can’t be picked.',
  'Area ft': 'The size of the area template this effect covers.',
  'Vision range': 'How far this character can see in normal light, in hexes.',
  Darkvision: 'How far this character sees in darkness, in hexes, when normal sight fails.',
  'Low-light / IR': 'How far this character sees in darkness, in hexes, when normal sight fails.',
  'Low-light / infravision': 'How far this character sees in darkness, in hexes, when normal sight fails.',
  Equipped: 'Check to wear or wield this item — only equipped gear applies its bonuses.',
  Worn: 'Check while this armor is worn — only worn armor contributes to your defense.',
  Shield: 'A shield adds to your defense while worn, on top of body armor.',
  Speed: 'How far this character moves on their turn.',
  'Forces save': 'The saving throw the target rolls against this effect instead of you rolling to hit.',
  'On save': 'What a successful save does: halve the damage, or negate the effect entirely.',
  Inflicts: 'A status condition applied to the target when this effect lands.',
  Concentration: 'Maintaining an ongoing effect. Starting a new one ends the old, and damage can break it.',
  Damage: 'The dice rolled for damage when this hits — the server rolls them and applies the result.',
  Amount: 'How much this heals or harms: a dice expression like 2d6, or a flat number.',
  Effect: 'What using this does — deal damage, heal, or nothing mechanical.',
  Area: 'The template this effect covers: a sphere, cone, line, or cube aimed on the map.',
  Weight: 'How heavy this item is, counting against what you can carry.',
};

/** Labels that are pure flavor or UI plumbing rather than rules terms —
 *  they intentionally have no tooltip. Exported so the coverage test can
 *  assert that everything *else* is documented. */
export const NON_RULES_LABELS = new Set(
  ['+', '±', 'Age', 'Appearance', 'Description', 'Detail / portrait', 'Eyes', 'Hair', 'Height',
    'Item', 'Name', 'Notes', 'Notes (RoF…)', 'Profile / Bio (public-facing)', 'Qty', 'Skin',
    'Source', 'Token colour', 'Token image', 'Type', 'Use',
  ].map((s) => s.toLowerCase()),
);

// ---------- lookup ----------

type GlossarySystem = 'dnd5e' | 'swn' | 'swade';

function lowerMap(...sets: Array<Record<string, string>>): Map<string, string> {
  const m = new Map<string, string>();
  for (const set of sets) for (const [k, v] of Object.entries(set)) m.set(k.toLowerCase(), v);
  return m;
}

const LOWER: Record<GlossarySystem, Map<string, string>> = {
  swade: lowerMap(COMMON, TERMS_SWADE, SWADE_SHEET),
  swn: lowerMap(COMMON, TERMS_SWN),
  dnd5e: lowerMap(COMMON, TERMS_5E),
};

/** Case-insensitive glossary lookup. Returns undefined for unknown terms so
 *  callers can render plain text instead of an empty tooltip. */
export function termDesc(system: GlossarySystem, term: string): string | undefined {
  return LOWER[system]?.get(term.trim().toLowerCase());
}

/**
 * Glossary lookup for a *sheet label*, which often decorates the bare term
 * with units or a reminder — "Toughness (incl. armor)", "HP (current)",
 * "Wounds (0–3)", "Notes (RoF…)", "Max PP". Tries the label as written,
 * then progressively simpler forms, so schemas don't have to be rewritten
 * to match glossary keys.
 */
export function sheetTermDesc(system: GlossarySystem, label: string): string | undefined {
  for (const candidate of labelCandidates(label)) {
    const hit = termDesc(system, candidate);
    if (hit) return hit;
  }
  return undefined;
}

function labelCandidates(label: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(label);
  // "Toughness (incl. armor)" -> "Toughness"; "HP (current)" -> "HP"
  push(label.replace(/\s*\([^)]*\)\s*/g, ' '));
  for (const base of [...out]) {
    push(base.replace(/[…:.]+$/, ''));           // "Notes…" -> "Notes"
    push(base.replace(/\s*\(.*$/, ''));           // unclosed paren
  }
  for (const base of [...out]) {
    const max = /^max\s+(.+)$/i.exec(base);       // "Max PP" -> "PP"
    if (max) push(max[1]);
  }
  return out;
}

/** Every SWADE skill/ancestry/attribute name must have a glossary entry —
 *  exported for the completeness test. */
export function glossaryCoverage(): { missingSwade: string[]; missingSwn: string[] } {
  const missingSwade = [
    ...SKILLS_SWADE.filter((s) => !termDesc('swade', s)),
    ...ANCESTRIES_SWADE.filter((a) => !termDesc('swade', a)),
  ];
  const missingSwn = [
    ...SKILLS_SWN.filter((s) => !termDesc('swn', s)),
    ...SPECIES_SWN.filter((s) => !termDesc('swn', s)),
  ];
  return { missingSwade, missingSwn };
}
