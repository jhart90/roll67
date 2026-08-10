import { useEffect, useRef, useState } from 'react';
import { swadeSnakeEyes, type DieRoll } from 'shared';
import { diceAnimationFinished, overlayMounted, overlayUnmounted, useGameStore } from '../store/game';
import { buildSims, drawFrame, simsSettleTime, DICE_ROLE_DEFAULTS, type DicePalette } from './dice3d';

function DiceCanvas({ animId, dice, byName, total, expression, color, textColor, palette, ending, critFail }: {
  animId: number; dice: DieRoll[]; byName: string; total: number; expression: string; color: string | null; textColor: string | null; palette: DicePalette | null; ending: boolean; critFail: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    overlayMounted(animId);
    // The table sound of the throw: one of three rattles for a normal roll,
    // the big-handful clatter when more than 4 dice hit the felt at once.
    // Autoplay may be blocked before the user's first interaction — ignore.
    const clip = dice.length > 4
      ? '/sounds/dice_many.mp3'
      : `/sounds/dice_${1 + Math.floor(Math.random() * 3)}.mp3`;
    const audio = new Audio(clip);
    audio.volume = 0.6 * useGameStore.getState().localSfxVolume;
    audio.play().catch(() => undefined);
    const sims = buildSims(dice, w, h, color, textColor, palette, critFail);
    const settleAt = simsSettleTime(sims);
    const t0 = performance.now();
    let raf = 0;
    let done = false;
    const tick = (now: number) => {
      const t = now - t0;
      const moving = drawFrame(ctx, sims, t, w, h);
      // `settleAt` is the LAST die's landing time, which for an exploding
      // chain is well after the earlier dice have stopped — so the loop is
      // driven purely by the clock and never bails out during the pause
      // between an ace flashing and its bonus die being thrown.
      if (t >= settleAt && !done) {
        done = true;
        setSettled(true);
        // The result is only safe to print now that every die has landed.
        diceAnimationFinished(animId);
      }
      if (moving || t < settleAt) raf = requestAnimationFrame(tick);
      else drawFrame(ctx, sims, settleAt + 401, w, h); // final resting frame
    };
    raf = requestAnimationFrame(tick);
    return () => { overlayUnmounted(animId); cancelAnimationFrame(raf); };
    // A new roll remounts this component (key on anim id), so run-once is right.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The verdict waits for the dice, exactly as the total does — announcing
  // snake eyes over dice still in the air would spoil the throw.
  const showCrit = critFail && settled;
  return (
    <div className={`dice-overlay ${ending ? 'ending' : ''} ${showCrit ? 'critfail' : ''}`}>
      <canvas ref={canvasRef} className="dice3d-canvas" />
      {showCrit && <div className="dice-critfail-banner">💀 SNAKE EYES</div>}
      <div className="dice-roller-name">
        {byName} rolls {expression}{settled ? <span className="dice-total"> = {total}</span> : '…'}
      </div>
    </div>
  );
}

/** Full-screen (non-interactive) 3D dice for the latest roll in chat. */
export function DiceOverlay() {
  const anim = useGameStore((s) => s.diceAnim);
  const ending = useGameStore((s) => s.diceAnimEnding);
  const members = useGameStore((s) => s.members);
  const system = useGameStore((s) => s.campaign?.system);
  if (!anim) return null;
  const member = anim.byUserId ? members.find((m) => m.userId === anim.byUserId) : undefined;
  const color = member?.diceColor ?? null;
  const textColor = member?.diceTextColor ?? null;
  // Only SWADE distinguishes trait / Wild Die / raise; every other system keeps
  // the by-size colours and the single-colour override.
  const palette: DicePalette | null = system === 'swade'
    ? {
      trait: member?.diceTraitColor ?? DICE_ROLE_DEFAULTS.trait,
      wild: member?.diceWildColor ?? DICE_ROLE_DEFAULTS.wild,
      raise: member?.diceRaiseColor ?? DICE_ROLE_DEFAULTS.raise,
    }
    : null;
  return (
    <DiceCanvas
      key={anim.id}
      animId={anim.id}
      dice={anim.dice}
      byName={anim.byName}
      total={anim.total}
      expression={anim.expression}
      color={color}
      textColor={textColor}
      palette={palette}
      ending={ending}
      critFail={system === 'swade' && swadeSnakeEyes(anim.dice)}
    />
  );
}
