import type { Character, SheetData } from 'shared';
import { bool, combatResources, conditionsFor, conditionsOf, resetsCleared } from 'shared';
import { intents } from '../store/game';
import { Term } from '../util/Term';

/** When a pool refreshes, spelled out for its tooltip. */
const RESET_DESC: Record<string, string> = {
  round: 'Refreshes at the start of each round.',
  scene: 'Refreshes at the end of each scene or encounter.',
  short: 'Refreshes on a short rest.',
  long: 'Refreshes on a long rest.',
};

/** Shared "effect engine" panel on the Core tab: status conditions, the
 *  downed/death-save block, and universal reaction/reroll trackers. */
export function CombatStatus({ character, editable }: { character: Character; editable: boolean }) {
  const sheet = character.sheet;
  const active = conditionsOf(sheet);
  const list = conditionsFor(character.system);
  const resources = combatResources(character.system, sheet);
  const dead = active.includes('dead');
  // Downed = actually tagged unconscious (not just "hp <= 0", which stays true
  // forever once stabilized) and not already stable from 3 death-save successes.
  const downed = active.includes('unconscious') && !dead && !bool(sheet, 'stable');

  function toggle(id: string) {
    const next = active.includes(id) ? active.filter((c) => c !== id) : [...active, id];
    intents.updateCharacter(character.id, { conditions: next });
  }
  function setUsed(id: string, used: number) {
    intents.updateCharacter(character.id, { [`res_${id}`]: Math.max(0, used) });
  }
  function reset(action: 'round' | 'scene') {
    const scopes = resetsCleared(action);
    const patch: SheetData = {};
    for (const r of resources) if (scopes.includes(r.reset)) patch[`res_${r.id}`] = 0;
    // SWN Effort fully returns at the end of a scene.
    if (action === 'scene' && character.system === 'swn') patch.effortCommitted = 0;
    intents.updateCharacter(character.id, patch);
  }

  const succ = Number(sheet.deathSuccesses) || 0;
  const fail = Number(sheet.deathFailures) || 0;
  const concentration = typeof sheet.concentration === 'string' ? sheet.concentration : '';

  return (
    <section className="sheet-section combat-status">
      <h4>Combat Status</h4>

      {concentration && (
        <div className="cs-concentration">
          <span>🌀 Concentrating: <strong>{concentration}</strong></span>
          {editable && <button className="link" onClick={() => intents.updateCharacter(character.id, { concentration: '' })}>drop</button>}
        </div>
      )}

      {(downed || dead) && (
        <div className={`cs-downed ${dead ? 'dead' : ''}`}>
          {dead ? (
            <span>💀 <strong>{character.name} is dead.</strong></span>
          ) : (
            <>
              <span>💤 <strong>Downed</strong> — death saves</span>
              <span className="cs-death-pips">
                <span className="cs-death succ">{'✓'.repeat(succ)}{'○'.repeat(Math.max(0, 3 - succ))}</span>
                <span className="cs-death fail">{'✗'.repeat(fail)}{'○'.repeat(Math.max(0, 3 - fail))}</span>
              </span>
              {editable && <button className="btn btn-sm" onClick={() => intents.deathSave(character.id)}>Roll death save</button>}
            </>
          )}
        </div>
      )}

      <div className="cs-conditions">
        {list.map((c) => (
          <Term key={c.id} desc={c.desc}>
            <button
              className={`cs-cond ${active.includes(c.id) ? 'on' : ''}`}
              disabled={!editable}
              onClick={() => toggle(c.id)}
            >
              {c.icon} {c.label}
            </button>
          </Term>
        ))}
      </div>

      {resources.length > 0 && (
        <div className="cs-resources">
          <div className="cs-res-head">
            {/* SWADE has no round/scene resource economy — its per-round
                bookkeeping resets server-side; the buttons would do nothing. */}
            {editable && character.system !== 'swade' && (
              <span className="cf-rest">
                <button className="link" onClick={() => reset('round')}>↻ Round</button>
                <button className="link" onClick={() => reset('scene')}>↻ Scene</button>
              </span>
            )}
          </div>
          {resources.map((r) => {
            // SWADE Bennies: the sheet field IS the live pool the Benny menu
            // spends, so −/+ write it directly (+ is literally "award a
            // Benny", uncapped) — and the pips go gold to match the 🪙 menu.
            const isBennies = character.system === 'swade' && r.id === 'bennies';
            const spend = isBennies
              ? () => intents.updateCharacter(character.id, { bennies: Math.max(0, r.remaining - 1) })
              : () => setUsed(r.id, r.used + 1);
            const regain = isBennies
              ? () => intents.updateCharacter(character.id, { bennies: r.remaining + 1 })
              : () => setUsed(r.id, r.used - 1);
            return (
            <div key={r.id} className="cf-res">
              <span className="cf-res-name">
                <Term desc={`${r.note ? `${r.note[0].toUpperCase()}${r.note.slice(1)}. ` : ''}${RESET_DESC[r.reset] ?? ''}`.trim()}>
                  {r.name}
                </Term>
                {r.note ? <span className="dim"> · {r.note}</span> : null}
              </span>
              <span className="cf-res-track">
                <span className="cf-pips">
                  {Array.from({ length: r.max }).map((_, i) => (
                    <span
                      key={i}
                      className={`slot-pip ${i < r.remaining ? 'open' : 'used'}`}
                      style={isBennies && i < r.remaining ? { background: '#e8b93c', borderColor: '#e8b93c' } : undefined}
                    />
                  ))}
                </span>
                <span className="cf-res-count">{r.remaining}/{r.max}</span>
                {editable && (
                  <span className="slot-btns">
                    <button className="icon-btn" title={isBennies ? 'Spend a Benny' : 'Spend'} disabled={r.remaining <= 0} onClick={spend}>−</button>
                    <button className="icon-btn" title={isBennies ? 'Award a Benny' : 'Regain'} disabled={!isBennies && r.used <= 0} onClick={regain}>+</button>
                  </span>
                )}
              </span>
            </div>
            );
          })}
          {/* SWADE: Wounds get the same pip treatment as Bennies, right
              beneath them — red pips fill as wounds land. */}
          {character.system === 'swade' && (() => {
            const wildCard = character.sheet.wildCard !== false;
            const maxW = wildCard ? 3 : 1;
            const wounds = Math.max(0, Math.min(maxW, Number(character.sheet.wounds) || 0));
            return (
              <div className="cf-res">
                <span className="cf-res-name">
                  <Term desc={`Each Wound is −1 to trait rolls and −1 Pace. ${wildCard ? 'A Wild Card is Incapacitated past 3 Wounds' : 'An Extra drops at 1 Wound'}; Soak and Healing remove them.`}>
                    Wounds
                  </Term>
                  <span className="dim"> · −1 trait rolls & Pace each</span>
                </span>
                <span className="cf-res-track">
                  <span className="cf-pips">
                    {Array.from({ length: maxW }).map((_, i) => (
                      <span
                        key={i}
                        className={`slot-pip ${i < wounds ? 'used' : 'open'}`}
                        style={i < wounds ? { background: '#d92626', borderColor: '#d92626' } : undefined}
                      />
                    ))}
                  </span>
                  <span className="cf-res-count">{wounds}/{maxW}</span>
                  {editable && (
                    <span className="slot-btns">
                      <button className="icon-btn" title="Heal a wound" disabled={wounds <= 0} onClick={() => intents.updateCharacter(character.id, { wounds: wounds - 1 })}>−</button>
                      <button className="icon-btn" title="Take a wound" disabled={wounds >= maxW} onClick={() => intents.updateCharacter(character.id, { wounds: wounds + 1 })}>+</button>
                    </span>
                  )}
                </span>
              </div>
            );
          })()}
        </div>
      )}
    </section>
  );
}
