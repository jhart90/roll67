import type { Character, SheetData } from 'shared';
import { attacksPerAction, classResources, isRaging, rageDamage, sneakAttackDice } from 'shared';
import { intents } from '../store/game';

/** Class resource trackers (rage/ki/…), Extra Attack / Sneak Attack notes, and
 *  the Rage toggle. Rendered on the Core tab for 5e characters. */
export function ClassFeatures({ character, editable }: { character: Character; editable: boolean }) {
  const sheet = character.sheet;
  const resources = classResources(sheet);
  const attacks = attacksPerAction(sheet);
  const sneak = sneakAttackDice(sheet);
  const raging = isRaging(sheet);
  const level = Number(sheet.level) || 1;
  const isBarbarian = String(sheet.class ?? '').toLowerCase().includes('barbarian');

  if (resources.length === 0 && attacks <= 1 && sneak === 0 && !isBarbarian) return null;

  function setUsed(id: string, used: number) {
    intents.updateCharacter(character.id, { [`res_${id}`]: Math.max(0, used) });
  }
  function shortRest() {
    const patch: SheetData = {};
    for (const r of resources) if (r.reset === 'short') patch[`res_${r.id}`] = 0;
    intents.updateCharacter(character.id, patch);
  }
  function longRest() {
    const patch: SheetData = { rageActive: false };
    for (const r of resources) patch[`res_${r.id}`] = 0;
    for (let n = 1; n <= 9; n++) patch[`slotsUsed${n}`] = 0;
    intents.updateCharacter(character.id, patch);
  }
  function toggleRage() {
    if (raging) { intents.updateCharacter(character.id, { rageActive: false }); return; }
    const rage = resources.find((r) => r.id === 'rage');
    if (rage && rage.remaining <= 0) return;
    intents.updateCharacter(character.id, { rageActive: true, res_rage: (rage?.used ?? 0) + 1 });
  }

  const rageOut = (resources.find((r) => r.id === 'rage')?.remaining ?? 0) <= 0;

  return (
    <section className="sheet-section class-features">
      <h4>
        Class Features
        {editable && (
          <span className="cf-rest">
            <button className="link" onClick={shortRest}>Short rest</button>
            <button className="link" onClick={longRest}>Long rest ⟳</button>
          </span>
        )}
      </h4>

      {(attacks > 1 || sneak > 0 || isBarbarian) && (
        <div className="cf-notes">
          {attacks > 1 && <span className="cf-chip">Extra Attack — {attacks} attacks / action</span>}
          {sneak > 0 && <span className="cf-chip">Sneak Attack {sneak}d6</span>}
          {isBarbarian && (raging ? (
            <button className="cf-rage on" disabled={!editable} onClick={toggleRage}>
              ● RAGING +{rageDamage(level)} · end rage
            </button>
          ) : (
            <button className="cf-rage" disabled={!editable || rageOut} onClick={toggleRage}>
              {rageOut ? 'No rages left' : 'Enter Rage'}
            </button>
          ))}
        </div>
      )}

      {resources.length > 0 && (
        <div className="cf-resources">
          {resources.map((r) => {
            const unlimited = r.max >= 99;
            return (
              <div key={r.id} className="cf-res">
                <span className="cf-res-name">{r.name}{r.note ? <span className="dim"> · {r.note}</span> : null}</span>
                <span className="cf-res-track">
                  {unlimited ? (
                    <span className="cf-res-count">∞</span>
                  ) : (
                    <>
                      {!r.pool && (
                        <span className="cf-pips">
                          {Array.from({ length: r.max }).map((_, i) => (
                            <span key={i} className={`slot-pip ${i < r.remaining ? 'open' : 'used'}`} />
                          ))}
                        </span>
                      )}
                      <span className="cf-res-count">{r.remaining}/{r.max}</span>
                      {editable && (
                        <span className="slot-btns">
                          <button className="icon-btn" title="Spend" disabled={r.remaining <= 0} onClick={() => setUsed(r.id, r.used + 1)}>−</button>
                          <button className="icon-btn" title="Regain" disabled={r.used <= 0} onClick={() => setUsed(r.id, r.used - 1)}>+</button>
                        </span>
                      )}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
