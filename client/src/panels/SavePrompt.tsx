import { useState } from 'react';
import { DAMAGE_TYPES, systemFor } from 'shared';
import { intents, useGameStore } from '../store/game';

/** DM "call for save": pick targets on the current map, a save + DC, and an
 *  optional damage roll applied fully on a fail / halved on a save. */
export function SavePrompt({ onClose }: { onClose: () => void }) {
  const campaign = useGameStore((s) => s.campaign);
  const map = useGameStore((s) => s.map);
  const tokens = useGameStore((s) => s.tokens);
  const mapTokens = map ? Object.values(tokens).filter((t) => t.mapId === map.id) : [];

  const saveIds = campaign ? systemFor(campaign.system).saveIds() : [];
  const [saveId, setSaveId] = useState(saveIds[0]?.id ?? 'dex');
  const [dc, setDc] = useState(13);
  const [damageExpr, setDamageExpr] = useState('');
  const [onSave, setOnSave] = useState<'half' | 'negate'>('half');
  const [damageType, setDamageType] = useState('');
  const [label, setLabel] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set(mapTokens.map((t) => t.id)));

  function toggle(id: string) {
    setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function apply() {
    if (picked.size === 0) return;
    intents.requestSave({
      tokenIds: [...picked], saveId, dc,
      damageExpr: damageExpr.trim() || undefined,
      onSave, damageType: damageType || undefined, label: label.trim() || undefined,
    });
    onClose();
  }

  // Target-number systems derive their own threshold — no DC input needed.
  const swn = campaign?.system === 'swn';
  const swade = campaign?.system === 'swade';
  const targetNumber = swn || swade;

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup">
        <div className="dock-header">
          <h3>Call for a Saving Throw</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>

        <label className="lu-field">
          Save
          <select value={saveId} onChange={(e) => setSaveId(e.target.value)}>
            {saveIds.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>

        {!targetNumber && (
          <label className="lu-field">
            DC
            <input type="number" value={dc} onChange={(e) => setDc(Number(e.target.value) || 0)} />
          </label>
        )}
        {swn && <p className="dim" style={{ fontSize: 12 }}>SWN: each target rolls against its own save target (15 − level − mod).</p>}
        {swade && <p className="dim" style={{ fontSize: 12 }}>SWADE: each target makes a trait roll against target number 4 (wild die included).</p>}

        <label className="lu-field">
          Damage (optional, e.g. 8d6)
          <input value={damageExpr} onChange={(e) => setDamageExpr(e.target.value)} placeholder="none" />
        </label>

        {damageExpr.trim() && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <label className="lu-field" style={{ flex: 1 }}>
              On save
              <select value={onSave} onChange={(e) => setOnSave(e.target.value as 'half' | 'negate')}>
                <option value="half">half damage</option>
                <option value="negate">no damage</option>
              </select>
            </label>
            <label className="lu-field" style={{ flex: 1 }}>
              Damage type
              <select value={damageType} onChange={(e) => setDamageType(e.target.value)}>
                <option value="">untyped</option>
                {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
        )}

        <label className="lu-field">
          Label (optional)
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Fireball, Fear, …" />
        </label>

        <div className="lu-field">
          <span>Targets ({picked.size}/{mapTokens.length})</span>
          <div className="save-targets">
            {mapTokens.map((t) => (
              <label key={t.id} className={`lu-skill ${picked.has(t.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
                {t.name}{t.layer === 'gm' ? ' 🕶' : ''}
              </label>
            ))}
            {mapTokens.length === 0 && <span className="dim">No tokens on this map.</span>}
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" style={{ width: 'auto' }} disabled={picked.size === 0} onClick={apply}>
            Roll saves{damageExpr.trim() ? ' & apply' : ''}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
