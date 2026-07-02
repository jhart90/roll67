import type { DieRoll } from 'shared';
import { useGameStore } from '../store/game';
import { DieShape } from './DiceShapes';

function Die3D({ die, index }: { die: DieRoll; index: number }) {
  const dur = 0.9 + (index % 4) * 0.15;
  const spin = index % 2 === 0 ? 'die-tumble-a' : 'die-tumble-b';
  return (
    <div className={`die3d ${die.kept ? '' : 'dropped'}`}>
      <div
        className="die-solid"
        style={{ animation: `${spin} ${dur}s cubic-bezier(0.2, 0.8, 0.3, 1)` }}
      >
        <DieShape sides={die.sides} size={52} />
        <span className="die-value" style={{ animationDelay: `${dur * 0.55}s` }}>
          {die.value}
        </span>
      </div>
      <span className="die-tag">d{die.sides}</span>
    </div>
  );
}

/** Full-screen (non-interactive) 3D dice for the latest roll in chat. */
export function DiceOverlay() {
  const anim = useGameStore((s) => s.diceAnim);
  if (!anim) return null;
  return (
    <div className="dice-overlay" key={anim.id}>
      <div className="dice-roller-name">{anim.byName} rolls…</div>
      <div className="dice-row">
        {anim.dice.map((d, i) => (
          <Die3D key={i} die={d} index={i} />
        ))}
      </div>
    </div>
  );
}
