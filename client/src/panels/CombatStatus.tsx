import type { Character, SheetData } from 'shared';
import { combatResources, conditionsFor, conditionsOf, resetsCleared, systemFor } from 'shared';
import { intents } from '../store/game';

/** Shared "effect engine" panel on the Core tab: status conditions, the
 *  downed/death-save block, and universal reaction/reroll trackers. */
export function CombatStatus({ character, editable }: { character: Character; editable: boolean }) {
  const sheet = character.sheet;
  const active = conditionsOf(sheet);
  const list = conditionsFor(character.system);
  const resources = combatResources(character.system, sheet);
  const { hp } = systemFor(character.system).hp(sheet);
  const downed = hp <= 0 && !active.includes('dead');
  const dead = active.includes('dead');

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
          <button
            key={c.id}
            className={`cs-cond ${active.includes(c.id) ? 'on' : ''}`}
            title={c.desc}
            disabled={!editable}
            onClick={() => toggle(c.id)}
          >
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      {resources.length > 0 && (
        <div className="cs-resources">
          <div className="cs-res-head">
            {editable && (
              <span className="cf-rest">
                <button className="link" onClick={() => reset('round')}>↻ Round</button>
                <button className="link" onClick={() => reset('scene')}>↻ Scene</button>
              </span>
            )}
          </div>
          {resources.map((r) => (
            <div key={r.id} className="cf-res">
              <span className="cf-res-name">{r.name}{r.note ? <span className="dim"> · {r.note}</span> : null}</span>
              <span className="cf-res-track">
                <span className="cf-pips">
                  {Array.from({ length: r.max }).map((_, i) => (
                    <span key={i} className={`slot-pip ${i < r.remaining ? 'open' : 'used'}`} />
                  ))}
                </span>
                <span className="cf-res-count">{r.remaining}/{r.max}</span>
                {editable && (
                  <span className="slot-btns">
                    <button className="icon-btn" title="Spend" disabled={r.remaining <= 0} onClick={() => setUsed(r.id, r.used + 1)}>−</button>
                    <button className="icon-btn" title="Regain" disabled={r.used <= 0} onClick={() => setUsed(r.id, r.used - 1)}>+</button>
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
