import { useMemo, useState } from 'react';
import type { Character } from 'shared';
import {
  ATTRIBUTES_SWADE, advanceOptions, advancesToNextRank, advanceRanksUp, applyAdvance, dieSides,
  edgeOptions, num, rankForAdvances, skillStandings, stepDie, traitExpr, untakenSkills,
  type AdvanceChoice, type EdgeEligibility,
} from 'shared';
import { intents } from '../store/game';
import { makeTerm } from '../util/Term';

const T = makeTerm('swade');

type Step = 'overview' | 'choose' | 'pick' | 'review';

/**
 * SWADE advancement, step by step. An Advance buys exactly one of: a new
 * Edge, a die-type on a skill already at/above its linked attribute, a die
 * on each of two skills below theirs, a brand-new skill at d4, or a die on
 * an attribute (once per Rank). Every fourth Advance raises the Rank.
 *
 * All the rules math lives in shared/systems/swadeAdvancement.ts; this file
 * is presentation. Applying posts a summary to chat and — when a trait die
 * actually changed — rolls the improved trait once so the table sees the
 * new die in action (SWADE advancement itself calls for no dice).
 */
export function SwadeAdvanceWizard({ character, onClose }: { character: Character; onClose: () => void }) {
  const sheet = character.sheet;
  const [stepIdx, setStepIdx] = useState(0);
  const STEPS: Array<{ id: Step; label: string }> = [
    { id: 'overview', label: 'Advance' },
    { id: 'choose', label: 'Choose' },
    { id: 'pick', label: 'Details' },
    { id: 'review', label: 'Confirm' },
  ];
  const step = STEPS[stepIdx].id;

  const advances = num(sheet, 'advances', 0);
  const nextAdvance = advances + 1;
  const ranksUp = advanceRanksUp(advances);
  const options = useMemo(() => advanceOptions(sheet), [sheet]);
  const standings = useMemo(() => skillStandings(sheet), [sheet]);
  const edges = useMemo(() => edgeOptions(sheet), [sheet]);
  const untaken = useMemo(() => untakenSkills(sheet), [sheet]);

  const [kind, setKind] = useState<AdvanceChoice['kind'] | null>(null);
  const [edgeName, setEdgeName] = useState('');
  const [skillHigh, setSkillHigh] = useState('');
  const [skillsLow, setSkillsLow] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState('');
  const [attrId, setAttrId] = useState('');
  const [edgeFilter, setEdgeFilter] = useState('');

  const highSkills = standings.filter((s) => s.atOrAbove && !s.maxed);
  const lowSkills = standings.filter((s) => !s.atOrAbove && !s.maxed);
  const attrs = ATTRIBUTES_SWADE.map((a) => ({ ...a, die: String(sheet[a.id] ?? 'd4') }))
    .filter((a) => dieSides(a.die) < 12);

  const choice: AdvanceChoice | null =
    kind === 'edge' && edgeName ? { kind: 'edge', edgeName }
      : kind === 'skillHigh' && skillHigh ? { kind: 'skillHigh', skill: skillHigh }
        : kind === 'skillsLow' && skillsLow.length === 2 ? { kind: 'skillsLow', skills: skillsLow }
          : kind === 'newSkill' && newSkill ? { kind: 'newSkill', skill: newSkill }
            : kind === 'attribute' && attrId ? { kind: 'attribute', attrId }
              : null;

  const result = useMemo(() => (choice ? applyAdvance(sheet, choice) : null), [sheet, choice]);

  function toggleLow(name: string) {
    setSkillsLow((cur) => {
      if (cur.includes(name)) return cur.filter((n) => n !== name);
      if (cur.length >= 2) return cur;
      return [...cur, name];
    });
  }

  function apply() {
    if (!result) return;
    intents.updateCharacter(character.id, result.patch);
    // A rank-up summary already ends in "!", so don't tack a period onto it.
    const line = `⬆ ${character.name} ${result.summary}`.replace(/[.!]+$/, '');
    const punct = /Rank$/.test(line) ? '!' : '.';
    intents.chat(`${line}${punct} (Advance ${nextAdvance}, ${rankForAdvances(nextAdvance)})`);
    // A changed trait die gets rolled once so the table sees it in action —
    // the server rolls it, so it lands in chat with everyone's 3D dice.
    if (result.showcase) {
      const sides = dieSides(result.showcase.die);
      // Label it, or the card is a bare expression with no hint of what the
      // wizard just rolled or why.
      const what = `${result.showcase.label}${result.showcase.kind === 'skill' ? ' Skill' : ''}`;
      intents.chat(`/roll ${traitExpr({ ...sheet, ...result.patch }, sides)} # Example ${what} roll`);
    }
    onClose();
  }

  const canAdvance =
    step === 'overview'
    || (step === 'choose' && kind !== null)
    || (step === 'pick' && choice !== null)
    || step === 'review';

  const eligibleEdges = edges.filter((e) => !edgeFilter.trim()
    || e.entry.name.toLowerCase().includes(edgeFilter.trim().toLowerCase()));

  return (
    <div className="sheet-backdrop" style={{ zIndex: 70 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup swc-wizard">
        <div className="dock-header">
          <h3>Advance — {character.name}</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>

        <div className="swc-steps">
          {STEPS.map((s, i) => (
            <button key={s.id} className={i === stepIdx ? 'active' : ''} disabled={i > stepIdx} onClick={() => setStepIdx(i)}>
              {s.label}
            </button>
          ))}
        </div>

        {step === 'overview' && (
          <>
            <p className="lu-summary">
              <strong>{character.name}</strong> · <T>Rank</T> {rankForAdvances(advances)} · <T>Advances</T> {advances}
            </p>
            <div className={`swc-budget ${ranksUp ? 'full' : ''}`}>
              This is Advance {nextAdvance}
              {ranksUp
                ? ` — it raises you to ${rankForAdvances(nextAdvance)} Rank!`
                : ` · ${advancesToNextRank(advances)} more to ${rankForAdvances(advances + advancesToNextRank(advances))}`}
            </div>
            <p className="dim" style={{ fontSize: 12 }}>
              Each Advance buys exactly one improvement. Every fourth Advance raises your Rank, which unlocks
              higher-Rank <T>Edge</T>s and frees your once-per-Rank attribute increase again.
            </p>
          </>
        )}

        {step === 'choose' && (
          <>
            <h4>How do you want to spend this Advance?</h4>
            <p className="dim" style={{ fontSize: 12 }}>
              One Advance buys exactly one of these. Greyed options explain why they are unavailable right now.
            </p>
            <div className="swc-hindrance-cols" style={{ gridTemplateColumns: '1fr' }}>
              {options.map((o) => (
                <label key={o.kind} className={`lu-skill ${kind === o.kind ? 'on' : ''}`} style={o.available ? undefined : { opacity: 0.5 }}>
                  <input
                    type="radio" checked={kind === o.kind} disabled={!o.available}
                    onChange={() => { setKind(o.kind); setStepIdx(2); }}
                  />
                  <span>
                    <strong>{o.label}</strong>
                    <br />
                    <span className="dim" style={{ fontSize: 11 }}>{o.available ? o.detail : o.reason}</span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        {step === 'pick' && kind === 'edge' && (
          <>
            <h4>Which Edge?</h4>
            <p className="dim" style={{ fontSize: 12 }}>
              Edges are your character's signature talents — most add a live bonus or a new action the moment
              you take them. Greyed Edges show the requirement you are missing.
            </p>
            <input placeholder="Filter Edges…" value={edgeFilter} onChange={(e) => setEdgeFilter(e.target.value)} style={{ marginBottom: 8 }} />
            <div className="swc-skill-grid" style={{ gridTemplateColumns: '1fr' }}>
              {eligibleEdges.map((e: EdgeEligibility) => (
                <label key={e.entry.id} className={`lu-skill ${edgeName === e.entry.name ? 'on' : ''}`} style={e.eligible ? undefined : { opacity: 0.45 }}>
                  <input
                    type="radio" checked={edgeName === e.entry.name} disabled={!e.eligible}
                    onChange={() => setEdgeName(e.entry.name)}
                  />
                  <span>
                    <T desc={e.entry.subtitle}><strong>{e.entry.name}</strong></T>
                    <span className="dim" style={{ fontSize: 11 }}> · {e.entry.category.replace('Edge: ', '')}</span>
                    <br />
                    <span className="dim" style={{ fontSize: 11 }}>{e.eligible ? e.entry.subtitle : e.reason}</span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        {step === 'pick' && kind === 'skillHigh' && (
          <>
            <h4>Which skill goes up a die?</h4>
            <p className="dim" style={{ fontSize: 12 }}>
              These skills are at or above their linked attribute, so each costs a whole Advance to raise.
              A bigger die means higher trait rolls — and more chances to ace.
            </p>
            {highSkills.map((s) => (
              <label key={s.name} className={`lu-skill ${skillHigh === s.name ? 'on' : ''}`}>
                <input type="radio" checked={skillHigh === s.name} onChange={() => setSkillHigh(s.name)} />
                <span>
                  <T>{s.name}</T> <strong>{s.die} → {stepDie(s.die, 1)}</strong>
                  <span className="dim" style={{ fontSize: 11 }}> · linked {s.linkedAttr} {s.linkedDie}</span>
                </span>
              </label>
            ))}
          </>
        )}

        {step === 'pick' && kind === 'skillsLow' && (
          <>
            <div className={`swc-budget ${skillsLow.length === 2 ? 'full' : ''}`}>
              Choose two skills ({skillsLow.length}/2)
            </div>
            <h4>Which two skills go up a die each?</h4>
            <p className="dim" style={{ fontSize: 12 }}>
              Both are still below their linked attributes, so one Advance raises the pair — the best value
              an Advance offers when it is available.
            </p>
            <div className="swc-skill-grid" style={{ gridTemplateColumns: '1fr' }}>
              {lowSkills.map((s) => (
                <label key={s.name} className={`lu-skill ${skillsLow.includes(s.name) ? 'on' : ''}`}>
                  <input
                    type="checkbox" checked={skillsLow.includes(s.name)}
                    disabled={!skillsLow.includes(s.name) && skillsLow.length >= 2}
                    onChange={() => toggleLow(s.name)}
                  />
                  <span>
                    <T>{s.name}</T> <strong>{s.die} → {stepDie(s.die, 1)}</strong>
                    <span className="dim" style={{ fontSize: 11 }}> · linked {s.linkedAttr} {s.linkedDie}</span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        {step === 'pick' && kind === 'newSkill' && (
          <>
            <h4>Which new skill do you learn?</h4>
            <p className="dim" style={{ fontSize: 12 }}>
              A skill you have never trained starts at d4. Until now these rolled an unskilled d4−2, so even
              d4 is a real improvement.
            </p>
            <div className="swc-skill-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {untaken.map((name) => (
                <label key={name} className={`lu-skill ${newSkill === name ? 'on' : ''}`}>
                  <input type="radio" checked={newSkill === name} onChange={() => setNewSkill(name)} />
                  <span><T>{name}</T></span>
                </label>
              ))}
            </div>
          </>
        )}

        {step === 'pick' && kind === 'attribute' && (
          <>
            <h4>Which attribute goes up a die?</h4>
            <p className="dim" style={{ fontSize: 12 }}>
              Allowed once per <T>Rank</T> — the rarest and broadest improvement, since an attribute feeds
              every skill linked to it, and raising one can make future raises of those skills cheaper.
            </p>
            {attrs.map((a) => (
              <label key={a.id} className={`lu-skill ${attrId === a.id ? 'on' : ''}`}>
                <input type="radio" checked={attrId === a.id} onChange={() => setAttrId(a.id)} />
                <span>
                  <T>{a.label}</T> <strong>{a.die} → {stepDie(a.die, 1)}</strong>
                  {a.id === 'vigor' && <span className="dim" style={{ fontSize: 11 }}> · also raises Toughness</span>}
                  {a.id === 'agility' && <span className="dim" style={{ fontSize: 11 }}> · Fighting-linked skills may fall behind</span>}
                </span>
              </label>
            ))}
          </>
        )}

        {step === 'review' && result && (
          <div className="swc-review">
            <p className="lu-summary">{character.name} {result.summary}</p>
            <div className="swc-review-grid">
              <span className="cf-chip"><T>Advances</T> {advances} → {nextAdvance}</span>
              <span className="cf-chip"><T>Rank</T> {rankForAdvances(nextAdvance)}</span>
              {result.showcase && <span className="cf-chip">{result.showcase.label} {result.showcase.die}</span>}
            </div>
            {result.showcase && (
              <p className="dim" style={{ fontSize: 12 }}>
                Applying rolls your new {result.showcase.label} die once so the table sees it — the roll and a
                summary both land in chat.
              </p>
            )}
            {!result.showcase && (
              <p className="dim" style={{ fontSize: 12 }}>The change and a summary are posted to chat when you apply.</p>
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
            <button className="primary" style={{ width: 'auto' }} disabled={!result} onClick={apply}>
              Apply Advance
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
