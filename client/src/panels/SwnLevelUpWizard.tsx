import { useMemo, useState } from 'react';
import type { Character } from 'shared';
import {
  applyFocus, applyLevelUpSwn, getSwnClass, planLevelUpSwn, SWN_BACKGROUNDS, SWN_CLASS_LIST,
  SWN_FOCI, swnMod, takenFocusIds,
} from 'shared';
import { intents } from '../store/game';
import { PickerModal } from './SwnFeatures';

/** Guided SWN level-up: sets class, HP (max at 1 / average / roll), attack bonus,
 *  and — on the first level — a background with its free skill. */
export function SwnLevelUpWizard({ character, onClose }: { character: Character; onClose: () => void }) {
  const sheet = character.sheet;
  const curLevel = Number(sheet.level) || 1;
  const foci = Array.isArray(sheet.foci) ? (sheet.foci as Array<Record<string, unknown>>) : [];
  const established = foci.some((f) => String(f.id ?? '').startsWith('class-'));
  // First time through we establish level 1; afterwards each pass adds a level.
  const toLevel = established ? Math.min(10, curLevel + 1) : 1;

  const [classId, setClassId] = useState(getSwnClass(String(sheet.class ?? 'expert'))?.id ?? 'expert');
  const [hpMode, setHpMode] = useState<'avg' | 'roll'>('avg');
  const [background, setBackground] = useState('');
  const [showFocus, setShowFocus] = useState(false);

  const plan = useMemo(
    () => planLevelUpSwn(sheet, classId, toLevel),
    [sheet, classId, toLevel],
  );

  const conMod = swnMod(Number(sheet.con ?? 10));
  const rolling = !!plan && !plan.first && hpMode === 'roll';

  const valid = !!plan && (curLevel < 10 || !established);

  function apply() {
    if (!plan) return;
    const bg = plan.first && background ? background : undefined;
    if (rolling) {
      const patch = applyLevelUpSwn(sheet, plan.classId, toLevel, { hpGained: plan.avgHp });
      // Fold the class HP bonus (Warrior +2) into the modifier the server rolls.
      intents.levelUpRoll({
        characterId: character.id, patch, hitDie: 6, conMod: conMod + plan.hpBonusPerLevel,
        avgHp: plan.avgHp, label: `${character.name}: level ${plan.toLevel} hit points`,
      });
    } else {
      const patch = applyLevelUpSwn(sheet, plan.classId, toLevel, {
        hpGained: plan.first ? plan.firstHp : plan.avgHp, background: bg,
      });
      intents.updateCharacter(character.id, patch);
    }
    onClose();
  }

  function addFocus(id: string) {
    const f = SWN_FOCI.find((x) => x.id === id)!;
    const already = takenFocusIds(sheet).includes(id);
    intents.updateCharacter(character.id, applyFocus(sheet, id));
    intents.chat(`${character.name} ${already ? 'advances' : 'gains'} the ${f.name} focus.`);
    setShowFocus(false);
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup">
        <div className="dock-header">
          <h3>Level Up — {character.name}</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>

        {established && curLevel >= 10 ? (
          <p className="dim">Already at level 10 (the SWN maximum).</p>
        ) : plan && (
          <>
            <label className="lu-field">
              Class
              <select value={classId} onChange={(e) => setClassId(e.target.value)} disabled={established}>
                {SWN_CLASS_LIST.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>

            <p className="lu-summary">
              {plan.first
                ? <>New level <strong>1 {plan.className}</strong></>
                : <>Level <strong>{plan.fromLevel}</strong> → <strong>{plan.toLevel}</strong></>}
              {' '}· d6 hit die · attack bonus{' '}
              {plan.first || Number(sheet.attackBonus ?? 0) === plan.attackBonus
                ? <strong>+{plan.attackBonus}</strong>
                : <><strong>+{Number(sheet.attackBonus ?? 0)}</strong> → <strong>+{plan.attackBonus}</strong></>}
              {' '}· +{2 + (classId === 'expert' || (classId === 'adventurer' && String(sheet.secondaryClass ?? '').toLowerCase() === 'expert') ? 1 : 0)} skill points
            </p>

            <div className="lu-field">
              <span>Hit points</span>
              {plan.first ? (
                <span className="dim">Level 1 takes the maximum: <strong>+{plan.firstHp} HP</strong> (6 + CON{plan.hpBonusPerLevel ? ` + ${plan.hpBonusPerLevel} Warrior` : ''}).</span>
              ) : (
                <div className="lu-hp">
                  <label className="check-row" style={{ margin: 0 }}>
                    <input type="radio" checked={hpMode === 'avg'} onChange={() => setHpMode('avg')} />
                    Average (+{plan.avgHp})
                  </label>
                  <label className="check-row" style={{ margin: 0 }}>
                    <input type="radio" checked={hpMode === 'roll'} onChange={() => setHpMode('roll')} />
                    Roll 1d6{conMod + plan.hpBonusPerLevel !== 0 ? ` ${conMod + plan.hpBonusPerLevel > 0 ? '+' : ''}${conMod + plan.hpBonusPerLevel}` : ''}
                  </label>
                  {hpMode === 'roll' && <span className="dim" style={{ fontSize: 11 }}>rolled on apply, shown in chat</span>}
                </div>
              )}
            </div>

            {plan.first && (
              <label className="lu-field">
                Background (grants a free skill)
                <select value={background} onChange={(e) => setBackground(e.target.value)}>
                  <option value="">Choose… (optional)</option>
                  {SWN_BACKGROUNDS.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.freeSkill}</option>)}
                </select>
              </label>
            )}

            <div className="lu-field">
              <span>Class ability</span>
              <span className="dim" style={{ fontSize: 12 }}>{plan.ability}</span>
            </div>

            <div className="lu-field">
              <span>Focus (optional — foci can also be picked any time from the Core tab)</span>
              <button type="button" className="btn btn-sm" onClick={() => setShowFocus(true)}>+ Pick a focus</button>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" style={{ width: 'auto' }} disabled={!valid} onClick={apply}>
                Apply — become level {plan.toLevel}
              </button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>

      {showFocus && (
        <PickerModal
          title="Foci" subtitle={`add to ${character.name}`} onClose={() => setShowFocus(false)}
          taken={new Set(takenFocusIds(sheet))}
          items={SWN_FOCI.map((f) => ({
            id: f.id, name: f.name,
            tag: f.combat ? 'combat' : f.grantsSkill ? f.grantsSkill : undefined,
            desc: f.level1,
          }))}
          onAdd={addFocus}
        />
      )}
    </div>
  );
}
