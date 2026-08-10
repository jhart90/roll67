import { useMemo, useState } from 'react';
import {
  SWN_ATTR_IDS, SWN_BACKGROUNDS, SWN_CLASS_LIST, SWN_FOCI, SWN_PACKAGES, SKILLS_SWN, SPECIES_SWN,
  buildSwnCharacterSheet, roll3d6, swn, swnMod, termDesc, type SwnAttrId, type SwnCreationInput,
} from 'shared';
import { intents } from '../store/game';
import { AppearanceStep, appearancePatch, DEFAULT_APPEARANCE, type AppearanceChoice } from './AppearanceStep';
import { Term } from '../util/Term';

/** Glossary tooltip shorthand for this wizard's system. */
function T({ children, term, desc }: { children?: React.ReactNode; term?: string; desc?: string }) {
  const label = children ?? term;
  return <Term desc={desc ?? termDesc('swn', term ?? String(label))}>{label}</Term>;
}

type Step = 'concept' | 'attributes' | 'class' | 'background' | 'skills' | 'gear' | 'appearance' | 'review';
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'concept', label: 'Concept' },
  { id: 'attributes', label: 'Attributes' },
  { id: 'class', label: 'Class' },
  { id: 'background', label: 'Background' },
  { id: 'skills', label: 'Skills & Focus' },
  { id: 'gear', label: 'Gear' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'review', label: 'Review' },
];

const ATTR_LABEL: Record<SwnAttrId, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

function emptyAttrs(): Record<SwnAttrId, number> {
  return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
}

/**
 * Guided SWN character creation. Unlike the SWADE wizard, most of the rules
 * math already exists and is tested (applyLevelUpSwn/applyBackground/
 * applyFocus/applyPackage) — this component is almost entirely orchestration:
 * roll attributes, pick a class/background/focus/package, spend skill
 * points, then hand the assembled choices to buildSwnCharacterSheet.
 */
export function SwnCharacterCreator({ onClose }: { onClose: () => void }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [appearance, setAppearance] = useState<AppearanceChoice>(DEFAULT_APPEARANCE);
  const step = STEPS[stepIdx].id;

  const [name, setName] = useState('');
  const [homeworld, setHomeworld] = useState('');
  const [species, setSpecies] = useState('Human');
  const [goal, setGoal] = useState('');

  const [attributes, setAttributes] = useState<Record<SwnAttrId, number>>(emptyAttrs());
  const [rolled, setRolled] = useState(false);

  const [classId, setClassId] = useState(SWN_CLASS_LIST[0]?.id ?? 'expert');
  const [secondaryClassId, setSecondaryClassId] = useState('');

  const [backgroundId, setBackgroundId] = useState('');

  const [focusId, setFocusId] = useState('');
  const [skillLevels, setSkillLevels] = useState<Array<{ name: string; attr: SwnAttrId; level: number }>>([]);
  const [skillSearch, setSkillSearch] = useState('');

  const [packageId, setPackageId] = useState('');

  function rollAll() {
    setAttributes({ str: roll3d6(), dex: roll3d6(), con: roll3d6(), int: roll3d6(), wis: roll3d6(), cha: roll3d6() });
    setRolled(true);
  }

  // Skill points earned: 2 (Expert / Adventurer-with-Expert +1), matching
  // applyLevelUpSwn's own math — read here only for the live budget readout.
  const isExpertLike = classId === 'expert' || (classId === 'adventurer' && secondaryClassId.toLowerCase() === 'expert');
  const skillPool = 2 + (isExpertLike ? 1 : 0);
  const skillSpent = skillLevels.reduce((sum, s) => sum + s.level, 0);

  function setSkillLevel(name: string, attr: SwnAttrId, level: number) {
    setSkillLevels((list) => {
      const withoutThis = list.filter((s) => s.name !== name);
      if (level <= 0) return withoutThis;
      return [...withoutThis, { name, attr, level }];
    });
  }
  function skillLevelOf(name: string): number {
    return skillLevels.find((s) => s.name === name)?.level ?? 0;
  }
  function stepSkill(name: string, attr: SwnAttrId, delta: number) {
    const cur = skillLevelOf(name);
    const next = Math.max(0, Math.min(1, cur + delta));
    if (delta > 0 && skillSpent + (next - cur) > skillPool) return;
    setSkillLevel(name, attr, next);
  }

  const canAdvance =
    (step === 'concept' && name.trim().length > 0)
    || (step === 'attributes' && rolled)
    || step === 'class'
    || step === 'background'
    || (step === 'skills' && skillSpent <= skillPool)
    || step === 'gear'
    || step === 'appearance'
    || step === 'review';

  const filteredSkills = SKILLS_SWN.filter((s) => !skillSearch.trim() || s.toLowerCase().includes(skillSearch.trim().toLowerCase()));

  function buildInput(): SwnCreationInput {
    return {
      name, homeworld, goal, attributes, classId,
      secondaryClassId: classId === 'adventurer' ? secondaryClassId : undefined,
      backgroundId: backgroundId || undefined,
      focusId: focusId || undefined,
      packageId: packageId || undefined,
      skillLevels,
    };
  }

  const previewSheet = useMemo(() => (step === 'review' ? buildSwnCharacterSheet(buildInput()) : null), [step]); // eslint-disable-line react-hooks/exhaustive-deps

  function create() {
    const sheetPatch = { ...buildSwnCharacterSheet(buildInput()), species };
    intents.createCharacter(name.trim(), 'swn', undefined, undefined, { sheetPatch: { ...sheetPatch, ...appearancePatch(appearance) }, placeToken: true });
    onClose();
  }

  return (
    <div className="sheet-backdrop wizard-shell">
      <div className="panel levelup swc-wizard">
        <div className="swc-steps">
          {STEPS.map((s, i) => (
            <button key={s.id} className={i === stepIdx ? 'active' : ''} disabled={i > stepIdx} onClick={() => setStepIdx(i)}>
              {s.label}
            </button>
          ))}
        </div>

        {step === 'concept' && (
          <>
            <label className="lu-field">
              Character name
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Kess Rin" />
            </label>
            <label className="lu-field">
              <T>Species</T>
              <select value={species} onChange={(e) => setSpecies(e.target.value)}>
                {SPECIES_SWN.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {termDesc('swn', species) && <p className="dim" style={{ fontSize: 12 }}>{termDesc('swn', species)}</p>}
            <label className="lu-field">
              <T>Homeworld</T>
              <input value={homeworld} onChange={(e) => setHomeworld(e.target.value)} placeholder="e.g. Halcyon" />
            </label>
            <label className="lu-field">
              Goal (optional flavor)
              <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Find the ship that left her behind." />
            </label>
          </>
        )}

        {step === 'attributes' && (
          <>
            <p className="dim" style={{ fontSize: 12 }}>Classic SWN generation: 3d6 per <T term="Attributes">attribute</T>, straight down. Reroll as many times as you like before moving on.</p>
            <button className="btn btn-sm" onClick={rollAll}>{rolled ? '🎲 Reroll all' : '🎲 Roll attributes'}</button>
            {rolled && SWN_ATTR_IDS.map((id) => (
              <div key={id} className="swc-attr-row">
                <span className="swc-attr-label"><T>{ATTR_LABEL[id]}</T></span>
                <input
                  type="number" min={3} max={18} value={attributes[id]}
                  onChange={(e) => setAttributes((a) => ({ ...a, [id]: Math.max(3, Math.min(18, Number(e.target.value) || 10)) }))}
                  style={{ width: 56 }}
                />
                <span className="dim">{swnMod(attributes[id]) >= 0 ? `+${swnMod(attributes[id])}` : swnMod(attributes[id])}</span>
              </div>
            ))}
          </>
        )}

        {step === 'class' && (
          <>
            <label className="lu-field">
              <T>Class</T>
              <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                {SWN_CLASS_LIST.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {classId === 'adventurer' && (
              <label className="lu-field">
                Second class
                <select value={secondaryClassId} onChange={(e) => setSecondaryClassId(e.target.value)}>
                  <option value="">Choose…</option>
                  <option value="Warrior">Warrior</option>
                  <option value="Expert">Expert</option>
                  <option value="Psychic">Psychic</option>
                </select>
              </label>
            )}
            <p className="dim" style={{ fontSize: 12 }}>{SWN_CLASS_LIST.find((c) => c.id === classId)?.ability}</p>
            <p className="dim" style={{ fontSize: 12 }}>Level 1 always takes maximum HP: 6 + CON mod{isExpertLike ? ' · Expert grants 3 skill points' : ' · 2 skill points'}.</p>
          </>
        )}

        {step === 'background' && (
          <>
            <p className="dim" style={{ fontSize: 12 }}>A <T>Background</T> grants a free skill at level 0.</p>
            <div className="swc-hindrance-cols" style={{ gridTemplateColumns: '1fr' }}>
              <label className="lu-skill">
                <input type="radio" checked={backgroundId === ''} onChange={() => setBackgroundId('')} />
                <span>None</span>
              </label>
              {SWN_BACKGROUNDS.map((b) => (
                <label key={b.id} className={`lu-skill ${backgroundId === b.id ? 'on' : ''}`}>
                  <input type="radio" checked={backgroundId === b.id} onChange={() => setBackgroundId(b.id)} />
                  <span><T desc={b.desc}><strong>{b.name}</strong></T> — free <T>{b.freeSkill}</T></span>
                </label>
              ))}
            </div>
          </>
        )}

        {step === 'skills' && (
          <>
            <label className="lu-field">
              <span><T>Focus</T> (optional — most SWN characters take one at 1st level; more can be added later)</span>
              <select value={focusId} onChange={(e) => setFocusId(e.target.value)}>
                <option value="">None</option>
                {SWN_FOCI.map((f) => <option key={f.id} value={f.id}>{f.name}{f.grantsSkill ? ` (${f.grantsSkill})` : ''}</option>)}
              </select>
            </label>
            {focusId && <p className="dim" style={{ fontSize: 12 }}>{SWN_FOCI.find((f) => f.id === focusId)?.level1}</p>}

            <div className={`swc-budget ${skillSpent > skillPool ? 'over' : skillSpent === skillPool ? 'full' : ''}`}>
              <T term="Skill points">Skill points</T>: {skillSpent} / {skillPool}
            </div>
            <input placeholder="Filter skills…" value={skillSearch} onChange={(e) => setSkillSearch(e.target.value)} style={{ marginBottom: 8 }} />
            <div className="swc-skill-grid">
              {filteredSkills.map((s) => {
                const level = skillLevelOf(s);
                return (
                  <div key={s} className="swc-attr-row">
                    <span className="swc-attr-label"><T>{s}</T></span>
                    <button className="icon-btn" disabled={level <= 0} onClick={() => stepSkill(s, 'int', -1)}>−</button>
                    <span className="swc-die">{level}</span>
                    <button className="icon-btn" disabled={level >= 1 || skillSpent >= skillPool} onClick={() => stepSkill(s, 'int', 1)}>+</button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {step === 'gear' && (
          <>
            <p className="dim" style={{ fontSize: 12 }}>An <T term="Equipment package">equipment package</T> outfits you with starting weapons, armor, and gear.</p>
            <div className="swc-hindrance-cols" style={{ gridTemplateColumns: '1fr' }}>
              <label className="lu-skill">
                <input type="radio" checked={packageId === ''} onChange={() => setPackageId('')} />
                <span>None (start with nothing but credits)</span>
              </label>
              {SWN_PACKAGES.map((p) => (
                <label key={p.id} className={`lu-skill ${packageId === p.id ? 'on' : ''}`}>
                  <input type="radio" checked={packageId === p.id} onChange={() => setPackageId(p.id)} />
                  <span>
                    <T desc={`${p.desc} Contents: ${[...p.weapons.map((w) => w.name), ...p.armor.map((a) => a.name), ...p.items.map((it) => it.name)].join(', ')} — plus ${p.credits} credits.`}>
                      <strong>{p.name}</strong>
                    </T> — {p.desc} ({p.credits} cr)
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        {step === 'appearance' && <AppearanceStep value={appearance} onChange={setAppearance} />}

        {step === 'review' && previewSheet && (
          <div className="swc-review">
            <p className="lu-summary">
              <strong>{name}</strong> · <T>{species}</T> · Level 1 <T term="Class">{String(previewSheet.class)}</T>
              {previewSheet.secondaryClass ? `/${previewSheet.secondaryClass}` : ''}
            </p>
            <div className="swc-review-grid">
              {SWN_ATTR_IDS.map((id) => (
                <span key={id} className="cf-chip"><T term={ATTR_LABEL[id]}>{ATTR_LABEL[id].slice(0, 3)}</T> {String(previewSheet[id])}</span>
              ))}
            </div>
            <p className="dim" style={{ fontSize: 12 }}>
              <T>HP</T> {String(previewSheet.hp)}/{String(previewSheet.maxHp)} · <T>AC</T> {String(swn.derive(previewSheet).ac)} · {String(previewSheet.credits ?? 0)} <T term="Credits">credits</T>
            </p>
            <div className="swc-review-grid">
              {(previewSheet.skills as Array<{ name: string; level: number }>).map((s) => (
                <span key={s.name} className="cf-chip"><T>{s.name}</T> {s.level}</span>
              ))}
            </div>
            {(previewSheet.foci as Array<{ name: string }>).filter((f) => !String((f as { id?: string }).id ?? '').startsWith('class-')).length > 0 && (
              <p className="dim" style={{ fontSize: 12 }}>
                <T term="Focus">Foci</T>: {(previewSheet.foci as Array<{ name: string; id?: string }>).filter((f) => !String(f.id ?? '').startsWith('class-')).map((f, i) => (
                  <span key={f.name}>{i > 0 && ', '}<T desc={SWN_FOCI.find((x) => x.name === f.name)?.level1}>{f.name}</T></span>
                ))}
              </p>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          {stepIdx > 0 && <button onClick={() => setStepIdx((i) => i - 1)}>◀ back</button>}
          {step !== 'review' ? (
            <button className="primary" style={{ width: 'auto' }} disabled={!canAdvance} onClick={() => setStepIdx((i) => i + 1)}>
              next ▶
            </button>
          ) : (
            <button className="primary" style={{ width: 'auto' }} onClick={create}>
              Create {name || 'Character'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
