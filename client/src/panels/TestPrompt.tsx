import { useState } from 'react';
import { SKILLS_SWADE, SKILL_ATTR_SWADE } from 'shared';
import { intents, useGameStore } from '../store/game';

/**
 * Setting up a SWADE Test: who tries the trick, with what, on whom.
 *
 * The skill picker names each skill's resisting attribute right in the
 * option — "Taunt — vs Smarts" — because that pairing IS the rule, and a GM
 * reading it in the dropdown never has to keep the linkage table in their
 * head. The modifier is the GM's whole toolkit here: range and cover for a
 * Shooting Test, a steep penalty for a trick going stale, +2 for hitting a
 * rival where it hurts.
 */
export function TestPrompt({ onClose }: { onClose: () => void }) {
  const map = useGameStore((s) => s.map);
  const tokens = useGameStore((s) => s.tokens);
  const initiative = useGameStore((s) => s.initiativeState);
  const mapTokens = map
    ? Object.values(tokens).filter((t) => t.mapId === map.id && t.characterId)
    : [];

  // Whoever is up is probably the one trying the trick.
  const upNow = initiative.active ? initiative.entries[initiative.turnIdx]?.tokenId : undefined;
  const [attackerId, setAttackerId] = useState(
    mapTokens.find((t) => t.id === upNow)?.id ?? mapTokens[0]?.id ?? '',
  );
  const [targetId, setTargetId] = useState(mapTokens.find((t) => t.id !== attackerId)?.id ?? '');
  const [skill, setSkill] = useState('Taunt');
  const [mod, setMod] = useState(0);

  const attr = SKILL_ATTR_SWADE[skill] ?? 'agility';
  const ready = attackerId && targetId && attackerId !== targetId;

  function go() {
    if (!ready) return;
    intents.requestTest({ attackerTokenId: attackerId, targetTokenId: targetId, skill, mod: mod || undefined });
    onClose();
  }

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel levelup">
        <div className="dock-header">
          <h3>Call for a Test</h3>
          <button className="link" onClick={onClose}>close</button>
        </div>
        <p className="dim" style={{ fontSize: 12 }}>
          An opposed trick — the skill against the attribute it is linked to.
          Win: the target is Distracted or Vulnerable, your pick. Win with a
          raise: Shaken on top.
        </p>

        <label className="lu-field">
          Who tries it
          <select value={attackerId} onChange={(e) => setAttackerId(e.target.value)}>
            {mapTokens.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>

        <label className="lu-field">
          With
          <select value={skill} onChange={(e) => setSkill(e.target.value)}>
            {SKILLS_SWADE.map((k) => (
              <option key={k} value={k}>
                {k} — vs {(SKILL_ATTR_SWADE[k] ?? 'agility').replace(/^./, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        </label>

        <label className="lu-field">
          Against
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {mapTokens.filter((t) => t.id !== attackerId).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>

        <label className="lu-field">
          GM modifier
          <input
            type="number" min={-10} max={10} value={mod}
            title="Range, cover, illumination for a Shooting Test; a steep penalty for repetition; +2 for a trick that truly hits home"
            onChange={(e) => setMod(Math.max(-10, Math.min(10, Number(e.target.value) || 0)))}
          />
        </label>
        <p className="dim" style={{ fontSize: 11 }}>
          Resisted by {attr.replace(/^./, (c) => c.toUpperCase())} — never Parry,
          and the resister's own wounds and conditions apply.
        </p>

        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" style={{ width: 'auto' }} disabled={!ready} onClick={go}>
            🤼 Roll the Test
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
