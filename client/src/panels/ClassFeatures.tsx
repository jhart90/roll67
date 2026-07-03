import { useState } from 'react';
import type { Character, SheetData } from 'shared';
import {
  attacksPerAction, classId, classResources, critRange, isRaging, martialArtsDie,
  rageDamage, remarkableAthleteBonus, sneakAttackDice, superiorityDice, takenFeats,
} from 'shared';
import { intents } from '../store/game';
import { FeatPicker } from './FeatPicker';

/** Class resource trackers (rage/ki/…), Extra Attack / Sneak Attack notes, and
 *  the Rage toggle. Rendered on the Core tab for 5e characters. */
export function ClassFeatures({ character, editable }: { character: Character; editable: boolean }) {
  const [showFeats, setShowFeats] = useState(false);
  const sheet = character.sheet;
  const feats = takenFeats(sheet);
  const resources = classResources(sheet);
  const attacks = attacksPerAction(sheet);
  const sneak = sneakAttackDice(sheet);
  const raging = isRaging(sheet);
  const level = Number(sheet.level) || 1;
  const cls = classId(sheet);
  const isBarbarian = cls === 'barbarian';
  const isMonk = cls === 'monk';
  const style = String(sheet.fightingStyle ?? '');
  const hasStyle = style && style !== '—';
  const ki = resources.find((r) => r.id === 'ki');
  const crit = critRange(sheet);
  const remarkable = remarkableAthleteBonus(sheet) > 0;
  const battleMaster = !!superiorityDice(sheet);
  const hasSub = crit < 20 || remarkable || battleMaster;
  const hasContent = resources.length > 0 || attacks > 1 || sneak > 0 || isBarbarian || isMonk || hasStyle || hasSub || feats.length > 0;

  // Editable 5e sheets always show the panel so "+ Feat" is available.
  if (!hasContent && !editable) return null;

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
  function kiAction(name: string, cost: number) {
    if (!ki || ki.remaining < cost) return;
    intents.updateCharacter(character.id, { res_ki: ki.used + cost });
    intents.chat(`${character.name} uses ${name} (−${cost} ki)`);
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

      {(attacks > 1 || sneak > 0 || isBarbarian || isMonk || hasStyle) && (
        <div className="cf-notes">
          {attacks > 1 && <span className="cf-chip">Extra Attack — {attacks} attacks / action</span>}
          {sneak > 0 && <span className="cf-chip">Sneak Attack {sneak}d6</span>}
          {isMonk && <span className="cf-chip">Martial Arts {martialArtsDie(level)}</span>}
          {hasStyle && <span className="cf-chip">Fighting Style: {style}</span>}
          {crit < 20 && <span className="cf-chip">Improved Critical {crit}–20</span>}
          {remarkable && <span className="cf-chip">Remarkable Athlete</span>}
          {battleMaster && <span className="cf-chip">Battle Master maneuvers</span>}
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

      {isMonk && ki && (
        <div className="cf-ki-actions">
          {[['Flurry of Blows', 1], ['Patient Defense', 1], ['Step of the Wind', 1]].map(([name, cost]) => (
            <button
              key={name as string}
              className="btn btn-sm"
              disabled={!editable || ki.remaining < (cost as number)}
              onClick={() => kiAction(name as string, cost as number)}
            >
              {name} (−{cost} ki)
            </button>
          ))}
          <span className="dim" style={{ fontSize: 11 }}>Stunning Strike: spend 1 ki on a hit</span>
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

      <div className="cf-feats">
        <span className="cf-feats-label">Feats</span>
        {feats.map((ft) => <span key={ft.id} className="cf-chip" title={ft.desc}>{ft.name}</span>)}
        {feats.length === 0 && <span className="dim" style={{ fontSize: 11 }}>none</span>}
        {editable && <button className="link cf-add-feat" onClick={() => setShowFeats(true)}>+ Feat</button>}
      </div>

      {showFeats && <FeatPicker character={character} onClose={() => setShowFeats(false)} />}
    </section>
  );
}
