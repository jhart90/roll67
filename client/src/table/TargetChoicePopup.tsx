import { useEffect } from 'react';
import { useGameStore } from '../store/game';

/**
 * "Which one?" — a targeting click landed on several valid tokens at once,
 * which happens whenever a large piece stands over a small one. The
 * alternative was guessing, and a shot fired at the wrong creature is not
 * something an undo can put back. Sits by the click; Escape or clicking
 * away keeps the aim and drops the question.
 */
export function TargetChoicePopup() {
  const choice = useGameStore((s) => s.targetChoice);
  const tokens = useGameStore((s) => s.tokens);
  useEffect(() => {
    if (!choice) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useGameStore.setState({ targetChoice: null }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choice]);
  if (!choice) return null;
  const candidates = choice.tokenIds.map((id) => tokens[id]).filter((t): t is NonNullable<typeof t> => !!t);
  if (candidates.length === 0) return null;
  // Kept on screen: nudged left/up when the click was near an edge.
  const left = Math.min(choice.x, window.innerWidth - 240);
  const top = Math.min(choice.y, window.innerHeight - (candidates.length * 34 + 60));
  return (
    <>
      <div className="target-choice-scrim" onPointerDown={() => useGameStore.setState({ targetChoice: null })} />
      <div className="target-choice" style={{ left, top }}>
        <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>Several tokens here — which one?</div>
        {candidates.map((t) => (
          <button key={t.id} onClick={() => useGameStore.getState().resolveTarget(t.id)}>
            <span className="target-choice-dot" style={{ background: t.color }} />
            {t.name}
          </button>
        ))}
      </div>
    </>
  );
}
