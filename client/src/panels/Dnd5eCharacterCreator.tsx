import { useMemo, useState } from 'react';
import {
  ABILITY_IDS, ABILITY_LABELS, ALIGNMENTS, BACKGROUNDS_DEF_5E, BACKGROUND_NAMES_5E, CLASS_CHOICES_5E,
  KIT_BY_CLASS_5E, POINT_BUY_BUDGET, POINT_BUY_MAX, POINT_BUY_MIN, RACE_NAMES_5E, SKILLS_5E,
  STANDARD_ARRAY_5E, abilityMod5e, buildDnd5eCharacterSheet, dnd5e, finalAbilities5e, getRace5e,
  pointBuySpent, roll4d6DropLowest, termDesc,
  type AbilityId, type Dnd5eCreationInput,
} from 'shared';
import { intents } from '../store/game';
import { AppearanceStep, appearancePatch, DEFAULT_APPEARANCE, type AppearanceChoice } from './AppearanceStep';
import { makeTerm } from '../util/Term';

const T = makeTerm('dnd5e');

type Step = 'concept' | 'race' | 'class' | 'abilities' | 'background' | 'skills' | 'gear' | 'appearance' | 'review';
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'concept', label: 'Concept' },
  { id: 'race', label: 'Race' },
  { id: 'class', label: 'Class' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'background', label: 'Background' },
  { id: 'skills', label: 'Skills' },
  { id: 'gear', label: 'Equipment' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'review', label: 'Review' },
];

type Method = 'array' | 'pointbuy' | 'roll';

const EMPTY_POINT_BUY: Record<AbilityId, number> = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
/** Assignment of pool slots to abilities: ability -> index into the pool (-1 = unassigned). */
const EMPTY_ASSIGN: Record<AbilityId, number> = { str: -1, dex: -1, con: -1, int: -1, wis: -1, cha: -1 };

function fmt(mod: number): string {
  return mod >= 0 ? `+${mod}` : String(mod);
}

/** Guided, step-by-step D&D 5e character creation: race, class, ability
 *  scores (standard array / point buy / 4d6-drop-lowest), background, skill
 *  proficiencies, and starting equipment. Every rule number funnels through
 *  shared/systems/dnd5eCreation.ts, so this file is UI only. Finishing
 *  creates the character owned by this player and drops their token on the
 *  map they're viewing. */
export function Dnd5eCharacterCreator({ onClose }: { onClose: () => void }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [appearance, setAppearance] = useState<AppearanceChoice>(DEFAULT_APPEARANCE);
  const step = STEPS[stepIdx].id;

  const [name, setName] = useState('');
  const [alignment, setAlignment] = useState('True Neutral');
  const [personality, setPersonality] = useState('');
  const [backstory, setBackstory] = useState('');

  const [raceName, setRaceName] = useState(RACE_NAMES_5E[0]);
  const race = getRace5e(raceName);
  const [freeAbilities, setFreeAbilities] = useState<AbilityId[]>([]);

  const [classId, setClassId] = useState(CLASS_CHOICES_5E[0]?.id ?? 'fighter');
  const cls = CLASS_CHOICES_5E.find((c) => c.id === classId);

  const [method, setMethod] = useState<Method>('array');
  const [pointBuy, setPointBuy] = useState<Record<AbilityId, number>>({ ...EMPTY_POINT_BUY });
  const [rolledPool, setRolledPool] = useState<number[] | null>(null);
  const [assign, setAssign] = useState<Record<AbilityId, number>>({ ...EMPTY_ASSIGN });

  const [backgroundName, setBackgroundName] = useState(BACKGROUND_NAMES_5E[0]);
  const background = BACKGROUNDS_DEF_5E.find((b) => b.name === backgroundName);

  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [takeKit, setTakeKit] = useState(true);

  const pool = method === 'roll' ? rolledPool : method === 'array' ? STANDARD_ARRAY_5E : null;

  /** Base scores before racial increases, from whichever method is active. */
  const baseAbilities = useMemo((): Record<AbilityId, number> => {
    if (method === 'pointbuy') return pointBuy;
    const out: Record<AbilityId, number> = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    for (const id of ABILITY_IDS) {
      const idx = assign[id];
      out[id] = pool && idx >= 0 && idx < pool.length ? pool[idx] : 10;
    }
    return out;
  }, [method, pointBuy, assign, pool]);

  const finalAbils = useMemo(
    () => finalAbilities5e(baseAbilities, raceName, freeAbilities),
    [baseAbilities, raceName, freeAbilities],
  );

  const pointsSpent = pointBuySpent(pointBuy);
  const allAssigned = ABILITY_IDS.every((id) => assign[id] >= 0);
  const abilitiesOk = method === 'pointbuy' ? pointsSpent <= POINT_BUY_BUDGET : allAssigned;
  const freeOk = !race || freeAbilities.length === race.freeChoices;
  const skillsOk = !cls || skillIds.length === cls.skillCount;

  function toggleFree(id: AbilityId) {
    if (!race) return;
    setFreeAbilities((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= race.freeChoices) return cur;
      return [...cur, id];
    });
  }

  function assignSlot(ability: AbilityId, poolIdx: number) {
    setAssign((cur) => {
      const next = { ...cur };
      // A pool slot can only feed one ability — swap if it's already taken.
      const taken = ABILITY_IDS.find((a) => next[a] === poolIdx && a !== ability);
      if (taken) next[taken] = cur[ability];
      next[ability] = poolIdx;
      return next;
    });
  }

  function stepPointBuy(id: AbilityId, delta: number) {
    setPointBuy((cur) => {
      const next = Math.max(POINT_BUY_MIN, Math.min(POINT_BUY_MAX, cur[id] + delta));
      const candidate = { ...cur, [id]: next };
      if (delta > 0 && pointBuySpent(candidate) > POINT_BUY_BUDGET) return cur;
      return candidate;
    });
  }

  function rollPool() {
    setRolledPool([0, 0, 0, 0, 0, 0].map(() => roll4d6DropLowest()));
    setAssign({ ...EMPTY_ASSIGN });
  }

  function toggleSkill(id: string) {
    if (!cls) return;
    setSkillIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= cls.skillCount) return cur;
      return [...cur, id];
    });
  }

  const canAdvance =
    (step === 'concept' && name.trim().length > 0)
    || (step === 'race' && freeOk)
    || step === 'class'
    || (step === 'abilities' && abilitiesOk)
    || step === 'background'
    || (step === 'skills' && skillsOk)
    || step === 'gear'
    || step === 'appearance'
    || step === 'review';

  function buildInput(): Dnd5eCreationInput {
    return {
      name: name.trim(), raceName, classId, backgroundName, alignment,
      baseAbilities, raceFreeAbilities: freeAbilities, skillIds, takeKit,
      personality: personality.trim() || undefined,
      backstory: backstory.trim() || undefined,
    };
  }

  const previewSheet = useMemo(() => (step === 'review' ? buildDnd5eCharacterSheet(buildInput()) : null), [step]); // eslint-disable-line react-hooks/exhaustive-deps

  function create() {
    const sheetPatch = buildDnd5eCharacterSheet(buildInput());
    intents.createCharacter(name.trim(), 'dnd5e', undefined, undefined, { sheetPatch: { ...sheetPatch, ...appearancePatch(appearance) }, placeToken: true });
    onClose();
  }

  const kit = KIT_BY_CLASS_5E.get(classId);
  const bgSkillNames = (background?.skills ?? [])
    .map((id) => SKILLS_5E.find((s) => s.id === id)?.label ?? id);

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
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Elenwe Duskmere" />
            </label>
            <label className="lu-field">
              <T>Alignment</T>
              <select value={alignment} onChange={(e) => setAlignment(e.target.value)}>
                {ALIGNMENTS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="lu-field">
              <T term="Personality Traits">Personality</T> (optional)
              <input value={personality} onChange={(e) => setPersonality(e.target.value)} placeholder="e.g. Never backs down from a dare" />
            </label>
            <label className="lu-field">
              <T>Backstory</T> (optional)
              <input value={backstory} onChange={(e) => setBackstory(e.target.value)} placeholder="e.g. Fled a burning temple with a stolen relic" />
            </label>
            <p className="dim" style={{ fontSize: 12 }}>
              You'll start at <T term="Level">level 1</T>. Hover any underlined term for what it means.
            </p>
          </>
        )}

        {step === 'race' && (
          <>
            <label className="lu-field">
              <T>Race</T>
              <select value={raceName} onChange={(e) => { setRaceName(e.target.value); setFreeAbilities([]); }}>
                {RACE_NAMES_5E.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            {race && (
              <>
                <div className="swc-review-grid">
                  {Object.entries(race.abilities).map(([id, amt]) => (
                    <span key={id} className="cf-chip">
                      <T term={id.toUpperCase()}>{ABILITY_LABELS[id as AbilityId]}</T> {fmt(amt ?? 0)}
                    </span>
                  ))}
                  <span className="cf-chip"><T>Speed</T> {race.speed} ft</span>
                  {race.darkvision > 0 && <span className="cf-chip"><T>Darkvision</T> {race.darkvision} ft</span>}
                </div>
                <p className="dim" style={{ fontSize: 12 }}>{race.traits}</p>
                {race.freeChoices > 0 && (
                  <>
                    <div className={`swc-budget ${freeOk ? 'full' : ''}`}>
                      Choose {race.freeChoices} ability {race.freeChoices === 1 ? 'increase' : 'increases'} of +1 ({freeAbilities.length}/{race.freeChoices})
                    </div>
                    <div className="swc-hindrance-cols">
                      {ABILITY_IDS.map((id) => (
                        <label key={id} className={`lu-skill ${freeAbilities.includes(id) ? 'on' : ''}`}>
                          <input
                            type="checkbox" checked={freeAbilities.includes(id)}
                            disabled={!freeAbilities.includes(id) && freeAbilities.length >= race.freeChoices}
                            onChange={() => toggleFree(id)}
                          />
                          <span><T term={id.toUpperCase()}>{ABILITY_LABELS[id]}</T></span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {step === 'class' && cls && (
          <>
            <label className="lu-field">
              <T>Class</T>
              <select value={classId} onChange={(e) => { setClassId(e.target.value); setSkillIds([]); }}>
                {CLASS_CHOICES_5E.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div className="swc-review-grid">
              <span className="cf-chip"><T>Hit Dice</T> d{cls.hitDie}</span>
              {cls.saves.map((s) => (
                <span key={s} className="cf-chip">
                  <T term="Save">{ABILITY_LABELS[s as AbilityId]} save</T>
                </span>
              ))}
              {cls.caster !== 'none' && <span className="cf-chip">Spellcaster</span>}
            </div>
            <p className="dim" style={{ fontSize: 12 }}>
              Your <T>HP</T> at level 1 is {cls.hitDie} + your <T term="CON">Constitution</T> modifier, and you're
              proficient in {cls.skillCount} skills from this class's list (picked two steps from now).
            </p>
          </>
        )}

        {step === 'abilities' && (
          <>
            <div className="swc-steps" style={{ borderBottom: 'none', marginBottom: 4 }}>
              {(['array', 'pointbuy', 'roll'] as Method[]).map((m) => (
                <button key={m} className={method === m ? 'active' : ''} onClick={() => setMethod(m)}>
                  {m === 'array' ? 'Standard array' : m === 'pointbuy' ? 'Point buy' : 'Roll 4d6'}
                </button>
              ))}
            </div>

            {method === 'pointbuy' && (
              <div className={`swc-budget ${pointsSpent > POINT_BUY_BUDGET ? 'over' : pointsSpent === POINT_BUY_BUDGET ? 'full' : ''}`}>
                Points: {pointsSpent} / {POINT_BUY_BUDGET} · scores run {POINT_BUY_MIN}–{POINT_BUY_MAX} before racial bonuses
              </div>
            )}
            {method === 'array' && (
              <p className="dim" style={{ fontSize: 12 }}>Assign each of 15, 14, 13, 12, 10, 8 to one ability.</p>
            )}
            {method === 'roll' && (
              <div className="row" style={{ marginBottom: 6 }}>
                <button className="btn btn-sm" onClick={rollPool}>🎲 {rolledPool ? 'Reroll all six' : 'Roll six scores'}</button>
                {rolledPool && <span className="dim" style={{ fontSize: 12 }}>Rolled: {rolledPool.join(', ')}</span>}
              </div>
            )}

            {(method === 'pointbuy' || pool) && ABILITY_IDS.map((id) => {
              const score = baseAbilities[id];
              const finalScore = finalAbils[id];
              const racial = finalScore - score;
              return (
                <div key={id} className="swc-attr-row">
                  <span className="swc-attr-label"><T term={id.toUpperCase()}>{ABILITY_LABELS[id]}</T></span>
                  {method === 'pointbuy' ? (
                    <>
                      <button className="icon-btn" disabled={pointBuy[id] <= POINT_BUY_MIN} onClick={() => stepPointBuy(id, -1)}>−</button>
                      <span className="swc-die">{pointBuy[id]}</span>
                      <button className="icon-btn" disabled={pointBuy[id] >= POINT_BUY_MAX} onClick={() => stepPointBuy(id, 1)}>+</button>
                    </>
                  ) : (
                    <select
                      value={assign[id]}
                      onChange={(e) => assignSlot(id, Number(e.target.value))}
                      style={{ width: 80 }}
                    >
                      <option value={-1}>—</option>
                      {(pool ?? []).map((v, i) => <option key={i} value={i}>{v}</option>)}
                    </select>
                  )}
                  <span className="dim" style={{ fontSize: 11, minWidth: 96, textAlign: 'right' }}>
                    {racial !== 0 ? `${score} ${fmt(racial)} racial → ` : ''}<strong>{finalScore}</strong> ({fmt(abilityMod5e(finalScore))})
                  </span>
                </div>
              );
            })}
            {method === 'roll' && !rolledPool && <p className="dim" style={{ fontSize: 12 }}>Roll first, then assign each result to an ability.</p>}
          </>
        )}

        {step === 'background' && (
          <>
            <label className="lu-field">
              <T>Background</T>
              <select value={backgroundName} onChange={(e) => setBackgroundName(e.target.value)}>
                {BACKGROUND_NAMES_5E.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            {background && (
              <>
                <p className="dim" style={{ fontSize: 12 }}>{background.feature}</p>
                <div className="swc-review-grid">
                  {background.skills.map((id) => {
                    const s = SKILLS_5E.find((x) => x.id === id);
                    return <span key={id} className="cf-chip"><T desc={termDesc('dnd5e', s?.label ?? id)}>{s?.label ?? id}</T></span>;
                  })}
                </div>
                <p className="dim" style={{ fontSize: 12 }}>
                  These skill <T term="Proficiency">proficiencies</T> come free with the background — they're granted on top of your class picks.
                </p>
              </>
            )}
          </>
        )}

        {step === 'skills' && cls && (
          <>
            <div className={`swc-budget ${skillsOk ? 'full' : ''}`}>
              Choose {cls.skillCount} skill {cls.skillCount === 1 ? 'proficiency' : 'proficiencies'} ({skillIds.length}/{cls.skillCount})
            </div>
            <div className="swc-hindrance-cols">
              {cls.skillList.map((id) => {
                const s = SKILLS_5E.find((x) => x.id === id);
                const fromBg = background?.skills.includes(id);
                return (
                  <label key={id} className={`lu-skill ${skillIds.includes(id) ? 'on' : ''}`}>
                    <input
                      type="checkbox" checked={skillIds.includes(id)}
                      disabled={!skillIds.includes(id) && skillIds.length >= cls.skillCount}
                      onChange={() => toggleSkill(id)}
                    />
                    <span>
                      <T desc={termDesc('dnd5e', s?.label ?? id)}>{s?.label ?? id}</T>
                      {fromBg && <span className="dim"> · already from background</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {step === 'gear' && (
          <>
            <label className="check-row">
              <input type="checkbox" checked={takeKit} onChange={(e) => setTakeKit(e.target.checked)} />
              Take the standard {cls?.name} starting equipment
            </label>
            {takeKit && kit ? (
              <>
                <p className="dim" style={{ fontSize: 12 }}>{kit.label}</p>
                <div className="swc-review-grid">
                  {kit.weapons.map((w) => <span key={w.name} className="cf-chip"><T term="Damage">{w.name}</T> {w.damage}</span>)}
                  {kit.armor.map((a) => <span key={a.name} className="cf-chip"><T term={a.shield ? 'Shield' : 'Armor'}>{a.name}</T></span>)}
                  {kit.items.map((it) => <span key={it} className="cf-chip">{it}</span>)}
                  <span className="cf-chip"><T>GP</T> {kit.gp}</span>
                </div>
                <p className="dim" style={{ fontSize: 12 }}>
                  Weapons arrive as real attacks with your to-hit and damage baked in, and armor arrives worn so your <T>AC</T> is right immediately.
                </p>
              </>
            ) : (
              <p className="dim" style={{ fontSize: 12 }}>
                Starting with nothing — buy gear after creation from your sheet's <strong>+ Compendium</strong> button.
              </p>
            )}
          </>
        )}

        {step === 'appearance' && <AppearanceStep value={appearance} onChange={setAppearance} />}

        {step === 'review' && previewSheet && (
          <div className="swc-review">
            <p className="lu-summary">
              <strong>{name}</strong> · <T term="Race">{raceName}</T> <T term="Class">{String(previewSheet.class)}</T> 1 · {alignment}
            </p>
            <div className="swc-review-grid">
              {ABILITY_IDS.map((id) => (
                <span key={id} className="cf-chip">
                  <T term={id.toUpperCase()}>{id.toUpperCase()}</T> {String(previewSheet[id])} ({fmt(abilityMod5e(Number(previewSheet[id])))})
                </span>
              ))}
            </div>
            <p className="dim" style={{ fontSize: 12 }}>
              <T>HP</T> {String(previewSheet.hp)}/{String(previewSheet.maxHp)} · <T>AC</T> {String(dnd5e.derive(previewSheet).ac)} · <T>Speed</T> {String(previewSheet.speed)} ft · <T>Proficiency</T> +2
            </p>
            <div className="swc-review-grid">
              {SKILLS_5E.filter((s) => previewSheet[`skill_${s.id}`] === true).map((s) => (
                <span key={s.id} className="cf-chip"><T desc={termDesc('dnd5e', s.label)}>{s.label}</T></span>
              ))}
            </div>
            {(previewSheet.attacks as Array<{ name: string; bonus: number; damage: string }>).length > 0 && (
              <p className="dim" style={{ fontSize: 12 }}>
                Attacks: {(previewSheet.attacks as Array<{ name: string; bonus: number; damage: string }>)
                  .map((a) => `${a.name} ${fmt(a.bonus)} (${a.damage})`).join(' · ')}
              </p>
            )}
            <p className="dim" style={{ fontSize: 12 }}>
              Finishing drops <strong>{name || 'your character'}</strong>'s token on the map you're viewing — visible to the whole table, and yours to move.
            </p>
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
