import type { AoeShape, Character, SheetData } from '../types.js';
import { dnd5e } from './dnd5e.js';
import { hasDiscipline, swn } from './swn.js';
import { gearTraitBonus, skillDie, swade, swadeArcaneExpr, swadeStowed, traitExpr } from './swade.js';
import { num, rows, str, usableAmount, type CombatAction } from './types.js';

const SYSTEMS = { dnd5e, swn, swade };

/**
 * Derive the targeted combat actions available from a character sheet:
 *  - each weapon in the Attacks list (roll to hit + damage), and
 *  - each inventory item flagged heal/damage with an amount (usable items).
 * Weapon to-hit/damage expressions reuse the system's own rollables() so the
 * math (proficiency, ability mods, SWN attack bonus) is always consistent.
 */

/** SWADE RoF → rounds per attack: 1→1, 2→5, 3→10, 4→20, 5→40, 6→50. */
export const AMMO_BY_ROF = [1, 1, 5, 10, 20, 40, 50];

export function combatActions(character: Character): CombatAction[] {
  const sheet = character.sheet;
  const schema = SYSTEMS[character.system];
  const rollables = schema.rollables(sheet);
  const out: CombatAction[] = [];

  /** SWADE Rate of Fire from an explicit column or a "RoF N" note (max 6). */
  const swadeRof = (atk: SheetData): number =>
    Math.min(6, num(atk, 'rof', 0) || Number(/RoF\s*(\d)/i.exec(str(atk, 'notes', ''))?.[1] ?? 0));

  rows(sheet, 'attacks').forEach((atk, i) => {
    const name = str(atk, 'name', '').trim() || `Attack ${i + 1}`;
    const attack = rollables.find((r) => r.id === `attack_${i}`);
    const damage = rollables.find((r) => r.id === `damage_${i}`);
    if (!attack && !damage) return;
    const rangeFt = Math.max(0, num(atk, 'range', 5));
    // A save-based special attack (breath weapons, etc.) forces a saving
    // throw instead of a to-hit roll, and may hit an area rather than one
    // target — mirrors how save-based spells/cantrips are built below, but
    // with a fixed stat-block DC instead of one derived from the caster.
    const save = str(atk, 'save', '');
    const aoeShape = str(atk, 'aoeShape', '');
    const aoeSize = num(atk, 'aoeSize', 0);
    const aoeHexes = num(atk, 'aoeHexes', 0);
    const aoeWidth = num(atk, 'aoeWidth', 0);
    // Condition rider: on a save-based attack it lands with the failed main
    // save; on a to-hit attack it triggers after a hit, gated by its own
    // rider save when set (ghoul claws: DC 10 CON or paralyzed) or applying
    // automatically when not (a crocodile's bite just grapples).
    const condition = str(atk, 'condition', '');
    const conditionSave = str(atk, 'conditionSave', '');
    const conditionDc = num(atk, 'conditionDc', 0);
    out.push({
      id: `attack:${i}`,
      label: name,
      effect: 'damage',
      attackExpr: save ? null : (attack?.expr ?? null),
      amountExpr: damage?.expr ?? '0',
      rangeFt,
      damageType: str(atk, 'dtype', ''),
      ranged: rangeFt > 5,
      consumesItem: false,
      source: 'attack',
      index: i,
      // SWADE Rate of Fire, from an explicit column or a "RoF N" note.
      ...(swadeRof(atk) >= 2 ? { rof: swadeRof(atk) } : {}),
      ...(num(atk, 'ap', 0) > 0 ? { ap: num(atk, 'ap', 0) } : {}),
      ...(atk.thrown === true ? { thrown: true } : {}),
      ...(num(atk, 'shock', 0) > 0 && num(atk, 'shockAc', 0) > 0
        ? { shockDamage: num(atk, 'shock', 0), shockAc: num(atk, 'shockAc', 0) } : {}),
      ...(save ? { saveId: save, onSave: str(atk, 'onSave', 'half') === 'negate' ? 'negate' as const : 'half' as const, fixedDc: num(atk, 'saveDc', 13) } : {}),
      ...(aoeShape && (aoeSize > 0 || aoeHexes > 0)
        ? { aoe: { shape: aoeShape as AoeShape, sizeFt: aoeSize, ...(aoeHexes > 0 ? { sizeHexes: aoeHexes } : {}), ...(aoeWidth > 0 ? { widthFt: aoeWidth } : {}) } }
        : {}),
      ...(condition ? { appliesCondition: condition } : {}),
      ...(condition && !save && conditionSave && conditionDc > 0
        ? { conditionSaveId: conditionSave, conditionDc } : {}),
      ...(atk.hardRange === true ? { hardRange: true } : {}),
      // Put away: still listed, but greyed out and refused until drawn.
      ...(character.system === 'swade' && swadeStowed(atk) ? { stowed: true as const } : {}),
    });

    // SWADE Suppressive Fire: any RoF 2+ ranged weapon can hose down a
    // medium blast template instead of aiming at one target — everyone under
    // it rolls Spirit (keep your head down!) or is Distracted. No damage,
    // triple the autofire ammo.
    if (character.system === 'swade' && swadeRof(atk) >= 2 && rangeFt > 5) {
      out.push({
        id: `suppress:${i}`,
        label: `Suppressive Fire (${name})`,
        effect: 'damage',
        attackExpr: null,
        amountExpr: '0',
        rangeFt,
        damageType: '',
        ranged: true,
        consumesItem: false,
        source: 'attack',
        index: i,
        rof: swadeRof(atk),
        suppressive: true,
        saveId: 'spirit',
        onSave: 'negate',
        appliesCondition: 'distracted',
        aoe: { shape: 'sphere', sizeFt: 0, sizeHexes: 3 },
        // Hosing down a template needs the gun in hand as much as aiming does.
        ...(swadeStowed(atk) ? { stowed: true as const } : {}),
      });
    }
  });

  // Spells & cantrips with an amount become targeted actions: a spell attack
  // (save 'attack'), a save-for-effect spell, or an auto-applied heal. Leveled
  // spells carry a slotLevel so the server spends a slot on use.
  const spellAttackExpr = rollables.find((r) => r.id === 'spellAttack')?.expr ?? '1d20';
  const spellAction = (listId: string, prefix: string, leveled: boolean) => {
    rows(sheet, listId).forEach((sp, i) => {
      const amount = str(sp, 'damage', '').trim();
      const condition = str(sp, 'condition', '');
      const hasAmount = !!amount && usableAmount(amount);
      // A spell with no rollable amount still becomes a targeted action when
      // it inflicts a condition (Hold Person, Web, Invisibility) -- targeting
      // and range come from the normal flow; the "damage" is just 0.
      if (!hasAmount && !condition) return;
      const name = str(sp, 'name', '').trim() || `${prefix} ${i + 1}`;
      const save = str(sp, 'save', '');
      // Condition-only spells: hostile when the target gets a save (Hold
      // Person -- self-targeting blocked, red ring), a buff when it doesn't
      // (Invisibility -- self/ally targeting allowed, green ring).
      const effect = str(sp, 'effect', 'damage') === 'heal' || (!hasAmount && !save)
        ? 'heal' as const : 'damage' as const;
      const onSave = str(sp, 'onSave', 'half') === 'negate' ? 'negate' as const : 'half' as const;
      const rangeFt = Math.max(0, num(sp, 'range', 0));
      const aoeShape = str(sp, 'aoeShape', '');
      const aoeSize = num(sp, 'aoeSize', 0);
      const aoeHexes = num(sp, 'aoeHexes', 0);
      const aoeWidth = num(sp, 'aoeWidth', 0);
      out.push({
        id: `${prefix}:${i}`,
        label: name,
        effect,
        attackExpr: save === 'attack' && effect === 'damage' ? spellAttackExpr : null,
        amountExpr: hasAmount ? amount : '0',
        rangeFt,
        damageType: str(sp, 'dtype', ''),
        ranged: rangeFt > 5,
        consumesItem: false,
        source: 'spell',
        index: i,
        ...(leveled ? { slotLevel: Math.max(1, num(sp, 'level', 1)) } : {}),
        ...(save && save !== 'attack' && effect === 'damage' ? { saveId: save, onSave } : {}),
        ...(sp.conc === true ? { concentration: true, spellName: name } : {}),
        ...(aoeShape && (aoeSize > 0 || aoeHexes > 0)
          ? { aoe: { shape: aoeShape as AoeShape, sizeFt: aoeSize, ...(aoeHexes > 0 ? { sizeHexes: aoeHexes } : {}), ...(aoeWidth > 0 ? { widthFt: aoeWidth } : {}) } }
          : {}),
        ...(condition ? { appliesCondition: condition } : {}),
      });
    });
  };
  spellAction('cantrips', 'cantrip', false);
  spellAction('spells', 'spell', true);

  // SWADE powers ride the same machinery as 5e spells: a Bolt is a to-hit
  // action (arcane trait roll vs TN 4, projectile animation for free), a
  // Burst/Blast carries an AoE spec (cone/sphere templates, group resolution),
  // and resisted powers force a trait roll (Evasion etc.). Power Points are
  // spent server-side via ppCost, like spell slots / SWN Effort.
  if (character.system === 'swade') {
    const arcane = swadeArcaneExpr(sheet);
    rows(sheet, 'powers').forEach((pw, i) => {
      const amount = str(pw, 'damage', '').trim();
      const condition = str(pw, 'condition', '');
      const hasAmount = !!amount && usableAmount(amount);
      // Like condition-only spells (Hold Person): a power that inflicts a
      // state still becomes a targeted action even with no damage roll.
      if (!hasAmount && !condition) return;
      const name = str(pw, 'name', '').trim() || `Power ${i + 1}`;
      const effect = str(pw, 'effect', 'damage') === 'heal' ? 'heal' as const : 'damage' as const;
      const save = str(pw, 'save', '');
      const onSave = str(pw, 'onSave', 'negate') === 'half' ? 'half' as const : 'negate' as const;
      const rangeFt = Math.max(0, num(pw, 'range', 0));
      const aoeShape = str(pw, 'aoeShape', '');
      const aoeSize = num(pw, 'aoeSize', 0);
      const aoeHexes = num(pw, 'aoeHexes', 0);
      const isAoe = !!aoeShape && (aoeSize > 0 || aoeHexes > 0);
      // A direct damaging power with no save and no area rolls the arcane
      // skill to hit vs the fixed TN 4 (a raise adds +1d6! server-side).
      // A HEALING power rolls that same arcane skill vs TN 4 and mends a
      // Wound, two on a raise — the book's rule, not a damage roll in
      // reverse.
      const healRoll = effect === 'heal' && !isAoe && arcane;
      const attackExpr = healRoll ? arcane : (effect === 'damage' && !save && !isAoe && arcane ? arcane : null);
      out.push({
        id: `power:${i}`,
        label: name,
        effect,
        attackExpr,
        amountExpr: hasAmount ? amount : '0',
        rangeFt,
        damageType: str(pw, 'dtype', ''),
        ranged: rangeFt > 5,
        consumesItem: false,
        source: 'power',
        index: i,
        ppCost: Math.max(0, num(pw, 'cost', 1)),
        ...(str(pw, 'duration', '') ? { duration: str(pw, 'duration', '') } : {}),
        ...(attackExpr ? { fixedTn: 4 } : {}),
        ...(healRoll ? { healsWounds: true as const } : {}),
        ...(save && effect === 'damage' ? { saveId: save, onSave } : {}),
        ...(isAoe ? { aoe: { shape: aoeShape as AoeShape, sizeFt: aoeSize, ...(aoeHexes > 0 ? { sizeHexes: aoeHexes } : {}) } } : {}),
        ...(condition ? { appliesCondition: condition } : {}),
      });
    });

    // Combat maneuvers from the quick-reference sheet: opposed rolls and
    // special attacks the server resolves in place of the damage pipeline.
    const maneuvers: Array<[CombatAction['maneuver'], string, number]> = [
      ['touch', 'Touch Attack', 5],
      ['push', 'Push', 5],
      ['grapple', 'Grapple', 5],
      ['test', 'Test', 5],
      ['support', 'Support', 60],
    ];
    maneuvers.forEach(([kind, label, rangeFt], i) => out.push({
      id: `maneuver:${kind}`,
      label,
      effect: 'damage',
      attackExpr: null,
      amountExpr: '0',
      rangeFt,
      damageType: '',
      ranged: false,
      consumesItem: false,
      source: 'attack',
      index: 1000 + i,
      maneuver: kind,
    }));
  }

  // SWN psychic powers with an amount become targeted actions too, gated on
  // the character actually having the discipline trained (a skill row by that
  // name) — untrained disciplines simply don't offer the power as an action.
  // Effort cost defaults to the power's level (SWN's usual convention) unless
  // an explicit Effort column value is set.
  if (character.system === 'swn') rows(sheet, 'powers').forEach((pw, i) => {
    const amount = str(pw, 'damage', '').trim();
    if (!amount || !usableAmount(amount)) return;
    const discipline = str(pw, 'discipline', '');
    if (!discipline || !hasDiscipline(sheet, discipline)) return;
    const name = str(pw, 'name', '').trim() || `Power ${i + 1}`;
    const effect = str(pw, 'effect', 'damage') === 'heal' ? 'heal' : 'damage';
    const save = str(pw, 'save', '');
    const rangeFt = Math.max(1, num(pw, 'range', 0) || 5);
    const level = Math.max(1, num(pw, 'level', 1));
    const effortCost = Math.max(1, num(pw, 'effort', 0) || level);
    out.push({
      id: `power:${i}`,
      label: name,
      effect,
      attackExpr: null,
      amountExpr: amount,
      rangeFt,
      damageType: str(pw, 'dtype', ''),
      ranged: rangeFt > 5,
      consumesItem: false,
      source: 'power',
      index: i,
      effortCost,
      disciplineId: discipline,
      ...(save && effect === 'damage' ? { saveId: save, onSave: 'half' as const } : {}),
    });
  });

  rows(sheet, 'inventory').forEach((it, i) => {
    const effect = str(it, 'effect', '').toLowerCase();
    if (effect !== 'heal' && effect !== 'damage') return;
    const amount = str(it, 'amount', '').trim();
    // A SWADE heal is decided by the Healing roll, not by an amount, so a
    // kit with no healing dice listed is still a usable action.
    const swadeHeal = character.system === 'swade' && effect === 'heal';
    if (!swadeHeal && (!amount || !usableAmount(amount))) return;
    const qty = num(it, 'qty', 1);
    if (qty <= 0) return;
    const name = str(it, 'name', '').trim() || `Item ${i + 1}`;
    const rangeFt = Math.max(0, num(it, 'range', 5));
    out.push({
      id: `item:${i}`,
      label: qty > 1 ? `${name} (×${qty})` : name,
      effect,
      // Treating a wound is a Healing roll vs TN 4: a success mends one
      // Wound, a raise two. The kit itself just adds its bonus to that roll
      // (the equipped-gear modifier columns), so it has no dice of its own.
      attackExpr: swadeHeal ? traitExpr(sheet, skillDie(sheet, 'Healing'), gearTraitBonus(sheet, 'Healing')) : null,
      amountExpr: amount && usableAmount(amount) ? amount : '0',
      rangeFt,
      damageType: str(it, 'dtype', ''),
      ranged: rangeFt > 5,
      // A kit is a tool, not a dose: anything that grants a standing bonus to
      // a trait (a Medkit's +2 Healing) is equipment you keep using, while a
      // potion or an antitoxin is spent on use.
      consumesItem: !(swadeHeal && str(it, 'bonusSkill', '').trim() !== ''),
      source: 'item',
      index: i,
      ...(swadeHeal ? { fixedTn: 4, healsWounds: true as const, traitName: 'Healing' } : {}),
      ...(it.hardRange === true ? { hardRange: true } : {}),
      ...(it.wildCardOnly === true ? { wildCardOnly: true } : {}),
    });
  });

  return out;
}
