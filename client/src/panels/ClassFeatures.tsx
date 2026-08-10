import type { Character, SheetData } from 'shared';
import {
  attacksPerAction, classId, classResources, critRange, divineSmite, isRaging,
  isThirdCaster, martialArtsDie, rageDamage, remarkableAthleteBonus, sneakAttackDice, superiorityDice,
  takenFeats, takenPickIds, INFUSIONS_5E, INVOCATIONS_5E, METAMAGIC_5E,
} from 'shared';
import { intents } from '../store/game';
import { openWindow } from '../store/windowManager';
import { PICKER_TITLE, pickerKey, type PickerWhat } from './SheetPickerWindow';
import { Term } from '../util/Term';

/** Class resource trackers (rage/ki/…), Extra Attack / Sneak Attack notes, and
 *  the Rage toggle. Rendered on the Core tab for 5e characters. */
export function ClassFeatures({ character, editable }: { character: Character; editable: boolean }) {
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
  const thirdCaster = isThirdCaster(sheet) && (Number(sheet.level) || 1) >= 3;
  const smite = divineSmite(sheet);
  const invocations = takenPickIds(sheet, 'invocations');
  const metamagic = takenPickIds(sheet, 'metamagic');
  const infusions = takenPickIds(sheet, 'infusions');
  const showInvocations = cls === 'warlock' && level >= 2;
  const showMetamagic = cls === 'sorcerer' && level >= 3;
  const showInfusions = cls === 'artificer' && level >= 2;
  const hasSub = crit < 20 || remarkable || battleMaster || thirdCaster || !!smite;
  const hasContent = resources.length > 0 || attacks > 1 || sneak > 0 || isBarbarian || isMonk || hasStyle || hasSub || feats.length > 0
    || showInvocations || showMetamagic || showInfusions;
  /** Every "+ X" button here opens the same picker window, keyed by what it
   *  is choosing and for whom — so two characters can be shopping at once. */
  const openPicker = (what: PickerWhat) =>
    openWindow('sheetPicker', pickerKey(what, character.id), {}, `${PICKER_TITLE[what]} — ${character.name}`);

  const powerAttackFeat = feats.find((f) => f.powerAttack);
  const powerAttackOn = sheet.powerAttackActive === true;
  const dualWielderFeat = feats.find((f) => f.dualWielderAc);
  const dualWieldOn = sheet.dualWieldingActive === true;

  // Editable 5e sheets always show the panel so "+ Feat" is available.
  if (!hasContent && !editable) return null;

  function setUsed(id: string, used: number) {
    intents.updateCharacter(character.id, { [`res_${id}`]: Math.max(0, used) });
  }
  function shortRest() {
    const patch: SheetData = { res_reaction: 0 };
    for (const r of resources) if (r.reset === 'short') patch[`res_${r.id}`] = 0;
    intents.updateCharacter(character.id, patch);
  }
  function longRest() {
    // A long rest also refreshes the universal reaction + Luck pools.
    const patch: SheetData = { rageActive: false, res_reaction: 0, res_luck: 0 };
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
  function togglePowerAttack() {
    intents.updateCharacter(character.id, { powerAttackActive: !powerAttackOn });
  }
  function toggleDualWield() {
    intents.updateCharacter(character.id, { dualWieldingActive: !dualWieldOn });
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

      {(attacks > 1 || sneak > 0 || isBarbarian || isMonk || hasStyle || powerAttackFeat || dualWielderFeat) && (
        <div className="cf-notes">
          {attacks > 1 && <span className="cf-chip">Extra Attack — {attacks} attacks / action</span>}
          {sneak > 0 && <span className="cf-chip">Sneak Attack {sneak}d6</span>}
          {isMonk && <span className="cf-chip">Martial Arts {martialArtsDie(level)}</span>}
          {hasStyle && <span className="cf-chip">Fighting Style: {style}</span>}
          {crit < 20 && <span className="cf-chip">Improved Critical {crit}–20</span>}
          {remarkable && <span className="cf-chip">Remarkable Athlete</span>}
          {battleMaster && <span className="cf-chip">Battle Master maneuvers</span>}
          {thirdCaster && <span className="cf-chip">{String(sheet.subclass)} casting (INT)</span>}
          {smite?.improved && <span className="cf-chip">Improved Divine Smite +1d8 melee</span>}
          {isBarbarian && (raging ? (
            <button className="cf-rage on" disabled={!editable} onClick={toggleRage}>
              ● RAGING +{rageDamage(level)} · end rage
            </button>
          ) : (
            <button className="cf-rage" disabled={!editable || rageOut} onClick={toggleRage}>
              {rageOut ? 'No rages left' : 'Enter Rage'}
            </button>
          ))}
          {powerAttackFeat && (
            <button className={`cf-rage ${powerAttackOn ? 'on' : ''}`} disabled={!editable} onClick={togglePowerAttack} title={powerAttackFeat.name}>
              {powerAttackOn ? '● Power Attack (−5/+10) · on' : 'Power Attack (−5/+10)'}
            </button>
          )}
          {dualWielderFeat && (
            <button className={`cf-rage ${dualWieldOn ? 'on' : ''}`} disabled={!editable} onClick={toggleDualWield} title={dualWielderFeat.name}>
              {dualWieldOn ? `● Dual-Wielding +${dualWielderFeat.dualWielderAc} AC` : 'Dual-Wielding?'}
            </button>
          )}
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
        {feats.map((ft) => <Term key={ft.id} desc={ft.desc}><span className="cf-chip">{ft.name}</span></Term>)}
        {feats.length === 0 && <span className="dim" style={{ fontSize: 11 }}>none</span>}
        {editable && <button className="link cf-add-feat" onClick={() => openPicker('feats')}>+ Feat</button>}
      </div>

      {showInvocations && (
        <div className="cf-feats">
          <span className="cf-feats-label">Invocations</span>
          {invocations.map((id) => {
            const p = INVOCATIONS_5E.find((x) => x.id === id);
            return p ? <Term key={id} desc={p.desc}><span className="cf-chip">{p.name}</span></Term> : null;
          })}
          {invocations.length === 0 && <span className="dim" style={{ fontSize: 11 }}>none</span>}
          {editable && <button className="link cf-add-feat" onClick={() => openPicker('invocations')}>+ Invocation</button>}
        </div>
      )}

      {showMetamagic && (
        <div className="cf-feats">
          <span className="cf-feats-label">Metamagic</span>
          {metamagic.map((id) => {
            const p = METAMAGIC_5E.find((x) => x.id === id);
            return p ? <Term key={id} desc={p.desc}><span className="cf-chip">{p.name}</span></Term> : null;
          })}
          {metamagic.length === 0 && <span className="dim" style={{ fontSize: 11 }}>none</span>}
          {editable && <button className="link cf-add-feat" onClick={() => openPicker('metamagic')}>+ Metamagic</button>}
        </div>
      )}

      {showInfusions && (
        <div className="cf-feats">
          <span className="cf-feats-label">Infusions</span>
          {infusions.map((id) => {
            const p = INFUSIONS_5E.find((x) => x.id === id);
            return p ? <Term key={id} desc={p.desc}><span className="cf-chip">{p.name}</span></Term> : null;
          })}
          {infusions.length === 0 && <span className="dim" style={{ fontSize: 11 }}>none</span>}
          {editable && <button className="link cf-add-feat" onClick={() => openPicker('infusions')}>+ Infusion</button>}
        </div>
      )}

    </section>
  );
}
