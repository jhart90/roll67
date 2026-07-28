import { useMemo, useState } from 'react';
import {
  ANCESTRIES_SWADE, ATTRIBUTES_SWADE, ATTRIBUTE_POINTS, CURATED_EDGES_SWADE, CURATED_HINDRANCES_SWADE,
  CUSTOM_RACE_POINT_CAP, CUSTOM_RACE_POINT_FLOOR, CUSTOM_RACE_TRAITS, CUSTOM_RACE_TRAITS_BY_ID,
  FREE_SKILLS_SWADE, MAX_MAJOR_HINDRANCES, MAX_MINOR_HINDRANCES, RACE_ENVIRONMENTS,
  RESISTIBLE_DAMAGE_TYPES, SKILL_ATTR_SWADE, SKILLS_SWADE, SKILL_POINTS, TRAIT_DICE,
  attributePointsSpent, buildSwadeCharacterSheet, dieStepIndex, finalAttributeDice, hindrancePoints,
  maxTakesOf, pickTier, raceTraitPointTotal, skillPointCost, stepDie, swadeParry, swadeToughness,
  termDesc, totalSkillPointsSpent,
  type CustomRaceTrait, type RaceTraitPick, type SwadeAttrId, type SwadeCreationInput,
} from 'shared';
import { intents } from '../store/game';
import { AppearanceStep, appearancePatch, DEFAULT_APPEARANCE, type AppearanceChoice } from './AppearanceStep';
import { Term } from '../util/Term';

/** Glossary tooltip shorthand for this wizard's system. */
function T({ children, term, desc }: { children?: React.ReactNode; term?: string; desc?: string }) {
  const label = children ?? term;
  return <Term desc={desc ?? termDesc('swade', term ?? String(label))}>{label}</Term>;
}

type Step = 'concept' | 'ancestry' | 'hindrances' | 'attributes' | 'skills' | 'edges' | 'appearance' | 'review';
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'concept', label: 'Concept' },
  { id: 'ancestry', label: 'Ancestry' },
  { id: 'hindrances', label: 'Hindrances' },
  { id: 'attributes', label: 'Attributes' },
  { id: 'skills', label: 'Skills' },
  { id: 'edges', label: 'Edges' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'review', label: 'Review' },
];

const EMPTY_ATTR_STEPS: Record<SwadeAttrId, number> = { agility: 0, smarts: 0, spirit: 0, strength: 0, vigor: 0 };

function attrIdOf(label: string): SwadeAttrId {
  return label.toLowerCase() as SwadeAttrId;
}

/** Guided, step-by-step SWADE character creation: ancestry (with a custom
 *  race point-buy builder), Hindrances, Attributes, Skills, Edges, and a
 *  final review that creates the character and drops their token on the
 *  current map. Every rule number here funnels through shared/systems/
 *  swadeCreation.ts, so this file is UI only. */
export function SwadeCharacterCreator({ onClose }: { onClose: () => void }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [appearance, setAppearance] = useState<AppearanceChoice>(DEFAULT_APPEARANCE);
  const step = STEPS[stepIdx].id;

  const [name, setName] = useState('');
  const [concept, setConcept] = useState('');

  const [ancestryName, setAncestryName] = useState('Human');
  const [isCustom, setIsCustom] = useState(false);
  const [customAncestryName, setCustomAncestryName] = useState('');
  const [customPicks, setCustomPicks] = useState<RaceTraitPick[]>([]);
  const [traitFilter, setTraitFilter] = useState('');
  const raceTotal = useMemo(() => raceTraitPointTotal(customPicks), [customPicks]);

  const [hindranceIds, setHindranceIds] = useState<string[]>([]);
  const minorCount = hindranceIds.filter((id) => CURATED_HINDRANCES_SWADE.find((h) => h.id === id)?.severity === 'Minor').length;
  const majorCount = hindranceIds.filter((id) => CURATED_HINDRANCES_SWADE.find((h) => h.id === id)?.severity === 'Major').length;
  const earnedHindrancePts = useMemo(
    () => hindrancePoints(CURATED_HINDRANCES_SWADE.filter((h) => hindranceIds.includes(h.id))),
    [hindranceIds],
  );
  const [hindFundsUnits, setHindFundsUnits] = useState(0); // 1 pt -> +$500
  const [hindAttrUnits, setHindAttrUnits] = useState(0);   // 2 pts -> +1 attribute pool point
  const [hindSkillUnits, setHindSkillUnits] = useState(0); // 1 pt -> +1 skill pool point
  const [hindEdgeUnits, setHindEdgeUnits] = useState(0);   // 2 pts -> +1 Edge slot
  const hindSpent = hindFundsUnits + hindAttrUnits * 2 + hindSkillUnits + hindEdgeUnits * 2;
  const hindRemaining = earnedHindrancePts - hindSpent;

  const [attributeSteps, setAttributeSteps] = useState<Record<SwadeAttrId, number>>({ ...EMPTY_ATTR_STEPS });
  const attrPool = ATTRIBUTE_POINTS + hindAttrUnits;
  const attrSpent = attributePointsSpent(attributeSteps);

  const finalAttrs = useMemo(
    () => finalAttributeDice(attributeSteps, isCustom, customPicks),
    [attributeSteps, isCustom, customPicks],
  );

  const [skillDice, setSkillDice] = useState<Record<string, string>>({});
  const [skillSearch, setSkillSearch] = useState('');
  const skillPool = SKILL_POINTS + hindSkillUnits;
  const skillSpent = totalSkillPointsSpent(skillDice, finalAttrs);

  const [edgeIds, setEdgeIds] = useState<string[]>([]);

  /** How many times a trait is currently taken. */
  function takesOf(traitId: string): number {
    return customPicks.filter((p) => p.traitId === traitId).length;
  }
  function addTrait(trait: CustomRaceTrait, tier = 0) {
    if (takesOf(trait.id) >= maxTakesOf(trait)) return;
    setCustomPicks((picks) => [...picks, { traitId: trait.id, tier, choice: '' }]);
  }
  function removeTrait(traitId: string) {
    const idx = customPicks.map((p) => p.traitId).lastIndexOf(traitId);
    if (idx < 0) return;
    setCustomPicks((picks) => picks.filter((_, i) => i !== idx));
  }
  function updatePick(index: number, patch: Partial<RaceTraitPick>) {
    setCustomPicks((picks) => picks.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  /** Options a pick still needs the player to name, if any. */
  function choicesFor(trait: CustomRaceTrait): { label: string; options: readonly string[] } | null {
    if (trait.needsAttrChoice) return { label: 'Choose attribute…', options: ATTRIBUTES_SWADE.map((a) => a.id) };
    if (trait.needsSkillChoice) return { label: 'Choose skill…', options: SKILLS_SWADE };
    if (trait.needsDamageTypeChoice) return { label: 'Choose damage type…', options: RESISTIBLE_DAMAGE_TYPES };
    if (trait.needsEnvironmentChoice) return { label: 'Choose effect…', options: RACE_ENVIRONMENTS };
    if (trait.needsEdgeChoice) return { label: 'Choose Edge…', options: CURATED_EDGES_SWADE.map((e) => e.name) };
    if (trait.needsHindranceChoice) return { label: 'Choose Hindrance…', options: CURATED_HINDRANCES_SWADE.map((h) => h.name) };
    if (trait.id === 'immune-poison-disease') return { label: 'Immune to…', options: ['poison', 'disease'] };
    return null;
  }

  function toggleHindrance(id: string) {
    const h = CURATED_HINDRANCES_SWADE.find((x) => x.id === id)!;
    setHindranceIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      const minors = ids.filter((x) => CURATED_HINDRANCES_SWADE.find((y) => y.id === x)?.severity === 'Minor').length;
      const majors = ids.filter((x) => CURATED_HINDRANCES_SWADE.find((y) => y.id === x)?.severity === 'Major').length;
      if (h.severity === 'Minor' && minors >= MAX_MINOR_HINDRANCES) return ids;
      if (h.severity === 'Major' && majors >= MAX_MAJOR_HINDRANCES) return ids;
      return [...ids, id];
    });
  }

  function attrStep(id: SwadeAttrId, delta: number) {
    setAttributeSteps((s) => {
      const next = Math.max(0, Math.min(4, (s[id] ?? 0) + delta));
      if (delta > 0 && attrSpent >= attrPool) return s;
      return { ...s, [id]: next };
    });
  }

  function skillIdx(name: string): number {
    const die = skillDice[name] ?? (FREE_SKILLS_SWADE.includes(name) ? 'd4' : '');
    return die ? dieStepIndex(die) : -1;
  }
  function skillStepCost(name: string, fromIdx: number, toIdx: number): number {
    const linkedAttr = finalAttrs[(SKILL_ATTR_SWADE[name] as SwadeAttrId) ?? 'smarts'] ?? 'd4';
    return skillPointCost(name, toIdx, linkedAttr) - skillPointCost(name, fromIdx, linkedAttr);
  }
  function skillStep(name: string, delta: number) {
    const idx = skillIdx(name);
    const freeIdx = FREE_SKILLS_SWADE.includes(name) ? 0 : -1;
    const nextIdx = Math.max(freeIdx, Math.min(4, idx + delta));
    if (nextIdx === idx) return;
    if (delta > 0) {
      const cost = skillStepCost(name, idx, nextIdx);
      if (skillSpent + cost > skillPool) return;
    }
    setSkillDice((d) => {
      const next = { ...d };
      if (nextIdx <= freeIdx) delete next[name];
      else next[name] = TRAIT_DICE[nextIdx];
      return next;
    });
  }

  function toggleEdge(id: string) {
    setEdgeIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      if (ids.length >= hindEdgeUnits) return ids;
      return [...ids, id];
    });
  }

  const raceOk = raceTotal <= CUSTOM_RACE_POINT_CAP && raceTotal >= CUSTOM_RACE_POINT_FLOOR;
  const hindOk = hindRemaining >= 0;
  const attrOk = attrSpent <= attrPool;
  const skillOk = skillSpent <= skillPool;
  const edgeOk = edgeIds.length <= hindEdgeUnits;

  const canAdvance =
    (step === 'concept' && name.trim().length > 0)
    || (step === 'ancestry' && (!isCustom || raceOk))
    || (step === 'hindrances' && hindOk)
    || (step === 'attributes' && attrOk)
    || (step === 'skills' && skillOk)
    || (step === 'edges' && edgeOk)
    || step === 'appearance'
    || step === 'review';

  const filteredSkills = SKILLS_SWADE.filter((s) => !skillSearch.trim() || s.toLowerCase().includes(skillSearch.trim().toLowerCase()));

  function buildInput(): SwadeCreationInput {
    return {
      concept,
      ancestryName: isCustom ? (customAncestryName.trim() || 'Custom Ancestry') : ancestryName,
      ancestryIsCustom: isCustom,
      customTraitPicks: customPicks,
      attributeSteps, skillDice,
      hindranceIds, hindranceFundsSpent: hindFundsUnits,
      edgeIds,
    };
  }

  const previewSheet = useMemo(() => (step === 'review' ? buildSwadeCharacterSheet(buildInput()) : null), [step]); // eslint-disable-line react-hooks/exhaustive-deps

  function create() {
    const sheetPatch = buildSwadeCharacterSheet(buildInput());
    intents.createCharacter(name.trim(), 'swade', undefined, undefined, { sheetPatch: { ...sheetPatch, ...appearancePatch(appearance) }, placeToken: true });
    onClose();
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 70 }}>
      <div className="panel levelup swc-wizard">
        <div className="dock-header">
          <h3>Create a Character — Savage Worlds</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>

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
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Cassidy Rourke" />
            </label>
            <label className="lu-field">
              Concept (optional flavor)
              <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="e.g. Disgraced marshal chasing one last bounty" />
            </label>
            <p className="dim" style={{ fontSize: 12 }}>
              Every Savage Worlds hero is a <T>Wild Card</T> — you'll roll a <T>Wild Die</T> alongside your <T term="Trait">trait</T> rolls and start with 3 <T>Bennies</T> to reroll fate itself.
            </p>
          </>
        )}

        {step === 'ancestry' && (
          <>
            <label className="check-row">
              <input type="checkbox" checked={isCustom} onChange={(e) => setIsCustom(e.target.checked)} />
              Build a custom ancestry
            </label>
            {!isCustom ? (
              <>
                <label className="lu-field">
                  <T>Ancestry</T>
                  <select value={ancestryName} onChange={(e) => setAncestryName(e.target.value)}>
                    {ANCESTRIES_SWADE.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                {termDesc('swade', ancestryName) && (
                  <p className="dim" style={{ fontSize: 12 }}>{termDesc('swade', ancestryName)}</p>
                )}
              </>
            ) : (
              <>
                <label className="lu-field">
                  Ancestry name
                  <input value={customAncestryName} onChange={(e) => setCustomAncestryName(e.target.value)} placeholder="e.g. Skyfolk" />
                </label>
                <div className={`swc-budget ${!raceOk ? 'over' : raceTotal === CUSTOM_RACE_POINT_CAP ? 'full' : ''}`}>
                  Racial points: {raceTotal} / {CUSTOM_RACE_POINT_CAP}
                  {raceTotal > CUSTOM_RACE_POINT_CAP && <span> — over budget; add a drawback to offset it.</span>}
                </div>
                <p className="dim" style={{ fontSize: 11 }}>
                  An approximate, GM-adjustable model of the core rules' race-building point-buy — everything below lands on real, editable sheet fields.
                </p>
                {customPicks.length > 0 && (
                  <div className="swc-picked-traits">
                    {customPicks.map((pick, i) => {
                      const trait = CUSTOM_RACE_TRAITS_BY_ID.get(pick.traitId);
                      if (!trait) return null;
                      const tier = pickTier(trait, pick.tier ?? 0);
                      const choice = choicesFor(trait);
                      return (
                        <div key={`${pick.traitId}-${i}`} className="swc-picked-trait">
                          <span className="swc-trait-name"><T desc={tier.desc}>{trait.name}</T></span>
                          {trait.tiers && (
                            <select
                              value={pick.tier ?? 0}
                              onChange={(e) => updatePick(i, { tier: Number(e.target.value) })}
                            >
                              {trait.tiers.map((tr, ti) => (
                                <option key={ti} value={ti}>{tr.label} ({tr.cost >= 0 ? `+${tr.cost}` : tr.cost})</option>
                              ))}
                            </select>
                          )}
                          {choice && (
                            <select value={pick.choice ?? ''} onChange={(e) => updatePick(i, { choice: e.target.value })}>
                              <option value="">{choice.label}</option>
                              {choice.options.map((o) => (
                                <option key={o} value={o}>
                                  {ATTRIBUTES_SWADE.find((a) => a.id === o)?.label ?? o}
                                </option>
                              ))}
                            </select>
                          )}
                          <span className="swc-trait-cost">{tier.cost >= 0 ? `+${tier.cost}` : tier.cost}</span>
                          <button className="link danger" title="Remove" onClick={() => removeTrait(pick.traitId)}>×</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <input
                  placeholder="Filter racial abilities…" value={traitFilter}
                  onChange={(e) => setTraitFilter(e.target.value)} style={{ margin: '8px 0' }}
                />
                {(['positive', 'negative'] as const).map((cat) => {
                  const list = CUSTOM_RACE_TRAITS
                    .filter((t) => (t.category ?? 'positive') === cat)
                    .filter((t) => !traitFilter.trim()
                      || t.name.toLowerCase().includes(traitFilter.trim().toLowerCase())
                      || t.desc.toLowerCase().includes(traitFilter.trim().toLowerCase()));
                  if (list.length === 0) return null;
                  return (
                    <div key={cat}>
                      <h5>{cat === 'positive' ? 'Positive Racial Abilities' : 'Negative Racial Abilities'}</h5>
                      <div className="swc-trait-grid">
                        {list.map((t) => {
                          const takes = takesOf(t.id);
                          const max = maxTakesOf(t);
                          const atMax = takes >= max;
                          const repeatable = max > 1;
                          return (
                            <div key={t.id} className={`swc-trait ${takes > 0 ? 'on' : ''} ${(t.cost < 0) ? 'drawback' : ''}`}>
                              <div className="swc-trait-head">
                                <span className="swc-trait-name"><T desc={t.desc}>{t.name}</T></span>
                                <span className="swc-trait-cost">
                                  {t.tiers
                                    ? t.tiers.map((tr) => (tr.cost >= 0 ? `+${tr.cost}` : tr.cost)).join('/')
                                    : t.cost >= 0 ? `+${t.cost}` : t.cost}
                                </span>
                              </div>
                              <span className="dim swc-trait-desc">{t.desc}</span>
                              <div className="swc-trait-actions">
                                {repeatable && takes > 0 && (
                                  <button className="icon-btn" onClick={() => removeTrait(t.id)}>−</button>
                                )}
                                {repeatable && takes > 0 && <span className="swc-trait-takes">×{takes}</span>}
                                <button
                                  className="btn btn-sm" disabled={atMax}
                                  title={atMax ? `Already taken the maximum (${max})` : 'Add this ability'}
                                  onClick={() => addTrait(t)}
                                >
                                  {takes > 0 && !repeatable ? 'taken' : '+ add'}
                                </button>
                                {!repeatable && takes > 0 && (
                                  <button className="link danger" onClick={() => removeTrait(t.id)}>remove</button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
            {!isCustom && ancestryName === 'Human' && (
              <p className="dim" style={{ fontSize: 12 }}>Humans get the free Adaptable Edge (once per session, re-roll a Trait roll).</p>
            )}
          </>
        )}

        {step === 'hindrances' && (
          <>
            <p className="dim" style={{ fontSize: 12 }}>
              Take up to {MAX_MINOR_HINDRANCES} Minor and {MAX_MAJOR_HINDRANCES} Major <T>Hindrance</T>. Each Minor is worth 1 point, each Major 2 — spend them below.
            </p>
            <div className="swc-hindrance-cols">
              <div>
                <h5>Minor ({minorCount}/{MAX_MINOR_HINDRANCES})</h5>
                {CURATED_HINDRANCES_SWADE.filter((h) => h.severity === 'Minor').map((h) => (
                  <label key={h.id} className={`lu-skill ${hindranceIds.includes(h.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={hindranceIds.includes(h.id)} onChange={() => toggleHindrance(h.id)} />
                    <span><T desc={h.desc}>{h.name}</T></span>
                  </label>
                ))}
              </div>
              <div>
                <h5>Major ({majorCount}/{MAX_MAJOR_HINDRANCES})</h5>
                {CURATED_HINDRANCES_SWADE.filter((h) => h.severity === 'Major').map((h) => (
                  <label key={h.id} className={`lu-skill ${hindranceIds.includes(h.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={hindranceIds.includes(h.id)} onChange={() => toggleHindrance(h.id)} />
                    <span><T desc={h.desc}>{h.name}</T></span>
                  </label>
                ))}
              </div>
            </div>

            <div className={`swc-budget ${!hindOk ? 'over' : ''}`}>
              Hindrance points: {hindSpent} / {earnedHindrancePts} spent{!hindOk && <span> — over budget.</span>}
            </div>
            <div className="swc-spend-row">
              <span><T>Starting funds</T> (+$500 each)</span>
              <Stepper value={hindFundsUnits} onChange={setHindFundsUnits} step={1} canIncrement={hindRemaining >= 1} />
            </div>
            <div className="swc-spend-row">
              <span><T desc="Extra points for the Attributes step — each raises one attribute a die type.">Attribute pool</T> (+1 point each, 2 Hindrance pts)</span>
              <Stepper value={hindAttrUnits} onChange={setHindAttrUnits} step={1} canIncrement={hindRemaining >= 2} />
            </div>
            <div className="swc-spend-row">
              <span><T desc="Extra points for the Skills step — each raises a skill die a step (2 if past its linked attribute).">Skill pool</T> (+1 point each)</span>
              <Stepper value={hindSkillUnits} onChange={setHindSkillUnits} step={1} canIncrement={hindRemaining >= 1} />
            </div>
            <div className="swc-spend-row">
              <span><T term="Edge">Edge slot</T> (+1 Edge, 2 Hindrance pts)</span>
              <Stepper value={hindEdgeUnits} onChange={setHindEdgeUnits} step={1} canIncrement={hindRemaining >= 2} />
            </div>
          </>
        )}

        {step === 'attributes' && (
          <>
            <div className={`swc-budget ${attrSpent > attrPool ? 'over' : attrSpent === attrPool ? 'full' : ''}`}>
              Attribute points: {attrSpent} / {attrPool}
            </div>
            {ATTRIBUTES_SWADE.map((a) => {
              const id = attrIdOf(a.id);
              const idx = attributeSteps[id] ?? 0;
              return (
                <div key={id} className="swc-attr-row">
                  <span className="swc-attr-label"><T>{a.label}</T></span>
                  <button className="icon-btn" disabled={idx <= 0} onClick={() => attrStep(id, -1)}>−</button>
                  <span className="swc-die">{TRAIT_DICE[idx]}</span>
                  <button className="icon-btn" disabled={idx >= 4 || attrSpent >= attrPool} onClick={() => attrStep(id, 1)}>+</button>
                  {isCustom && finalAttrs[id] !== TRAIT_DICE[idx] && <span className="dim" style={{ fontSize: 11 }}>→ {finalAttrs[id]} (racial)</span>}
                </div>
              );
            })}
          </>
        )}

        {step === 'skills' && (
          <>
            <div className={`swc-budget ${skillSpent > skillPool ? 'over' : skillSpent === skillPool ? 'full' : ''}`}>
              Skill points: {skillSpent} / {skillPool}
            </div>
            <input
              placeholder="Filter skills…" value={skillSearch} onChange={(e) => setSkillSearch(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <div className="swc-skill-grid">
              {filteredSkills.map((name) => {
                const idx = skillIdx(name);
                const die = idx >= 0 ? TRAIT_DICE[idx] : '—';
                const isFree = FREE_SKILLS_SWADE.includes(name);
                const upCost = idx < 4 ? skillStepCost(name, idx, idx + 1) : null;
                const linked = SKILL_ATTR_SWADE[name] ?? 'smarts';
                const skillTip = `${termDesc('swade', name) ?? ''} Linked attribute: ${linked[0].toUpperCase()}${linked.slice(1)}.`.trim();
                return (
                  <div key={name} className="swc-attr-row">
                    <span className="swc-attr-label"><T desc={skillTip}>{name}</T></span>
                    <button className="icon-btn" disabled={idx <= (isFree ? 0 : -1)} onClick={() => skillStep(name, -1)}>−</button>
                    <span className="swc-die">{die}</span>
                    <button
                      className="icon-btn" disabled={idx >= 4 || (upCost !== null && skillSpent + upCost > skillPool)}
                      title={upCost !== null ? `${upCost} pt${upCost === 1 ? '' : 's'}` : ''}
                      onClick={() => skillStep(name, 1)}
                    >+</button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {step === 'edges' && (
          <>
            <p className="dim" style={{ fontSize: 12 }}>
              {hindEdgeUnits > 0
                ? `You earned ${hindEdgeUnits} Edge slot${hindEdgeUnits === 1 ? '' : 's'} from Hindrance points.`
                : 'No Edge slots earned — go back to Hindrances to buy one, or skip this step.'}
            </p>
            <div className="swc-hindrance-cols" style={{ gridTemplateColumns: '1fr' }}>
              {CURATED_EDGES_SWADE.map((e) => (
                <label key={e.id} className={`lu-skill ${edgeIds.includes(e.id) ? 'on' : ''}`}>
                  <input
                    type="checkbox" checked={edgeIds.includes(e.id)}
                    disabled={!edgeIds.includes(e.id) && edgeIds.length >= hindEdgeUnits}
                    onChange={() => toggleEdge(e.id)}
                  />
                  <span><T desc={e.desc}><strong>{e.name}</strong></T> — {e.desc}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {step === 'appearance' && <AppearanceStep value={appearance} onChange={setAppearance} />}

        {step === 'review' && previewSheet && (
          <div className="swc-review">
            <p className="lu-summary">
              <strong>{name}</strong>{concept ? ` — ${concept}` : ''} · <T>{String(previewSheet.ancestry)}</T>
            </p>
            <div className="swc-review-grid">
              {ATTRIBUTES_SWADE.map((a) => (
                <span key={a.id} className="cf-chip"><T>{a.label}</T> {String(previewSheet[a.id])}</span>
              ))}
            </div>
            <p className="dim" style={{ fontSize: 12 }}>
              <T>Parry</T> {swadeParry(previewSheet)} · <T>Toughness</T> {swadeToughness(previewSheet)} · <T>Pace</T> {String(previewSheet.pace)} · ${String(previewSheet.dollars)}
            </p>
            <div className="swc-review-grid">
              {(previewSheet.skills as Array<{ name: string; die: string }>).map((s) => (
                <span key={s.name} className="cf-chip"><T>{s.name}</T> {s.die}</span>
              ))}
            </div>
            {(previewSheet.hindrances as Array<{ name: string }>).length > 0 && (
              <p className="dim" style={{ fontSize: 12 }}>
                <T>Hindrance</T>s: {(previewSheet.hindrances as Array<{ name: string }>).map((h, i) => (
                  <span key={h.name}>{i > 0 && ', '}<T desc={CURATED_HINDRANCES_SWADE.find((x) => x.name === h.name)?.desc}>{h.name}</T></span>
                ))}
              </p>
            )}
            {(previewSheet.edges as Array<{ name: string; notes?: string }>).length > 0 && (
              <p className="dim" style={{ fontSize: 12 }}>
                <T>Edge</T>s: {(previewSheet.edges as Array<{ name: string; notes?: string }>).map((e, i) => (
                  <span key={e.name}>{i > 0 && ', '}<T desc={CURATED_EDGES_SWADE.find((x) => x.name === e.name)?.desc ?? e.notes}>{e.name}</T></span>
                ))}
              </p>
            )}
            <p className="dim" style={{ fontSize: 12 }}>
              Gear isn't bought here — after creation, open your sheet's <strong>+ Compendium</strong> button to spend your starting funds.
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

function Stepper({ value, onChange, step, canIncrement = true }: { value: number; onChange: (v: number) => void; step: number; canIncrement?: boolean }) {
  return (
    <span className="slot-btns">
      <button className="icon-btn" disabled={value <= 0} onClick={() => onChange(Math.max(0, value - step))}>−</button>
      <span style={{ padding: '0 6px' }}>{value}</span>
      <button className="icon-btn" disabled={!canIncrement} onClick={() => canIncrement && onChange(value + step)}>+</button>
    </span>
  );
}
