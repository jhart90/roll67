import type { DieRoll } from 'shared';
import { useGameStore } from '../store/game';

const DIE_COLORS: Record<number, string> = {
  4: '#d26c6c',
  6: '#6c9bd2',
  8: '#7ed28a',
  10: '#6cd2c8',
  12: '#b06cd2',
  20: '#d2a56c',
  100: '#d2d26c',
};

/** Deterministic pseudo-values for the non-front faces of a die. */
function faceValue(die: DieRoll, face: number): number {
  return ((die.value * 7 + face * 13) % die.sides) + 1;
}

function Die3D({ die, index }: { die: DieRoll; index: number }) {
  const color = DIE_COLORS[die.sides] ?? '#9aa1b3';
  const dur = 0.9 + (index % 4) * 0.15;
  const spin = index % 2 === 0 ? 'dice-tumble-a' : 'dice-tumble-b';
  return (
    <div className={`die3d ${die.kept ? '' : 'dropped'}`}>
      <div
        className="die-cube"
        style={{ animation: `${spin} ${dur}s cubic-bezier(0.2, 0.8, 0.3, 1)`, ['--die-color' as string]: color }}
      >
        <div className="die-face front">{die.value}</div>
        <div className="die-face back">{faceValue(die, 1)}</div>
        <div className="die-face right">{faceValue(die, 2)}</div>
        <div className="die-face left">{faceValue(die, 3)}</div>
        <div className="die-face top">{faceValue(die, 4)}</div>
        <div className="die-face bottom">{faceValue(die, 5)}</div>
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
