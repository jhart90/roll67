import type { AoeShape, Character } from '../types.js';
import { dnd5e } from './dnd5e.js';
import { hasDiscipline, swn } from './swn.js';
import { swade } from './swade.js';
import { num, rows, str, usableAmount, type CombatAction } from './types.js';

const SYSTEMS = { dnd5e, swn, swade };

/**
 * Derive the targeted combat actions available from a character sheet:
 *  - each weapon in the Attacks list (roll to hit + damage), and
 *  - each inventory item flagged heal/damage with an amount (usable items).
 * Weapon to-hit/damage expressions reuse the system's own rollables() so the
 * math (proficiency, ability mods, SWN attack bonus) is always consistent.
 */
export function combatActions(character: Character): CombatAction[] {
  const sheet = character.sheet;
  const schema = SYSTEMS[character.system];
  const rollables = schema.rollables(sheet);
  const out: CombatAction[] = [];

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
      ...(save ? { saveId: save, onSave: str(atk, 'onSave', 'half') === 'negate' ? 'negate' as const : 'half' as const, fixedDc: num(atk, 'saveDc', 13) } : {}),
      ...(aoeShape && aoeSize > 0
        ? { aoe: { shape: aoeShape as AoeShape, sizeFt: aoeSize, ...(aoeWidth > 0 ? { widthFt: aoeWidth } : {}) } }
        : {}),
      ...(condition ? { appliesCondition: condition } : {}),
      ...(condition && !save && conditionSave && conditionDc > 0
        ? { conditionSaveId: conditionSave, conditionDc } : {}),
    });
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
        ...(aoeShape && aoeSize > 0
          ? { aoe: { shape: aoeShape as AoeShape, sizeFt: aoeSize, ...(aoeWidth > 0 ? { widthFt: aoeWidth } : {}) } }
          : {}),
        ...(condition ? { appliesCondition: condition } : {}),
      });
    });
  };
  spellAction('cantrips', 'cantrip', false);
  spellAction('spells', 'spell', true);

  // Psychic powers with an amount become targeted actions too, gated on the
  // character actually having the discipline trained (a skill row by that
  // name) — untrained disciplines simply don't offer the power as an action.
  // Effort cost defaults to the power's level (SWN's usual convention) unless
  // an explicit Effort column value is set.
  rows(sheet, 'powers').forEach((pw, i) => {
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
    if (!amount || !usableAmount(amount)) return;
    const qty = num(it, 'qty', 1);
    if (qty <= 0) return;
    const name = str(it, 'name', '').trim() || `Item ${i + 1}`;
    const rangeFt = Math.max(0, num(it, 'range', 5));
    out.push({
      id: `item:${i}`,
      label: qty > 1 ? `${name} (×${qty})` : name,
      effect,
      attackExpr: null,
      amountExpr: amount,
      rangeFt,
      damageType: str(it, 'dtype', ''),
      ranged: rangeFt > 5,
      consumesItem: true,
      source: 'item',
      index: i,
    });
  });

  return out;
}
