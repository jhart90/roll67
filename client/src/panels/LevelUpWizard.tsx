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

type Step = 'class' | 'hp' | 'subclass' | 'asiMode' | 'asiPick' | 'skills' | 'review';

/**
 * Guided 5e level-up, one decision per pane: class (first time only), hit
 * points, subclass when the level grants one, ASI-vs-feat then the specific
 * pick, skills, and a review of everything gained. The rules math all lives
 * in shared/systems/levelup5e.ts; this file is presentation and pacing.
 */
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
  const [stepIdx, setStepIdx] = useState(0);

  const featChoice = featId ? getFeat(featId)?.abilityChoice : undefined;

  const plan = useMemo(
    () => (classId ? planLevelUp(character.sheet, classId, toLevel) : null),
    [classId, character.sheet, toLevel],
  );

  // One decision per pane; panes the level doesn't call for simply don't exist.
  const STEPS = useMemo<Array<{ id: Step; label: string }>>(() => {
    const s: Array<{ id: Step; label: string }> = [];
    if (!curClass) s.push({ id: 'class', label: 'Class' });
    if (plan) {
      s.push({ id: 'hp', label: 'Hit Points' });
      if (plan.needsSubclass) s.push({ id: 'subclass', label: plan.subclassLabel });
      if (plan.asi) {
        s.push({ id: 'asiMode', label: 'ASI or Feat' });
        s.push({ id: 'asiPick', label: asiMode === 'asi' ? 'Abilities' : 'Feat' });
      }
      if (plan.needsSkills > 0) s.push({ id: 'skills', label: 'Skills' });
      s.push({ id: 'review', label: 'Review' });
    }
    return s.length ? s : [{ id: 'class', label: 'Class' }];
  }, [curClass, plan, asiMode]);
  const step = STEPS[Math.min(stepIdx, STEPS.length - 1)].id;

  const conMod = Math.floor((Number(character.sheet.con ?? 10) - 10) / 2);
  // Level 1 always takes max hit die. A "roll" is deferred to Apply and rolled
  // server-side, so nothing is shown until the player commits.
  const rolling = !!plan && !plan.first && hpMode === 'roll';

  function toggleSkill(id: string) {
    setSkills((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }

  const stepDone: Record<Step, boolean> = {
    class: !!classId,
    hp: true,
    subclass: !!subclass,
    asiMode: true,
    asiPick: asiMode === 'asi' ? !!asiA && !!asiB : !!featId && (!featChoice || !!featAbility),
    skills: !plan || skills.length === plan.needsSkills,
    review: true,
  };
  const valid = !!plan && STEPS.every((s) => stepDone[s.id]);

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
    <div className="sheet-backdrop wizard-shell">
      <div className="panel levelup swc-wizard">
        {curLevel >= 20 ? (
          <p className="dim">Already at level 20.</p>
        ) : (
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
                  The class decides your hit die (how tough you get each level), which two saving throws you're
                  good at, and every feature you'll gain from here to level 20. It can't be changed later.
                </p>
                <div className="swc-skill-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  {CLASS_LIST_5E.map((c) => {
                    const def = getClass5e(c.id);
                    return (
                      <label key={c.id} className={`lu-skill ${classId === c.id ? 'on' : ''}`}>
                        <input type="radio" checked={classId === c.id} onChange={() => setClassId(c.id)} />
                        <span>
                          <strong>{c.name}</strong>
                          <br />
                          <span className="dim" style={{ fontSize: 11 }}>
                            d{def?.hitDie} hit die · {def?.saves.map((x) => x.toUpperCase()).join(' & ')} saves
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            {step === 'hp' && plan && (
              <>
                <h4>How do you take your new hit points?</h4>
                {plan.first ? (
                  <>
                    <p className="lu-summary">Level 1 always takes the maximum: <strong>+{plan.firstHp} HP</strong> (d{plan.hitDie} + CON modifier).</p>
                    <p className="dim" style={{ fontSize: 12 }}>
                      No decision here — every 5e character starts with a full hit die so a first fight can't
                      end them on a bad roll. Hit next to continue.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="dim" style={{ fontSize: 12 }}>
                      Your maximum HP goes up either way; this only decides by how much. Average is the safe,
                      guaranteed number. Rolling can beat it — or come in under. The roll happens in front of
                      the whole table when you hit Apply, and there's no taking it back.
                    </p>
                    <label className={`lu-skill ${hpMode === 'avg' ? 'on' : ''}`}>
                      <input type="radio" checked={hpMode === 'avg'} onChange={() => setHpMode('avg')} />
                      <span><strong>Take the average: +{plan.avgHp} HP</strong><br />
                        <span className="dim" style={{ fontSize: 11 }}>Guaranteed. What most tables do.</span></span>
                    </label>
                    <label className={`lu-skill ${hpMode === 'roll' ? 'on' : ''}`}>
                      <input type="radio" checked={hpMode === 'roll'} onChange={() => setHpMode('roll')} />
                      <span><strong>Roll 1d{plan.hitDie}{conMod !== 0 ? ` ${conMod > 0 ? '+' : ''}${conMod}` : ''}</strong><br />
                        <span className="dim" style={{ fontSize: 11 }}>
                          Anywhere from +{Math.max(1, 1 + conMod)} to +{plan.hitDie + conMod} HP, rolled in chat on Apply.
                        </span></span>
                    </label>
                  </>
                )}
              </>
            )}

            {step === 'subclass' && plan && (
              <>
                <h4>Choose your {plan.subclassLabel}</h4>
                <p className="dim" style={{ fontSize: 12 }}>
                  This is the defining fork in a {plan.className}'s career: it grants a feature now and more at
                  several later levels, and it is permanent.
                </p>
                <div className="swc-skill-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  {plan.subclasses.map((s) => (
                    <label key={s} className={`lu-skill ${subclass === s ? 'on' : ''}`}>
                      <input type="radio" checked={subclass === s} onChange={() => setSubclass(s)} />
                      <span>{s}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            {step === 'asiMode' && (
              <>
                <h4>Raise your abilities, or take a feat?</h4>
                <p className="dim" style={{ fontSize: 12 }}>
                  This level grants an Ability Score Improvement. Higher abilities quietly improve everything they
                  touch — attacks, saves, skills, spell DCs. A feat instead gives you one distinctive new trick.
                </p>
                <label className={`lu-skill ${asiMode === 'asi' ? 'on' : ''}`}>
                  <input type="radio" checked={asiMode === 'asi'} onChange={() => setAsiMode('asi')} />
                  <span><strong>Ability Score Improvement</strong><br />
                    <span className="dim" style={{ fontSize: 11 }}>+2 to one ability, or +1 to two. The steady, always-good option.</span></span>
                </label>
                <label className={`lu-skill ${asiMode === 'feat' ? 'on' : ''}`}>
                  <input type="radio" checked={asiMode === 'feat'} onChange={() => setAsiMode('feat')} />
                  <span><strong>Take a feat</strong><br />
                    <span className="dim" style={{ fontSize: 11 }}>A named capability from the full PHB list — many carry +1 to an ability too.</span></span>
                </label>
              </>
            )}

            {step === 'asiPick' && asiMode === 'asi' && (
              <>
                <h4>Which abilities go up?</h4>
                <p className="dim" style={{ fontSize: 12 }}>
                  Pick the same ability twice for +2, or spread +1 across two. Every even score is a bigger
                  modifier — going 15 → 16 changes your rolls, 16 → 17 doesn't yet.
                </p>
                <div className="row">
                  <select value={asiA} onChange={(e) => setAsiA(e.target.value)}>{ABILITIES.map((a) => <option key={a.id} value={a.id}>+1 {a.label}</option>)}</select>
                  <select value={asiB} onChange={(e) => setAsiB(e.target.value)}>{ABILITIES.map((a) => <option key={a.id} value={a.id}>+1 {a.label}</option>)}</select>
                </div>
              </>
            )}

            {step === 'asiPick' && asiMode === 'feat' && (
              <>
                <h4>Choose your feat</h4>
                <p className="dim" style={{ fontSize: 12 }}>
                  Greyed-out feats have a prerequisite you don't meet yet. Feats with an ability choice ask which
                  ability their +1 goes to.
                </p>
                <select value={featId} onChange={(e) => { setFeatId(e.target.value); setFeatAbility(''); }}>
                  <option value="">Choose a feat…</option>
                  {FEATS_SORTED.map((ft) => (
                    <option key={ft.id} value={ft.id} disabled={!meetsPrereq(character.sheet, ft)}>
                      {ft.name}{ft.prereq ? ` (${ft.prereq}${!meetsPrereq(character.sheet, ft) ? ' — not met' : ''})` : ''}
                    </option>
                  ))}
                </select>
                {featChoice && (
                  <select value={featAbility} onChange={(e) => setFeatAbility(e.target.value)} style={{ marginTop: 6 }}>
                    <option value="">This feat's +1 goes to…</option>
                    {featChoice.map((ab) => <option key={ab} value={ab}>+1 {ab.toUpperCase()}</option>)}
                  </select>
                )}
                {featId && <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>{getFeat(featId)?.desc}</p>}
              </>
            )}

            {step === 'skills' && plan && (
              <>
                <h4>Choose {plan.needsSkills} skill {plan.needsSkills === 1 ? 'proficiency' : 'proficiencies'} ({skills.length}/{plan.needsSkills})</h4>
                <p className="dim" style={{ fontSize: 12 }}>
                  Proficiency adds +{plan.profBonus} to these skills now, growing as you level. You can only pick
                  from your class's list.
                </p>
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
              </>
            )}

            {step === 'review' && plan && (
              <>
                <h4>{plan.first ? `Become a level 1 ${plan.className}` : `Become level ${plan.toLevel}`}</h4>
                <p className="lu-summary">
                  d{plan.hitDie} hit die · proficiency +{plan.profBonus} · {rolling ? `HP rolled on Apply (1d${plan.hitDie}${conMod !== 0 ? `${conMod > 0 ? '+' : ''}${conMod}` : ''})` : `+${plan.first ? plan.firstHp : plan.avgHp} HP`}
                  {plan.needsSubclass && subclass ? <> · {subclass}</> : null}
                </p>
                {plan.featuresGained.length > 0 && (
                  <div className="lu-field">
                    <span>Features gained at this level</span>
                    <ul className="lu-features">
                      {plan.featuresGained.map((f) => (
                        <li key={f.name}><strong>{f.name}</strong> — <span className="dim">{f.desc}</span></li>
                      ))}
                      {plan.gainsSubclassFeature && <li className="dim">+ a {subclass || plan.subclassLabel} feature</li>}
                    </ul>
                  </div>
                )}
                <p className="dim" style={{ fontSize: 12 }}>
                  Everything numeric — HP, saves, slots, proficiency — is applied to the sheet automatically.
                </p>
              </>
            )}

            <div className="row" style={{ marginTop: 12 }}>
              {stepIdx > 0 && <button onClick={() => setStepIdx((i) => i - 1)}>◀ back</button>}
              {step !== 'review' ? (
                <button
                  className="primary" style={{ width: 'auto' }}
                  disabled={!stepDone[step] || (step === 'class' && !plan)}
                  onClick={() => setStepIdx((i) => i + 1)}
                >
                  next ▶
                </button>
              ) : (
                <button className="primary" style={{ width: 'auto' }} disabled={!valid} onClick={apply}>
                  Apply — become level {plan?.toLevel}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
