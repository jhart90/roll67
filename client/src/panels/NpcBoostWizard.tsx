import { useMemo, useState } from 'react';
import type { Character } from 'shared';
import { applyNpcBoost, planNpcBoost } from 'shared';
import { intents } from '../store/game';

/**
 * A generic "level up" for NPCs/monsters, which have no PC class for the
 * regular LevelUpWizard to work with. Scales HP/AC/attack bonus/damage by N
 * Challenge Rating tiers using the DMG's "Monster Statistics by Challenge
 * Rating" table, and bumps `level` so a caster NPC's derived save DC/attack
 * (which do scale off level+ability) rise too.
 */
export function NpcBoostWizard({ character, onClose }: { character: Character; onClose: () => void }) {
  const [steps, setSteps] = useState(1);
  const plan = useMemo(() => planNpcBoost(character.sheet, steps), [character.sheet, steps]);

  function apply() {
    intents.updateCharacter(character.id, applyNpcBoost(character.sheet, plan));
    onClose();
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup">
        <div className="dock-header">
          <h3>Boost NPC — {character.name}</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>

        <p className="dim" style={{ fontSize: 12 }}>
          This NPC has no PC class, so there's nothing for the regular Level Up wizard to apply.
          This scales its stats by Challenge Rating tier instead (DMG Monster Statistics by CR).
        </p>

        <label className="lu-field">
          Tiers to boost
          <input
            type="number" min={1} max={10} value={steps}
            onChange={(e) => setSteps(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
          />
        </label>

        <p className="lu-summary">
          Roughly CR <strong>{plan.fromCr}</strong> → CR <strong>{plan.toCr}</strong>
        </p>

        <ul className="lu-features">
          <li>Max HP: <strong>{plan.newMaxHp}</strong> (current HP heals by the same amount)</li>
          <li>AC: <strong>{plan.newAc}</strong></li>
          {plan.attackBonusGain > 0 && <li>Every attack's hit bonus: <strong>+{plan.attackBonusGain}</strong></li>}
          {plan.damageBonusGain > 0 && <li>Every attack's damage: <strong>+{plan.damageBonusGain}</strong></li>}
          <li>Level (drives any spellcasting DC/attack): <strong>{plan.newLevel}</strong></li>
          <li className="dim">Approx. spell save DC at this tier: {plan.approxSaveDc} (only applies if this NPC casts spells)</li>
        </ul>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" style={{ width: 'auto' }} onClick={apply}>Apply boost</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
