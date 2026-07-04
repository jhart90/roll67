import { useMemo, useState } from 'react';
import type { Character } from 'shared';
import { applyLevelUp, CLASS_LIST_5E, FEATS_5E, getClass5e, getFeat, meetsPrereq, planLevelUp, SKILLS_5E } from 'shared';
import { intents } from '../store/game';

const FEATS_SORTED = [...FEATS_5E].sort((a, b) => a.name.localeCompare(b.name));

const ABILITIES = [
  { id: 'str', label: 'STR' }, { id: 'dex', label: 'DEX' }, { id: 'con', label: 'CON' },
  { id: 'int', label: 'INT' }, { id: 'wis', label: 'WIS' }, { id: 'cha', label: 'CHA' },
];
const SKILL_LABEL: Record<string, string> = Object.fromEntries(SKILLS_5E.map((s) => [s.id, s.label]));

/** Guided 5e level-up: picks class/subclass/HP/ASI/skills and applies the chassis. */
export function LevelUpWizard({ character, onClose }: { character: Character; onClose: () => void }) {
  const curLevel = Number(character.sheet.level) || 0;
  const curClass = String(character.sheet.class ?? '').trim();
  // With no class yet, this is the initial level-1 setup; otherwise +1.
  const toLevel = curClass ? Math.min(20, curLevel + 1) : Math.max(1, curLevel);

  const [classId, setClassId] = useState(curClass ? getClass5e(curClass)?.id ?? '' : '');
  const [hpMode, setHpMode] = useState<'avg' | 'roll'>('avg');
  const [subclass, setSubclass] = useState('');
  const [asiMode, setAsiMode] = useState<'asi' | 'feat'>('asi');
  const [asiA, setAsiA] = useState('str');
  const [asiB, setAsiB] = useState('con');
  const [featId, setFeatId] = useState('');
  const [featAbility, setFeatAbility] = useState('');
  const [skills, setSkills] = useState<string[]>([]);

  const featChoice = featId ? getFeat(featId)?.abilityChoice : undefined;

  const plan = useMemo(
    () => (classId ? planLevelUp(character.sheet, classId, toLevel) : null),
    [classId, character.sheet, toLevel],
  );

  const conMod = Math.floor((Number(character.sheet.con ?? 10) - 10) / 2);
  // Level 1 always takes max hit die. A "roll" is deferred to Apply and rolled
  // server-side, so nothing is shown until the player commits.
  const rolling = !!plan && !plan.first && hpMode === 'roll';

  function toggleSkill(id: string) {
    setSkills((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }

  const valid = !!plan
    && (!plan.needsSubclass || !!subclass)
    && (!plan.asi || (asiMode === 'asi' ? !!asiA && !!asiB : !!featId && (!featChoice || !!featAbility)))
    && (plan.needsSkills === 0 || skills.length === plan.needsSkills);

  function apply() {
    if (!plan) return;
    const choices = {
      subclass: plan.needsSubclass ? subclass : undefined,
      asi: plan.asi ? { mode: asiMode, a: asiA, b: asiB, featId, featAbility } : undefined,
      skills: plan.needsSkills > 0 ? skills : undefined,
    };
    if (rolling) {
      // Build the patch on the average baseline; the server rolls the hit die,
      // adjusts the HP, applies it, and posts the roll to chat for everyone.
      const patch = applyLevelUp(character.sheet, plan.classId, toLevel, { hpGained: plan.avgHp, ...choices });
      intents.levelUpRoll({
        characterId: character.id, patch, hitDie: plan.hitDie, conMod, avgHp: plan.avgHp,
        label: `${character.name}: level ${plan.toLevel} hit points`,
      });
    } else {
      const patch = applyLevelUp(character.sheet, plan.classId, toLevel, {
        hpGained: plan.first ? plan.firstHp : plan.avgHp, ...choices,
      });
      intents.updateCharacter(character.id, patch);
    }
    onClose();
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup">
        <div className="dock-header">
          <h3>Level Up — {character.name}</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>

        {curLevel >= 20 ? (
          <p className="dim">Already at level 20.</p>
        ) : (
          <>
            <label className="lu-field">
              Class
              <select value={classId} onChange={(e) => setClassId(e.target.value)} disabled={!!curClass}>
                <option value="">Choose a class…</option>
                {CLASS_LIST_5E.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>

            {plan && (
              <>
                <p className="lu-summary">
                  {plan.first
                    ? <>New level <strong>1 {plan.className}</strong></>
                    : <>Level <strong>{plan.fromLevel}</strong> → <strong>{plan.toLevel}</strong></>}
                  {' '}· d{plan.hitDie} hit die · proficiency +{plan.profBonus}
                </p>

                <div className="lu-field">
                  <span>Hit points</span>
                  {plan.first ? (
                    <span className="dim">Level 1 takes the maximum: <strong>+{plan.firstHp} HP</strong> (d{plan.hitDie} + CON).</span>
                  ) : (
                    <div className="lu-hp">
                      <label className="check-row" style={{ margin: 0 }}>
                        <input type="radio" checked={hpMode === 'avg'} onChange={() => setHpMode('avg')} />
                        Average (+{plan.avgHp})
                      </label>
                      <label className="check-row" style={{ margin: 0 }}>
                        <input type="radio" checked={hpMode === 'roll'} onChange={() => setHpMode('roll')} />
                        Roll 1d{plan.hitDie}{conMod !== 0 ? ` ${conMod > 0 ? '+' : ''}${conMod}` : ''}
                      </label>
                      {hpMode === 'roll' && <span className="dim" style={{ fontSize: 11 }}>rolled on apply, shown in chat</span>}
                    </div>
                  )}
                </div>

                {plan.needsSubclass && (
                  <label className="lu-field">
                    {plan.subclassLabel}
                    <select value={subclass} onChange={(e) => setSubclass(e.target.value)}>
                      <option value="">Choose…</option>
                      {plan.subclasses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                )}

                {plan.asi && (
                  <div className="lu-field">
                    <span>Ability Score Improvement</span>
                    <div className="lu-asi">
                      <label className="check-row" style={{ margin: 0 }}>
                        <input type="radio" checked={asiMode === 'asi'} onChange={() => setAsiMode('asi')} /> Raise abilities
                      </label>
                      {asiMode === 'asi' && (
                        <div className="row">
                          <select value={asiA} onChange={(e) => setAsiA(e.target.value)}>{ABILITIES.map((a) => <option key={a.id} value={a.id}>+1 {a.label}</option>)}</select>
                          <select value={asiB} onChange={(e) => setAsiB(e.target.value)}>{ABILITIES.map((a) => <option key={a.id} value={a.id}>+1 {a.label}</option>)}</select>
                          <span className="dim" style={{ fontSize: 11 }}>(same twice = +2)</span>
                        </div>
                      )}
                      <label className="check-row" style={{ margin: 0 }}>
                        <input type="radio" checked={asiMode === 'feat'} onChange={() => setAsiMode('feat')} /> Take a feat
                      </label>
                      {asiMode === 'feat' && (
                        <div className="row" style={{ flexWrap: 'wrap' }}>
                          <select value={featId} onChange={(e) => { setFeatId(e.target.value); setFeatAbility(''); }}>
                            <option value="">Choose a feat…</option>
                            {FEATS_SORTED.map((ft) => (
                              <option key={ft.id} value={ft.id} disabled={!meetsPrereq(character.sheet, ft)}>
                                {ft.name}{ft.prereq ? ` (${ft.prereq}${!meetsPrereq(character.sheet, ft) ? ' — not met' : ''})` : ''}
                              </option>
                            ))}
                          </select>
                          {featChoice && (
                            <select value={featAbility} onChange={(e) => setFeatAbility(e.target.value)}>
                              <option value="">+1 to…</option>
                              {featChoice.map((ab) => <option key={ab} value={ab}>+1 {ab.toUpperCase()}</option>)}
                            </select>
                          )}
                          {featId && <span className="dim" style={{ fontSize: 11, flexBasis: '100%' }}>{getFeat(featId)?.desc}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {plan.needsSkills > 0 && (
                  <div className="lu-field">
                    <span>Skill proficiencies — choose {plan.needsSkills} ({skills.length}/{plan.needsSkills})</span>
                    <div className="lu-skills">
                      {plan.skillList.map((s) => (
                        <label key={s} className={`lu-skill ${skills.includes(s) ? 'on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={skills.includes(s)}
                            disabled={!skills.includes(s) && skills.length >= plan.needsSkills}
                            onChange={() => toggleSkill(s)}
                          />
                          {SKILL_LABEL[s] ?? s}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {plan.featuresGained.length > 0 && (
                  <div className="lu-field">
                    <span>Features gained</span>
                    <ul className="lu-features">
                      {plan.featuresGained.map((f) => (
                        <li key={f.name}><strong>{f.name}</strong> — <span className="dim">{f.desc}</span></li>
                      ))}
                      {plan.gainsSubclassFeature && <li className="dim">+ a {subclass || plan.subclassLabel} feature</li>}
                    </ul>
                  </div>
                )}

                <div className="row" style={{ marginTop: 12 }}>
                  <button className="primary" style={{ width: 'auto' }} disabled={!valid} onClick={apply}>
                    Apply — become level {plan.toLevel}
                  </button>
                  <button onClick={onClose}>Cancel</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
