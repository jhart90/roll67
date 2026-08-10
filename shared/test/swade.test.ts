import { describe, expect, it } from 'vitest';
import { dieSides, gangUpBonus, swade, swadePace, swadeParry, swadeRangedArmor, swadeToughness, traitExpr, woundPenalty } from '../src/systems/swade.js';
import { combatActions } from '../src/systems/combat.js';
import { swadeWoundsHealed } from '../src/systems/swadeDamage.js';
import { canTakeHindrance, hindrancePoints } from '../src/systems/swadeCreation.js';
import { blocksMovement, combatResources, conditionsFor } from '../src/systems/effects.js';
import { generateNpc } from '../src/data/npcGen.js';
import { NPCS_SWADE } from '../src/data/npcsSwade.js';
import { applyEntry, contentForSystem } from '../src/data/compendium.js';
import { roll, seededRng } from '../src/dice/roller.js';
import type { Character } from '../src/types.js';

describe('SWADE sheet', () => {
  it('default sheet starts with the five core skills at d4 and Wild Card on', () => {
    const sheet = swade.defaultSheet();
    expect(sheet.wildCard).toBe(true);
    expect(sheet.bennies).toBe(3);
    const skills = sheet.skills as Array<{ name: string; die: string }>;
    expect(skills.map((s) => s.name)).toEqual(['Athletics', 'Common Knowledge', 'Notice', 'Persuasion', 'Stealth']);
    expect(skills.every((s) => s.die === 'd4')).toBe(true);
  });

  it('dieSides parses trait dice', () => {
    expect(dieSides('d4')).toBe(4);
    expect(dieSides('D12')).toBe(12);
    expect(dieSides('')).toBe(0);
    expect(dieSides('nope')).toBe(0);
  });

  it('Parry = 2 + half Fighting die + shields; 2 flat when untrained', () => {
    const untrained = swade.defaultSheet();
    expect(swadeParry(untrained)).toBe(2);
    const fighter = {
      ...swade.defaultSheet(),
      skills: [{ name: 'Fighting', die: 'd8' }],
      armor: [{ name: 'Medium Shield', armor: 0, parryBonus: 2, equipped: true }],
    };
    expect(swadeParry(fighter)).toBe(2 + 4 + 2);
  });

  it('Toughness = 2 + half Vigor die + equipped armor', () => {
    const sheet = {
      ...swade.defaultSheet(), vigor: 'd10',
      armor: [
        { name: 'Chain Mail', armor: 3, parryBonus: 0, equipped: true },
        { name: 'Stashed Plate', armor: 4, parryBonus: 0, equipped: false },
      ],
    };
    expect(swadeToughness(sheet)).toBe(2 + 5 + 3);
  });

  it('derived ac is Parry (the combat engine targets it)', () => {
    const sheet = { ...swade.defaultSheet(), skills: [{ name: 'Fighting', die: 'd10' }] };
    expect(swade.derive(sheet).ac).toBe(7);
    expect(swade.derive(sheet).parry).toBe(7);
  });

  it('Wild Card trait rolls use best(trait!, wild d6!); Extras roll the trait die alone', () => {
    const wild = { ...swade.defaultSheet(), agility: 'd8' };
    expect(traitExpr(wild, 8)).toBe('best(1d8!, 1d6!)');
    const extra = { ...swade.defaultSheet(), wildCard: false };
    expect(traitExpr(extra, 8)).toBe('1d8!');
  });

  it('wounds and fatigue subtract from every trait roll', () => {
    const hurt = { ...swade.defaultSheet(), wounds: 2, fatigue: 1 };
    expect(woundPenalty(hurt)).toBe(-3);
    expect(traitExpr(hurt, 8)).toBe('best(1d8!, 1d6!)-3');
    const rolls = swade.rollables(hurt);
    expect(rolls.find((r) => r.id === 'trait_agility')?.expr).toContain('-3');
  });

  it('unskilled rolls are d4−2, and a Wild Card still throws its Wild Die', () => {
    // The −2 is a penalty on the roll, so it applies to both arms.
    expect(traitExpr(swade.defaultSheet(), 0)).toBe('best(1d4!-2, 1d6!-2)');
    const extra = { ...swade.defaultSheet(), wildCard: false };
    expect(traitExpr(extra, 0)).toBe('1d4!-2');
    // Wounds stack on top of the unskilled penalty.
    const hurt = { ...swade.defaultSheet(), wounds: 1 };
    expect(traitExpr(hurt, 0)).toBe('best(1d4!-2, 1d6!-2)-1');
  });

  it('an attack whose skill is missing from the sheet keeps the Wild Die', () => {
    // Regression: the unskilled branch used to drop the Wild Die entirely, so
    // any action driven by a skill the character had not bought rolled a lone
    // d4−2 instead of best(d4−2, d6−2).
    const sheet = {
      ...swade.defaultSheet(),
      skills: [{ name: 'Fighting', die: 'd8' }],
      attacks: [
        { name: 'Sword', skill: 'Fighting', damage: '1d8!+1d6!', range: 5 },
        { name: 'Whip', skill: 'Athletics', damage: '1d8!+1d4!', range: 5 },
      ],
    };
    const rolls = swade.rollables(sheet);
    expect(rolls.find((r) => r.id === 'attack_0')?.expr).toBe('best(1d8!, 1d6!)');
    expect(rolls.find((r) => r.id === 'attack_1')?.expr).toBe('best(1d4!-2, 1d6!-2)');
    // ...and the same holds for the action the sheet hands to the combat engine.
    const character = { id: 'c1', name: 'Test', system: 'swade', sheet } as unknown as Character;
    const acts = combatActions(character);
    expect(acts.find((a) => a.label === 'Whip')?.attackExpr).toBe('best(1d4!-2, 1d6!-2)');
  });

  it('every Wild Card trait rollable carries a Wild Die', () => {
    const sheet = { ...swade.defaultSheet(), skills: [{ name: 'Fighting', die: 'd8' }] };
    const traitRolls = swade.rollables(sheet).filter((r) => r.group === 'Attributes' || r.group === 'Skills');
    expect(traitRolls.length).toBeGreaterThan(0);
    for (const r of traitRolls) {
      expect(r.expr, `${r.id} is missing its Wild Die`).toMatch(/^best\(.+, 1d6!(-2)?\)/);
    }
  });

  it('weapon attacks roll the linked skill; damage is the typed expression', () => {
    const sheet = {
      ...swade.defaultSheet(),
      skills: [{ name: 'Fighting', die: 'd8' }, { name: 'Shooting', die: 'd6' }],
      attacks: [
        { name: 'Long Sword', skill: 'Fighting', damage: '1d8!+1d8!', dtype: 'slashing', range: 5 },
        { name: '9mm Pistol', skill: 'Shooting', damage: '2d6!', dtype: 'kinetic', range: 72 },
      ],
    };
    const rolls = swade.rollables(sheet);
    expect(rolls.find((r) => r.id === 'attack_0')?.expr).toBe('best(1d8!, 1d6!)');
    expect(rolls.find((r) => r.id === 'damage_0')?.expr).toBe('1d8!+1d8!');
    expect(rolls.find((r) => r.id === 'attack_1')?.expr).toBe('best(1d6!, 1d6!)');
    // Every trait roll expression actually parses and rolls.
    for (const r of rolls) expect(() => roll(r.expr, seededRng(1))).not.toThrow();
  });

  it('weapons become targeted combat actions with attack + damage', () => {
    const character = {
      id: 'c1', campaignId: 'x', ownerUserId: null, name: 'Test', system: 'swade',
      sheet: {
        ...swade.defaultSheet(),
        skills: [{ name: 'Fighting', die: 'd8' }],
        attacks: [{ name: 'Long Sword', skill: 'Fighting', damage: '1d8!+1d6!', dtype: 'slashing', range: 5 }],
      },
    } as unknown as Character;
    const actions = combatActions(character);
    const sword = actions.find((a) => a.id === 'attack:0');
    expect(sword).toBeDefined();
    expect(sword?.attackExpr).toBe('best(1d8!, 1d6!)');
    expect(sword?.amountExpr).toBe('1d8!+1d6!');
    expect(sword?.ranged).toBe(false);
  });

  it('saveCheck is a trait roll vs a fixed target number of 4', () => {
    const sheet = { ...swade.defaultSheet(), vigor: 'd10' };
    const sc = swade.saveCheck(sheet, 'vigor', 15); // dc ignored
    expect(sc.threshold).toBe(4);
    expect(sc.expr).toBe('best(1d10!, 1d6!)');
    expect(sc.label).toBe('Vigor roll');
  });

  it('initiative draws from the 54-card action deck stand-in', () => {
    expect(swade.initiativeExpr(swade.defaultSheet())).toBe('1d54');
  });

  it('powers roll the arcane skill for activation', () => {
    const sheet = {
      ...swade.defaultSheet(), arcaneSkill: 'Spellcasting',
      skills: [{ name: 'Spellcasting', die: 'd10' }],
      powers: [{ name: 'Bolt', cost: 1, effect: 'damage', damage: '2d6!', range: 288 }],
    };
    const rolls = swade.rollables(sheet);
    expect(rolls.find((r) => r.id === 'power_0')?.expr).toBe('best(1d10!, 1d6!)');
    expect(rolls.find((r) => r.id === 'powerDamage_0')?.expr).toBe('2d6!');
  });

  it('conditions include SWADE states; combat resources expose Bennies', () => {
    const ids = conditionsFor('swade').map((c) => c.id);
    for (const id of ['shaken', 'distracted', 'vulnerable', 'stunned', 'prone', 'dead']) {
      expect(ids).toContain(id);
    }
    // The bennies FIELD is the live pool (the Benny menu spends it directly);
    // the pip row mirrors it rather than tracking a separate res_ counter.
    const res = combatResources('swade', { ...swade.defaultSheet(), bennies: 2 });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: 'bennies', max: 3, used: 1, remaining: 2 });
    // More than the starting three (DM awards) widens the track.
    const flush = combatResources('swade', { ...swade.defaultSheet(), bennies: 5 });
    expect(flush[0]).toMatchObject({ max: 5, used: 0, remaining: 5 });
  });
});

describe('SWADE library & compendium', () => {
  it('prebuilt NPC sheets produce rollables that all parse', () => {
    for (const npc of NPCS_SWADE) {
      for (const r of swade.rollables(npc.sheet)) {
        if (r.expr !== '0') expect(() => roll(r.expr, seededRng(3))).not.toThrow();
      }
    }
  });

  it('melee weapons from the compendium compose Str die + weapon die', () => {
    const sword = contentForSystem('swade').find((c) => c.name === 'Long Sword')!;
    const applied = applyEntry(sword, { ...swade.defaultSheet(), strength: 'd10' })!;
    expect(applied.listId).toBe('attacks');
    expect(applied.row.damage).toBe('1d10!+1d8!');
    expect(applied.row.skill).toBe('Fighting');
  });

  it('ranged weapons keep their own dice and range', () => {
    const rifle = contentForSystem('swade').find((c) => c.name === 'Hunting Rifle')!;
    const applied = applyEntry(rifle, swade.defaultSheet())!;
    expect(applied.row.damage).toBe('2d8!');
    expect(applied.row.skill).toBe('Shooting');
    // Book range: the tables' 24" Short, at 5 ft per tabletop inch, so one
    // inch is one tile on a standard hex. The old campaign-wide 60 ft cap was
    // retired by request in favour of the printed distances.
    expect(applied.row.range).toBe(120);
  });

  it('the Sniper Rifle is exempt from the range cap', () => {
    const sniper = contentForSystem('swade').find((c) => c.name === 'Sniper Rifle')!;
    const applied = applyEntry(sniper, swade.defaultSheet())!;
    expect(applied.row.range).toBe(300);
  });

  // The 60 ft Short cap that used to live here was retired by request: guns
  // now carry the ranges their tables print, so a Barrett reaches 250 ft Short
  // and a derringer 15. What remains worth asserting is that every ranged
  // weapon states SOME reach rather than silently falling back to a default.
  it('every ranged weapon carries a real range', () => {
    for (const e of contentForSystem('swade')) {
      if (e.kind !== 'weapon' || e.weapon?.ability !== 'ranged') continue;
      const applied = applyEntry(e, swade.defaultSheet());
      const range = Number(applied?.row.range ?? 0);
      expect(range, `${e.name} range ${range}`).toBeGreaterThan(0);
    }
  });

  it('shields add Parry, body armor adds Armor', () => {
    const entries = contentForSystem('swade');
    const shield = applyEntry(entries.find((c) => c.name === 'Medium Shield')!, swade.defaultSheet())!;
    expect(shield.row).toMatchObject({ armor: 0, parryBonus: 2 });
    const mail = applyEntry(entries.find((c) => c.name === 'Chain Mail')!, swade.defaultSheet())!;
    expect(mail.row).toMatchObject({ armor: 3, parryBonus: 0 });
  });

  it('ranged-only armor (shields) is tracked separately from Toughness armor', () => {
    const sheet = {
      ...swade.defaultSheet(), vigor: 'd8',
      armor: [
        { name: 'Chain Mail', armor: 3, parryBonus: 0, rangedArmor: 0, equipped: true },
        { name: 'Large Shield', armor: 0, parryBonus: 3, rangedArmor: 2, equipped: true },
        { name: 'Spare Shield', armor: 0, parryBonus: 3, rangedArmor: 2, equipped: false },
      ],
    };
    expect(swadeRangedArmor(sheet)).toBe(2); // only the equipped shield
    const d = swade.derive(sheet);
    expect(d.toughness).toBe(2 + 4 + 3);
    expect(d.toughnessRanged).toBe(2 + 4 + 3 + 2);
    expect(swadeParry(sheet)).toBe(2 + 0 + 3); // untrained Fighting + shield
  });

  it('Large Shield from the compendium carries Parry + ranged armor onto the sheet', () => {
    const shield = contentForSystem('swade').find((c) => c.name === 'Large Shield')!;
    const applied = applyEntry(shield, swade.defaultSheet())!;
    expect(applied.row).toMatchObject({ armor: 0, parryBonus: 3, rangedArmor: 2 });
  });

  it('Bolt becomes a to-hit power action: arcane roll vs fixed TN 4, PP cost, projectile range', () => {
    const bolt = contentForSystem('swade').find((c) => c.name === 'Bolt')!;
    const sheet = {
      ...swade.defaultSheet(), arcaneSkill: 'Spellcasting', pp: 10,
      skills: [{ name: 'Spellcasting', die: 'd10' }],
    };
    const applied = applyEntry(bolt, sheet)!;
    expect(applied.listId).toBe('powers');
    const character = { id: 'c', campaignId: 'x', ownerUserId: null, name: 'Mage', system: 'swade', sheet: { ...sheet, powers: [applied.row] } } as unknown as Character;
    const action = combatActions(character).find((a) => a.id === 'power:0')!;
    expect(action.attackExpr).toBe('best(1d10!, 1d6!)');
    expect(action.fixedTn).toBe(4);
    expect(action.ppCost).toBe(1);
    expect(action.amountExpr).toBe('2d6!');
    expect(action.ranged).toBe(true);
    expect(action.aoe).toBeUndefined();
  });

  it('Burst becomes a cone-template action with an Agility (Evasion) save', () => {
    const burst = contentForSystem('swade').find((c) => c.name === 'Burst')!;
    const sheet = { ...swade.defaultSheet(), arcaneSkill: 'Spellcasting', skills: [{ name: 'Spellcasting', die: 'd8' }] };
    const applied = applyEntry(burst, sheet)!;
    const character = { id: 'c', campaignId: 'x', ownerUserId: null, name: 'Mage', system: 'swade', sheet: { ...sheet, powers: [applied.row] } } as unknown as Character;
    const action = combatActions(character).find((a) => a.id === 'power:0')!;
    expect(action.aoe).toEqual({ shape: 'cone', sizeFt: 54 });
    expect(action.saveId).toBe('agility');
    expect(action.onSave).toBe('negate');
    expect(action.attackExpr).toBeNull();
    expect(action.ppCost).toBe(2);
  });

  it('Blast is a no-save sphere template; Stun is a save-or-condition action', () => {
    const entries = contentForSystem('swade');
    const sheet = { ...swade.defaultSheet(), arcaneSkill: 'Spellcasting', skills: [{ name: 'Spellcasting', die: 'd8' }] };
    const blastRow = applyEntry(entries.find((c) => c.name === 'Blast')!, sheet)!.row;
    const stunRow = applyEntry(entries.find((c) => c.name === 'Stun')!, sheet)!.row;
    const character = { id: 'c', campaignId: 'x', ownerUserId: null, name: 'Mage', system: 'swade', sheet: { ...sheet, powers: [blastRow, stunRow] } } as unknown as Character;
    const actions = combatActions(character);
    const blast = actions.find((a) => a.label === 'Blast')!;
    expect(blast.aoe).toEqual({ shape: 'sphere', sizeFt: 0, sizeHexes: 3 });
    expect(blast.saveId).toBeUndefined();
    const stun = actions.find((a) => a.label === 'Stun')!;
    expect(stun.saveId).toBe('vigor');
    expect(stun.appliesCondition).toBe('stunned');
    expect(stun.amountExpr).toBe('0'); // condition-only, no damage roll
  });

  it('the Healing power rolls its arcane skill vs TN 4 to mend Wounds, for 3 PP', () => {
    const heal = contentForSystem('swade').find((c) => c.name === 'Healing')!;
    const sheet = { ...swade.defaultSheet(), arcaneSkill: 'Faith', skills: [{ name: 'Faith', die: 'd8' }] };
    const character = { id: 'c', campaignId: 'x', ownerUserId: null, name: 'Priest', system: 'swade', sheet: { ...sheet, powers: [applyEntry(heal, sheet)!.row] } } as unknown as Character;
    const action = combatActions(character).find((a) => a.id === 'power:0')!;
    expect(action.effect).toBe('heal');
    // The book resolves healing with a roll, not a flat amount: Faith vs TN 4,
    // a success mends a Wound and a raise two.
    expect(action.attackExpr).toContain('1d8!');
    expect(action.fixedTn).toBe(4);
    expect(action.healsWounds).toBe(true);
    expect(action.ppCost).toBe(3);
  });

  it('treating a wound with a kit rolls Healing vs TN 4, kit bonus included', () => {
    const sheet = {
      ...swade.defaultSheet(),
      skills: [{ name: 'Healing', die: 'd8' }],
      inventory: [
        { name: 'Medkit', qty: 1, effect: 'heal', amount: '', range: 5, equipped: true, bonusSkill: 'Healing', bonusAmt: 2 },
      ],
    };
    const character = { id: 'c', campaignId: 'x', ownerUserId: null, name: 'Medic', system: 'swade', sheet } as unknown as Character;
    const action = combatActions(character).find((a) => a.id === 'item:0')!;
    // Usable even with no healing dice listed — the roll is the whole rule.
    expect(action.effect).toBe('heal');
    expect(action.healsWounds).toBe(true);
    expect(action.fixedTn).toBe(4);
    expect(action.attackExpr).toContain('1d8!');
    // The equipped kit's own +2 rides the roll it is meant to help.
    expect(action.attackExpr).toContain('+2');
  });

  it('a Healing roll mends one Wound, two on a raise, none on a failure', () => {
    expect(swadeWoundsHealed(false, false)).toBe(0);
    expect(swadeWoundsHealed(true, false)).toBe(1);
    expect(swadeWoundsHealed(true, true)).toBe(2);
  });

  it('weapon props become live columns: AP, Parry mods, magazine → ammo', () => {
    const entries = contentForSystem('swade');
    const sheet = swade.defaultSheet();
    expect(applyEntry(entries.find((c) => c.name === 'Crossbow')!, sheet)!.row).toMatchObject({ ap: 2 });
    expect(applyEntry(entries.find((c) => c.name === 'Assault Rifle')!, sheet)!.row).toMatchObject({ ap: 2, ammo: 30 });
    expect(applyEntry(entries.find((c) => c.name === 'Rapier')!, sheet)!.row).toMatchObject({ parryBonus: 1, wielded: false });
    // A Parry PENALTY belongs to the great axe, not the great sword — the
    // table gives "AP 2, Parry −1, two hands" to the axe and only "two hands"
    // to the sword.
    expect(applyEntry(entries.find((c) => c.name === 'Axe, Great')!, sheet)!.row).toMatchObject({ parryBonus: -1, ap: 2 });
  });

  it('a wielded Rapier and a maintained Deflection raise Parry; Armor/Protection raise Toughness', () => {
    const sheet = {
      ...swade.defaultSheet(),
      skills: [{ name: 'Fighting', die: 'd8' }],
      attacks: [{ name: 'Rapier', skill: 'Fighting', damage: '1d6!+1d4!', parryBonus: 1, wielded: true }],
    };
    expect(swadeParry(sheet)).toBe(2 + 4 + 1);
    expect(swadeParry({ ...sheet, deflectionActive: true })).toBe(2 + 4 + 1 + 2);
    // Un-wielded weapons contribute nothing.
    expect(swadeParry({ ...sheet, attacks: [{ ...sheet.attacks[0], wielded: false }] })).toBe(2 + 4);
    const base = swadeToughness(sheet);
    expect(swadeToughness({ ...sheet, armorActive: true, protectionActive: true })).toBe(base + 4);
  });

  it('AP flows into the combat action for the server DR math', () => {
    const character = {
      id: 'c', campaignId: 'x', ownerUserId: null, name: 'Sniper', system: 'swade',
      sheet: {
        ...swade.defaultSheet(),
        skills: [{ name: 'Shooting', die: 'd8' }],
        attacks: [{ name: 'Sniper Rifle', skill: 'Shooting', damage: '2d10!', ap: 4, range: 300 }],
      },
    } as unknown as Character;
    expect(combatActions(character).find((a) => a.id === 'attack:0')?.ap).toBe(4);
  });

  it('equipped gear boosts the matching trait roll (Lockpicks → Thievery)', () => {
    const picks = contentForSystem('swade').find((c) => c.name === 'Lockpicks')!;
    const base = { ...swade.defaultSheet(), skills: [{ name: 'Thievery', die: 'd8' }] };
    const row = applyEntry(picks, base)!.row;
    const sheet = { ...base, inventory: [{ ...row, equipped: true }] };
    const rollExpr = swade.rollables(sheet).find((r) => r.id === 'skill_0')!.expr;
    expect(rollExpr).toBe('best(1d8!, 1d6!)+1');
    // Unequipped: no bonus.
    const stashed = { ...base, inventory: [{ ...row, equipped: false }] };
    expect(swade.rollables(stashed).find((r) => r.id === 'skill_0')!.expr).toBe('best(1d8!, 1d6!)');
  });

  it('a maintained Smite adds +2 to the wielded weapon damage roll', () => {
    const sheet = {
      ...swade.defaultSheet(), smiteActive: true,
      skills: [{ name: 'Fighting', die: 'd8' }],
      attacks: [
        { name: 'Long Sword', skill: 'Fighting', damage: '1d8!+1d6!', wielded: true },
        { name: 'Dagger', skill: 'Fighting', damage: '1d4!+1d6!', wielded: false },
      ],
    };
    const rolls = swade.rollables(sheet);
    expect(rolls.find((r) => r.id === 'damage_0')!.expr).toBe('1d8!+1d6!+2');
    expect(rolls.find((r) => r.id === 'damage_1')!.expr).toBe('1d4!+1d6!');
  });

  it('Invisibility applies the real invisible condition as a buff', () => {
    const inv = contentForSystem('swade').find((c) => c.name === 'Invisibility')!;
    const sheet = { ...swade.defaultSheet(), arcaneSkill: 'Spellcasting', skills: [{ name: 'Spellcasting', die: 'd8' }] };
    const character = { id: 'c', campaignId: 'x', ownerUserId: null, name: 'Mage', system: 'swade', sheet: { ...sheet, powers: [applyEntry(inv, sheet)!.row] } } as unknown as Character;
    const action = combatActions(character).find((a) => a.id === 'power:0')!;
    expect(action.effect).toBe('heal'); // buff semantics: self/ally targetable
    expect(action.appliesCondition).toBe('invisible');
    expect(action.ppCost).toBe(5);
  });

  it('bestiary attacks carry real mechanics: spider web entangles, dragon breath is a cone', () => {
    const spider = NPCS_SWADE.find((n) => n.name === 'Giant Spider')!;
    const spiderChar = { id: 's', campaignId: 'x', ownerUserId: null, name: 'Spider', system: 'swade', sheet: spider.sheet } as unknown as Character;
    const web = combatActions(spiderChar).find((a) => a.label === 'Web')!;
    expect(web.saveId).toBe('agility');
    expect(web.appliesCondition).toBe('entangled');
    const dragon = NPCS_SWADE.find((n) => n.name === 'Young Dragon')!;
    const dragonChar = { id: 'd', campaignId: 'x', ownerUserId: null, name: 'Dragon', system: 'swade', sheet: dragon.sheet } as unknown as Character;
    const breath = combatActions(dragonChar).find((a) => a.label === 'Fiery Breath')!;
    expect(breath.aoe).toEqual({ shape: 'cone', sizeFt: 54 });
    expect(breath.saveId).toBe('agility');
    expect(breath.onSave).toBe('half');
  });

  it('undead carry their +2 Toughness as a real armor row; the ghost is immune to mundane damage', () => {
    const skeleton = NPCS_SWADE.find((n) => n.name === 'Skeleton')!;
    expect(swadeToughness(skeleton.sheet)).toBe(2 + 3 + 2); // vigor d6 + resilience
    expect(skeleton.sheet.resist).toBe('piercing');
    const ghost = NPCS_SWADE.find((n) => n.name === 'Ghost')!;
    expect(String(ghost.sheet.immune)).toContain('slashing');
  });

  it('random SWADE NPCs have trait dice, core skills, and a working attack', () => {
    const npc = generateNpc('swade', seededRng(12));
    expect(String(npc.sheet.agility)).toMatch(/^d\d+$/);
    expect(npc.sheet.wildCard).toBe(false);
    const rolls = swade.rollables(npc.sheet);
    expect(rolls.find((r) => r.id === 'attack_0')).toBeDefined();
    for (const r of rolls) expect(() => roll(r.expr, seededRng(4))).not.toThrow();
  });
});

describe('SWADE conditions engine', () => {
  const base = {
    agility: 'd8', spirit: 'd6', vigor: 'd6', pace: 6,
    skills: [{ name: 'Fighting', die: 'd8' }, { name: 'Shooting', die: 'd8' }],
  };

  it('blocksMovement pins Bound, Entangled, Stunned, and Bleeding Out characters', () => {
    expect(blocksMovement(['bound'])).toBe(true);
    expect(blocksMovement(['entangled'])).toBe(true);
    expect(blocksMovement(['stunned'])).toBe(true);
    expect(blocksMovement(['bleeding'])).toBe(true);
    expect(blocksMovement(['shaken', 'vulnerable', 'distracted', 'prone'])).toBe(false);
    expect(blocksMovement([])).toBe(false);
  });

  it('Distracted (and conditions that include it) takes −2 on every trait roll', () => {
    expect(traitExpr(base, 8)).toBe('best(1d8!, 1d6!)');
    for (const cond of ['distracted', 'entangled', 'bound', 'stunned']) {
      expect(traitExpr({ ...base, conditions: [cond] }, 8)).toBe('best(1d8!, 1d6!)-2');
    }
    // Non-stacking: two Distracted-family conditions still cost only −2.
    expect(traitExpr({ ...base, conditions: ['distracted', 'bound'] }, 8)).toBe('best(1d8!, 1d6!)-2');
  });

  it('Prone drops Parry by 2', () => {
    expect(swadeParry(base)).toBe(2 + 4); // Fighting d8
    expect(swadeParry({ ...base, conditions: ['prone'] })).toBe(2 + 4 - 2);
  });

  it('Wounds slow Pace by 1 each, never below 1', () => {
    expect(swadePace(base)).toBe(6);
    expect(swadePace({ ...base, wounds: 2 })).toBe(4);
    expect(swadePace({ ...base, wounds: 9 })).toBe(1);
  });
});

describe('Gang Up', () => {
  const A = { q: 0, r: 0 }; // attacker
  const D = { q: 1, r: 0 }; // defender
  const ally = (hex: { q: number; r: number }, canFight = true) =>
    ({ hex, side: 'attacker' as const, canFight });
  const foe = (hex: { q: number; r: number }, canFight = true) =>
    ({ hex, side: 'defender' as const, canFight });

  it('+1 per able ally adjacent to the defender, capped at +4', () => {
    expect(gangUpBonus(A, D, [])).toBe(0);
    expect(gangUpBonus(A, D, [ally({ q: 2, r: 0 })])).toBe(1);
    expect(gangUpBonus(A, D, [
      ally({ q: 2, r: 0 }), ally({ q: 1, r: -1 }), ally({ q: 0, r: 1 }),
      ally({ q: 2, r: -1 }), ally({ q: 1, r: 1 }),
    ])).toBe(4);
  });

  it('ignores allies out of reach or unable to fight', () => {
    expect(gangUpBonus(A, D, [ally({ q: 5, r: 5 })])).toBe(0);
    expect(gangUpBonus(A, D, [ally({ q: 2, r: 0 }, false)])).toBe(0);
  });

  it("defender's allies adjacent to the attacker cancel one each, never below 0", () => {
    expect(gangUpBonus(A, D, [ally({ q: 2, r: 0 }), foe({ q: -1, r: 0 })])).toBe(0);
    expect(gangUpBonus(A, D, [ally({ q: 2, r: 0 }), ally({ q: 1, r: -1 }), foe({ q: -1, r: 0 })])).toBe(1);
    expect(gangUpBonus(A, D, [foe({ q: -1, r: 0 }), foe({ q: 0, r: -1 })])).toBe(0);
    // A downed foe cancels nothing.
    expect(gangUpBonus(A, D, [ally({ q: 2, r: 0 }), foe({ q: -1, r: 0 }, false)])).toBe(1);
  });
});

describe('Defend', () => {
  it('grants +4 Parry while the defending condition is held', () => {
    const base = { skills: [{ name: 'Fighting', die: 'd8' }] };
    expect(swadeParry(base)).toBe(6);
    expect(swadeParry({ ...base, conditions: ['defending'] })).toBe(10);
  });
});

describe('Rate of Fire', () => {
  it('compendium automatics carry RoF onto the sheet and into combat actions', () => {
    const smg = contentForSystem('swade').find((e) => e.name === 'Submachine Gun')!;
    const res = applyEntry(smg, swade.defaultSheet())!;
    const row = res.row as Record<string, unknown>;
    expect(row.rof).toBe(3);
    expect(row.ammo).toBe(30);
    const character = {
      id: 'c1', name: 'Test', system: 'swade',
      sheet: { ...swade.defaultSheet(), skills: [{ name: 'Shooting', die: 'd8' }], attacks: [row] },
    } as unknown as Character;
    expect(combatActions(character).find((a) => a.label === 'Submachine Gun')?.rof).toBe(3);
  });

  it('every automatic-class compendium weapon declares its RoF', () => {
    const autos = ['Assault Rifle', 'Submachine Gun', 'Machine Pistol', 'Combat Shotgun',
      'Light Machine Gun', 'Heavy Machine Gun', 'Gauss Rifle', 'Thompson M1928 SMG',
      'Gatling Gun (Crank)', 'Pulse Repeater Rifle'];
    for (const name of autos) {
      const entry = contentForSystem('swade').find((e) => e.name === name);
      expect(entry, `${name} missing from compendium`).toBeDefined();
      const row = applyEntry(entry!, swade.defaultSheet())!.row as Record<string, unknown>;
      expect(Number(row.rof), `${name} has no RoF`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Reload + Suppressive Fire', () => {
  it('compendium magazines land as maxAmmo so Reload knows what to refill to', () => {
    const smg = contentForSystem('swade').find((e) => e.name === 'Submachine Gun')!;
    const row = applyEntry(smg, swade.defaultSheet())!.row as Record<string, unknown>;
    expect(row.maxAmmo).toBe(30);
  });

  it('RoF 2+ ranged weapons offer a Suppressive Fire template action', () => {
    const smg = contentForSystem('swade').find((e) => e.name === 'Submachine Gun')!;
    const row = applyEntry(smg, swade.defaultSheet())!.row as Record<string, unknown>;
    const character = {
      id: 'c1', name: 'Test', system: 'swade',
      sheet: { ...swade.defaultSheet(), skills: [{ name: 'Shooting', die: 'd8' }], attacks: [row] },
    } as unknown as Character;
    const sup = combatActions(character).find((a) => a.id === 'suppress:0');
    expect(sup).toBeDefined();
    expect(sup?.suppressive).toBe(true);
    expect(sup?.aoe).toEqual({ shape: 'sphere', sizeFt: 0, sizeHexes: 3 });
    expect(sup?.saveId).toBe('spirit');
    expect(sup?.appliesCondition).toBe('distracted');
    expect(sup?.amountExpr).toBe('0');
    // A single-shot weapon offers no suppression.
    const pistolChar = {
      id: 'c2', name: 'Test2', system: 'swade',
      sheet: { ...swade.defaultSheet(), attacks: [{ name: 'Derringer', skill: 'Shooting', damage: '2d4!', range: 30, ammo: 2, maxAmmo: 2 }] },
    } as unknown as Character;
    expect(combatActions(pistolChar).some((a) => a.id.startsWith('suppress'))).toBe(false);
  });
});

describe('Improvised weapons', () => {
  it('compendium improvised weapons land with the −2 baked into the attack roll', () => {
    const entry = contentForSystem('swade').find((e) => e.name === 'Improvised Weapon (Medium)')!;
    const sheet = { ...swade.defaultSheet(), strength: 'd8', skills: [{ name: 'Fighting', die: 'd8' }] };
    const row = applyEntry(entry, sheet)!.row as Record<string, unknown>;
    const withIt = { ...sheet, attacks: [row] };
    const atk = swade.rollables(withIt).find((r) => r.id === 'attack_0')!;
    expect(atk.expr).toBe('best(1d8!, 1d6!)-2');
    expect(atk.label).toContain('improvised −2');
    expect(row.damage).toBe('1d8!+1d6!'); // Str d8 + medium d6
  });
});

describe('Ammunition & caliber', () => {
  it('ammo items land in inventory as batches with their caliber', () => {
    const ammo = contentForSystem('swade').find((e) => e.name === 'Bullets, Medium (50)')!;
    expect(ammo.category).toBe('Ammunition');
    const res = applyEntry(ammo, swade.defaultSheet())!;
    expect(res.listId).toBe('inventory');
    const row = res.row as Record<string, unknown>;
    expect(row.qty).toBe(50);
    expect(row.caliber).toBe('bullets-medium');
  });

  it('guns import with a matching caliber column', () => {
    const cases: Array<[string, string]> = [
      ['9mm Pistol', 'bullets-medium'],
      ['Sniper Rifle', 'bullets-large'],
      ['Laser Pistol', 'battery-pistol'],
      ['Pump Shotgun', 'shells'],
      ['Bow', 'arrows'],
      ['Musket', 'shot'],
    ];
    for (const [name, caliber] of cases) {
      const entry = contentForSystem('swade').find((e) => e.name === name)!;
      const row = applyEntry(entry, swade.defaultSheet())!.row as Record<string, unknown>;
      expect(row.caliber, name).toBe(caliber);
    }
  });

  it('every ammunition caliber is chambered by at least one weapon (and vice versa)', () => {
    const all = contentForSystem('swade');
    const ammoCalibers = new Set(all.filter((e) => e.category === 'Ammunition').map((e) => e.gear!.caliber));
    const gunCalibers = new Set(
      all.filter((e) => e.kind === 'weapon' && e.weapon)
        .map((e) => /caliber: ([a-z-]+)/i.exec(e.weapon!.props.join(', '))?.[1])
        .filter(Boolean),
    );
    for (const c of gunCalibers) expect(ammoCalibers.has(c as string), `no ammo item for ${c}`).toBe(true);
    // Slugs are an alternate load for shell-firing shotguns, not their own gun.
    for (const c of ammoCalibers) {
      if (c === 'slugs' || c === 'battery-gatling') continue;
      expect(gunCalibers.has(c as string), `no weapon chambers ${c}`).toBe(true);
    }
  });
});

describe('SWADE Hindrance budget', () => {
  it('allows any combination worth 4 points', () => {
    const minor = { severity: 'Minor' as const };
    const major = { severity: 'Major' as const };
    expect(hindrancePoints([minor, minor, minor, minor])).toBe(4);
    expect(hindrancePoints([major, major])).toBe(4);
    expect(hindrancePoints([major, minor, minor])).toBe(4);
    // Four Minors and two Majors were both forbidden by the old
    // two-Minor/one-Major shape rule despite costing the same 4 points.
    expect(canTakeHindrance([minor, minor, minor], 'Minor')).toBe(true);
    expect(canTakeHindrance([major], 'Major')).toBe(true);
  });

  it('refuses anything that would break the 4-point cap', () => {
    const minor = { severity: 'Minor' as const };
    const major = { severity: 'Major' as const };
    expect(canTakeHindrance([minor, minor, minor, minor], 'Minor')).toBe(false);
    expect(canTakeHindrance([major, major], 'Minor')).toBe(false);
    // 3 points spent leaves room for a Minor but not a Major.
    expect(canTakeHindrance([major, minor], 'Minor')).toBe(true);
    expect(canTakeHindrance([major, minor], 'Major')).toBe(false);
  });
});
