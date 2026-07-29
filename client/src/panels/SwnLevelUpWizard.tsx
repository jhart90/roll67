import { useMemo, useState } from 'react';
import type { Character } from 'shared';
import {
  applyFocus, applyLevelUpSwn, getSwnClass, planLevelUpSwn, SWN_BACKGROUNDS, SWN_CLASS_LIST,
  SWN_FOCI, swnMod, takenFocusIds,
} from 'shared';
import { intents } from '../store/game';
import { PickerModal } from './SwnFeatures';

type Step = 'class' | 'hp' | 'background' | 'focus' | 'review';

/**
 * Guided SWN level-up, one decision per pane: class (first time only, with
 * each class's actual trade-offs spelled out), hit points, background with its
 * free skill (level 1 only), an optional focus, and a review. The rules math
 * lives in shared/systems/swnData.ts; this file is presentation and pacing.
 */
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
  const [focusPicked, setFocusPicked] = useState('');
  const [stepIdx, setStepIdx] = useState(0);

  const plan = useMemo(
    () => planLevelUpSwn(sheet, classId, toLevel),
    [sheet, classId, toLevel],
  );

  // One decision per pane. The class pane only exists before the class is
  // locked in; the background pane only at level 1, when SWN grants one.
  const STEPS = useMemo<Array<{ id: Step; label: string }>>(() => {
    const s: Array<{ id: Step; label: string }> = [];
    if (!established) s.push({ id: 'class', label: 'Class' });
    s.push({ id: 'hp', label: 'Hit Points' });
    if (plan?.first) s.push({ id: 'background', label: 'Background' });
    s.push({ id: 'focus', label: 'Focus' });
    s.push({ id: 'review', label: 'Review' });
    return s;
  }, [established, plan?.first]);
  const step = STEPS[Math.min(stepIdx, STEPS.length - 1)].id;

  const conMod = swnMod(Number(sheet.con ?? 10));
  const rolling = !!plan && !plan.first && hpMode === 'roll';
  const valid = !!plan && (curLevel < 10 || !established);
  const skillPoints = 2 + (classId === 'expert' || (classId === 'adventurer' && String(sheet.secondaryClass ?? '').toLowerCase() === 'expert') ? 1 : 0);

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
    setFocusPicked(f.name);
    setShowFocus(false);
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup swc-wizard">
        <div className="dock-header">
          <h3>Level Up — {character.name}{plan ? ` → level ${plan.toLevel}` : ''}</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>

        {established && curLevel >= 10 ? (
          <p className="dim">Already at level 10 (the SWN maximum).</p>
        ) : plan && (
          <>
            <div className="swc-steps">
              {STEPS.map((s, i) => (
                <button key={s.id} className={i === stepIdx ? 'active' : ''} disabled={i > stepIdx} onClick={() => setStepIdx(i)}>
                  {s.label}
                </button>
              ))}
            </div>

            {step === 'class' && (
              <>
                <h4>What class is {character.name}?</h4>
                <p className="dim" style={{ fontSize: 12 }}>
                  The class fixes your attack bonus curve, per-level HP, skill points, and your once-per-scene
                  class ability. It can't be changed after this.
                </p>
                {SWN_CLASS_LIST.map((c) => (
                  <label key={c.id} className={`lu-skill ${classId === c.id ? 'on' : ''}`}>
                    <input type="radio" checked={classId === c.id} onChange={() => setClassId(c.id)} />
                    <span>
                      <strong>{c.name}</strong>
                      <br />
                      <span className="dim" style={{ fontSize: 11 }}>{c.ability}</span>
                    </span>
                  </label>
                ))}
              </>
            )}

            {step === 'hp' && (
              <>
                <h4>How do you take your new hit points?</h4>
                {plan.first ? (
                  <>
                    <p className="lu-summary">
                      Level 1 takes the maximum: <strong>+{plan.firstHp} HP</strong> (6 + CON{plan.hpBonusPerLevel ? ` + ${plan.hpBonusPerLevel} Warrior` : ''}).
                    </p>
                    <p className="dim" style={{ fontSize: 12 }}>
                      No decision here — a starting character always gets a full hit die. Hit next to continue.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="dim" style={{ fontSize: 12 }}>
                      SWN characters stay fragile; a d6 hit die means every point matters. Average is guaranteed.
                      Rolling can beat it or come up short, and it happens in chat in front of everyone on Apply.
                    </p>
                    <label className={`lu-skill ${hpMode === 'avg' ? 'on' : ''}`}>
                      <input type="radio" checked={hpMode === 'avg'} onChange={() => setHpMode('avg')} />
                      <span><strong>Take the average: +{plan.avgHp} HP</strong><br />
                        <span className="dim" style={{ fontSize: 11 }}>Guaranteed, no drama.</span></span>
                    </label>
                    <label className={`lu-skill ${hpMode === 'roll' ? 'on' : ''}`}>
                      <input type="radio" checked={hpMode === 'roll'} onChange={() => setHpMode('roll')} />
                      <span><strong>Roll 1d6{conMod + plan.hpBonusPerLevel !== 0 ? ` ${conMod + plan.hpBonusPerLevel > 0 ? '+' : ''}${conMod + plan.hpBonusPerLevel}` : ''}</strong><br />
                        <span className="dim" style={{ fontSize: 11 }}>Rolled in chat when you Apply — no taking it back.</span></span>
                    </label>
                  </>
                )}
              </>
            )}

            {step === 'background' && (
              <>
                <h4>Where did {character.name} come from?</h4>
                <p className="dim" style={{ fontSize: 12 }}>
                  A background is who you were before the campaign, and it grants its free skill at level-0
                  immediately. Optional — skip if none fits.
                </p>
                <div className="swc-skill-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  {SWN_BACKGROUNDS.map((b) => (
                    <label key={b.id} className={`lu-skill ${background === b.id ? 'on' : ''}`}>
                      <input
                        type="radio" checked={background === b.id}
                        onChange={() => setBackground(background === b.id ? '' : b.id)}
                      />
                      <span>
                        <strong>{b.name}</strong> <span className="dim" style={{ fontSize: 11 }}>· free {b.freeSkill}</span>
                        <br />
                        <span className="dim" style={{ fontSize: 11 }}>{b.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}

            {step === 'focus' && (
              <>
                <h4>Pick a focus? (optional)</h4>
                <p className="dim" style={{ fontSize: 12 }}>
                  Foci are your edge — trained specialities like Gunslinger or Die Hard that grant skills and
                  live mechanical hooks. Taking one you already have advances it to level 2. You can also add
                  foci any time from the Core tab, so skipping here costs nothing.
                </p>
                {focusPicked
                  ? <p className="lu-summary">Added: <strong>{focusPicked}</strong> ✓</p>
                  : <button type="button" className="btn" onClick={() => setShowFocus(true)}>Browse foci…</button>}
              </>
            )}

            {step === 'review' && (
              <>
                <h4>{plan.first ? `Become a level 1 ${plan.className}` : `Become level ${plan.toLevel}`}</h4>
                <p className="lu-summary">
                  {rolling ? 'HP rolled on Apply' : `+${plan.first ? plan.firstHp : plan.avgHp} HP`}
                  {' '}· attack bonus{' '}
                  {plan.first || Number(sheet.attackBonus ?? 0) === plan.attackBonus
                    ? <strong>+{plan.attackBonus}</strong>
                    : <><strong>+{Number(sheet.attackBonus ?? 0)}</strong> → <strong>+{plan.attackBonus}</strong></>}
                  {' '}· +{skillPoints} skill points to spend on the Skills list
                  {plan.first && background ? <> · {SWN_BACKGROUNDS.find((b) => b.id === background)?.name}</> : null}
                </p>
                <div className="lu-field">
                  <span>Your class ability</span>
                  <span className="dim" style={{ fontSize: 12 }}>{plan.ability}</span>
                </div>
                <p className="dim" style={{ fontSize: 12 }}>
                  HP, attack bonus and skill points apply to the sheet automatically; spend the points from the
                  sheet's Skills section whenever you like.
                </p>
              </>
            )}

            <div className="row" style={{ marginTop: 12 }}>
              {stepIdx > 0 && <button onClick={() => setStepIdx((i) => i - 1)}>◀ back</button>}
              {step !== 'review' ? (
                <button className="primary" style={{ width: 'auto' }} onClick={() => setStepIdx((i) => i + 1)}>
                  next ▶
                </button>
              ) : (
                <button className="primary" style={{ width: 'auto' }} disabled={!valid} onClick={apply}>
                  Apply — become level {plan.toLevel}
                </button>
              )}
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
