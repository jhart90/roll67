import { useGameStore } from '../store/game';

/** Asks which spell slot to spend when a spell can be cast at multiple levels. */
export function CastLevelPopup() {
  const prompt = useGameStore((s) => s.castPrompt);
  if (!prompt) return null;
  const cancel = () => useGameStore.getState().cancelCast();

  return (
    <div className="sheet-backdrop" style={{ zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="panel cast-popup">
        <div className="dock-header"><h3>Cast {prompt.label}</h3><button className="link" onClick={cancel}>cancel</button></div>
        <p className="dim" style={{ fontSize: 12 }}>Choose a spell slot to spend:</p>
        <div className="cast-levels">
          {prompt.levels.map((lvl) => (
            <button key={lvl} className="btn btn-accent" onClick={() => useGameStore.getState().castSpell(prompt.characterId, prompt.rollableId, lvl)}>
              Level {lvl}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
