import { useState } from 'react';
import type { Character } from 'shared';
import {
  bestPsychicSkillLevel, effortMaxFor, getSwnClass,
  hasDiscipline, hasFocus, num, rows, str, termDesc, SWN_FOCI,
} from 'shared';
import { intents } from '../store/game';
import { openWindow } from '../store/windowManager';
import { PICKER_TITLE, pickerKey, type PickerWhat } from './SheetPickerWindow';
import { Term } from '../util/Term';

/** SWN Core-tab panel: class ability, attack bonus, psychic Effort, and the foci
 *  list with pickers that add foci, a background, or an equipment package —
 *  auto-applying skills/gear/HP and announcing the change in chat. */
export function SwnFeatures({ character, editable }: { character: Character; editable: boolean }) {
  const sheet = character.sheet;
  const cls = getSwnClass(String(sheet.class ?? ''));
  const foci = Array.isArray(sheet.foci) ? (sheet.foci as Array<Record<string, unknown>>) : [];
  const attackBonus = Number(sheet.attackBonus ?? 0);
  const effortMax = effortMaxFor(sheet);
  const effortCommitted = Number(sheet.effortCommitted ?? 0);
  const isPsychic = cls?.id === 'psychic' || bestPsychicSkillLevel(sheet) >= 0;
  const isSniper = hasFocus(sheet, 'sniper', 1);
  const aiming = sheet.aimActive === true;

  function setEffort(committed: number) {
    intents.updateCharacter(character.id, { effortCommitted: Math.max(0, Math.min(effortMax, committed)) });
  }
  function toggleAim() {
    intents.updateCharacter(character.id, { aimActive: !aiming });
  }

  // Utility powers (no damage/heal amount) aren't targeted combat actions —
  // give them their own "Use" button here so activating one still commits
  // Effort and rolls the discipline's mishap check.
  const utilityPowers = rows(sheet, 'powers')
    .map((pw, i) => ({ pw, i }))
    .filter(({ pw }) => !str(pw, 'damage', '').trim());

  /** The three "+ X" buttons all open the same picker window, keyed by what
   *  it is choosing and for whom. The adding itself lives there. */
  const openPicker = (what: PickerWhat) =>
    openWindow('sheetPicker', pickerKey(what, character.id), {}, `${PICKER_TITLE[what]} — ${character.name}`);

  return (
    <section className="sheet-section class-features">
      <h4>Class & Foci</h4>

      <div className="cf-notes">
        {cls && <Term desc={cls.ability}><span className="cf-chip">{cls.name}</span></Term>}
        <Term desc={termDesc('swn', 'Attack bonus')}><span className="cf-chip">Attack bonus +{attackBonus}</span></Term>
        {isPsychic && (
          <span className="cf-chip">
            Effort {effortMax - effortCommitted}/{effortMax}
            {editable && effortMax > 0 && (
              <span className="slot-btns" style={{ marginLeft: 4 }}>
                <button className="icon-btn" title="Commit" disabled={effortCommitted >= effortMax} onClick={() => setEffort(effortCommitted + 1)}>−</button>
                <button className="icon-btn" title="Release" disabled={effortCommitted <= 0} onClick={() => setEffort(effortCommitted - 1)}>+</button>
              </span>
            )}
          </span>
        )}
        {isSniper && (
          <button className={`cf-rage ${aiming ? 'on' : ''}`} disabled={!editable} onClick={toggleAim} title="Aim: +4 to hit a ranged shot; adds Shoot-die damage at focus level 2">
            {aiming ? '● Aiming · +4 to hit' : 'Aim (Sniper)'}
          </button>
        )}
      </div>

      {cls && <p className="dim" style={{ fontSize: 12, margin: '4px 0' }}>{cls.ability}</p>}

      {isPsychic && utilityPowers.length > 0 && (
        <div className="cf-feats">
          <span className="cf-feats-label">Powers</span>
          {utilityPowers.map(({ pw, i }) => {
            const discipline = str(pw, 'discipline', '');
            const level = Math.max(1, num(pw, 'level', 1));
            const cost = Math.max(1, num(pw, 'effort', 0) || level);
            const trained = discipline !== '' && hasDiscipline(sheet, discipline);
            const affordable = effortCommitted + cost <= effortMax;
            return (
              <span key={i} className="cf-chip">
                <Term desc={str(pw, 'notes', '') || termDesc('swn', 'Power')}>
                  {str(pw, 'name', 'Power')} ({discipline || '?'}, {cost} Effort)
                </Term>
                {editable && (
                  <button
                    className="link"
                    style={{ marginLeft: 4 }}
                    disabled={!trained || !affordable}
                    title={!trained ? `Not trained in ${discipline || 'this discipline'}` : !affordable ? 'Not enough Effort' : 'Activate'}
                    onClick={() => intents.usePower(character.id, i)}
                  >
                    use
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      <div className="cf-feats">
        <span className="cf-feats-label">Foci</span>
        {foci.filter((f) => !String(f.id ?? '').startsWith('class-')).map((f, i) => (
          <Term key={i} desc={String(f.notes ?? '') || termDesc('swn', 'Focus')}>
            <span className="cf-chip">
              {String(f.name ?? 'Focus')}{Number(f.level) >= 2 ? ' II' : ''}
            </span>
          </Term>
        ))}
        {foci.filter((f) => !String(f.id ?? '').startsWith('class-')).length === 0 && (
          <span className="dim" style={{ fontSize: 11 }}>none</span>
        )}
      </div>

      {editable && (
        <div className="cf-ki-actions">
          <button className="btn btn-sm" onClick={() => openPicker('focus')}>+ Focus</button>
          <button className="btn btn-sm" onClick={() => openPicker('background')}>+ Background</button>
          <button className="btn btn-sm" onClick={() => openPicker('package')}>+ Equipment package</button>
        </div>
      )}

    </section>
  );
}

export interface PickItem { id: string; name: string; tag?: string; desc: string; }

/** Reusable searchable add-list modal (mirrors the 5e FeatPicker styling).
 *  Exported so SwnLevelUpWizard can offer the same focus picker inline. */
export function PickerModal({
  title, subtitle, items, taken, onAdd, onClose,
}: {
  title: string; subtitle: string; items: PickItem[]; taken: Set<string>;
  onAdd: (id: string) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const list = items.filter((it) => !q || it.name.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q));

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-window npc-library feat-picker">
        <div className="sheet-header">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <span className="dim">{subtitle}</span>
          <span className="spacer" />
          <button className="link" onClick={onClose}>close</button>
        </div>
        <div className="npc-controls">
          <input placeholder={`Search ${title.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        </div>
        <div className="feat-list">
          {list.map((it) => (
            <div key={it.id} className={`feat-row ${taken.has(it.id) ? 'taken' : ''}`}>
              <div className="feat-main">
                <span className="feat-name">{it.name}{it.tag ? <span className="dim"> · {it.tag}</span> : null}</span>
                <span className="feat-desc dim">{it.desc}</span>
              </div>
              <div className="feat-actions">
                <button className="btn btn-sm btn-accent" onClick={() => onAdd(it.id)}>{taken.has(it.id) ? 'level up' : 'add'}</button>
              </div>
            </div>
          ))}
          {list.length === 0 && <p className="dim" style={{ padding: 12 }}>Nothing matches that search.</p>}
        </div>
      </div>
    </div>
  );
}
