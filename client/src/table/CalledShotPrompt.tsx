import { useState } from 'react';
import {
  CALLED_SHOTS, calledShotPenalty, clampCalledShotPenalty, scaleLabel, type CalledShotTarget,
} from 'shared';
import { useGameStore } from '../store/game';

/**
 * "What are you aiming at?" — asked once the target is picked, because a
 * Called Shot is priced off the PART's Scale and the part belongs to the
 * defender. A Huge creature's head is the size of a small car, so the same
 * shot that is −4 against a person is 0 against the Huge one.
 *
 * This replaces the ordinary Scale difference rather than adding to it: the
 * book says the modifier depends on "the Scale of the target itself, not the
 * creature it's part of".
 */
export function CalledShotPrompt() {
  const pending = useGameStore((s) => s.calledShotPending);
  const targeting = useGameStore((s) => s.targeting);
  const tokens = useGameStore((s) => s.tokens);
  const characters = useGameStore((s) => s.characters);
  const [pick, setPick] = useState('head');
  const [custom, setCustom] = useState('-4');

  if (!pending || !targeting) return null;
  const tok = tokens[pending.targetTokenId];
  const defender = tok?.characterId ? characters.find((c) => c.id === tok.characterId) : undefined;
  const size = Number(defender?.sheet.size ?? 0) || 0;

  const priced = (c: CalledShotTarget) => calledShotPenalty(c, size);
  const chosen = pick === 'custom'
    ? { label: 'Custom', penalty: clampCalledShotPenalty(Number(custom)), damageBonus: 0 }
    : (() => {
      const c = CALLED_SHOTS.find((x) => x.id === pick)!;
      return { label: c.label, penalty: priced(c), damageBonus: c.damageBonus ?? 0 };
    })();
  const sign = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n)}`;

  return (
    <div className="sheet-backdrop" style={{ zIndex: 80 }}>
      <div className="panel called-shot-prompt">
        <div className="dock-header">
          <h3>🎯 Called shot — {tok?.name ?? 'target'}</h3>
        </div>
        <p className="dim" style={{ fontSize: 12, margin: '0 0 6px' }}>
          Priced off the part&rsquo;s own Scale, not the creature&rsquo;s. This target is{' '}
          <strong>{scaleLabel(size)}</strong>{size !== 0 ? ` (Size ${sign(size)})` : ''}, so its parts are sized to match.
        </p>
        <div className="cs-options">
          {CALLED_SHOTS.map((c) => (
            <label key={c.id} className={`cs-option ${pick === c.id ? 'on' : ''}`} title={c.note}>
              <input type="radio" name="cs" checked={pick === c.id} onChange={() => setPick(c.id)} />
              <span className="cs-name">{c.label}{c.fixed ? ' *' : ''}</span>
              <span className="cs-pen">{sign(priced(c))}</span>
              {c.damageBonus ? <span className="cs-dmg">+{c.damageBonus} dmg</span> : <span />}
            </label>
          ))}
          <label className={`cs-option ${pick === 'custom' ? 'on' : ''}`} title="Any other part — enter its Scale modifier yourself.">
            <input type="radio" name="cs" checked={pick === 'custom'} onChange={() => setPick('custom')} />
            <span className="cs-name">Custom Scale modifier</span>
            <input
              className="cs-custom" type="number" min={-8} max={6} value={custom}
              onFocus={() => setPick('custom')}
              onChange={(e) => setCustom(e.target.value)}
            />
            <span />
          </label>
        </div>
        <p className="dim" style={{ fontSize: 11, margin: '0 0 4px' }}>
          * an item is its own size whoever is holding it, so it does not grow with the target.
        </p>
        <p className="cs-summary">
          {chosen.label}: <strong>{sign(chosen.penalty)}</strong> to the attack
          {chosen.damageBonus ? <> · <strong>+{chosen.damageBonus}</strong> damage on a hit</> : null}
        </p>
        <div className="row">
          <button className="primary" onClick={() => useGameStore.getState().confirmCalledShot(chosen)}>
            Take the shot
          </button>
          <button onClick={() => useGameStore.getState().cancelCalledShot()}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
