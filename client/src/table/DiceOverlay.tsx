import { useEffect, useRef, useState } from 'react';
import { ACE_STYLE_DEFAULT, DICE_BOUNCE_PCT_DEFAULT, isAceStyle, swadeSnakeEyes, type AceStyle, type DiceLook, type DieRoll, type SheetData } from 'shared';
import { diceAnimationFinished, overlayMounted, overlayUnmounted, useGameStore } from '../store/game';
import { buildSims, drawFrame, simsSettleTime, DICE_ROLE_DEFAULTS, type DicePalette, type PlayBounds } from './dice3d';

/**
 * The walls dice bounce off: the playable map, not the browser window. Read
 * from the live layout rather than hardcoded, so the rail and the chat dock
 * can change width without dice starting to carom off thin air. Falls back to
 * the full canvas if the table isn't mounted the way we expect.
 */
function playBounds(w: number, h: number): PlayBounds {
  const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
  const main = rect('.table-main');
  const rail = rect('.tool-rail');
  const dock = rect('.dock');
  return {
    left: rail?.right ?? 0,
    right: dock?.left ?? w,
    top: main?.top ?? 0,
    bottom: main?.bottom ?? h,
  };
}

function DiceCanvas({ animId, dice, byName, total, expression, color, textColor, palette, ending, critFail, bouncePct, aceStyle }: {
  animId: number; dice: DieRoll[]; byName: string; total: number; expression: string; color: string | null; textColor: string | null; palette: DicePalette | null; ending: boolean; critFail: boolean; bouncePct: number; aceStyle: AceStyle;
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
    const sims = buildSims(dice, w, h, color, textColor, palette, critFail, playBounds(w, h), bouncePct, aceStyle);
    const settleAt = simsSettleTime(sims);
    const t0 = performance.now();
    let raf = 0;
    let done = false;
    const tick = (now: number) => {
      const t = now - t0;
      const moving = drawFrame(ctx, sims, t, w, h, playAceSound);
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
/**
 * The sound each Ace style makes, played on every screen the moment the
 * effect starts — the animation is already broadcast, so each client fires
 * its own clip rather than the server sending an extra event.
 *
 * Several files per style are picked at random, so a chain of aces does not
 * play the same explosion four times in a row. A style with nothing
 * listed simply stays silent.
 */
const ACE_SOUNDS: Partial<Record<AceStyle, string[]>> = {
  flash: ['shine_1'],
  explosion: ['explosion_1', 'explosion_2', 'explosion_3', 'explosion_4'],
  flames: ['fire_1'],
  disco: ['disco_1'],
  rainbow: ['rainbow_1'],
  smoke: ['smoke_1'],
  water: ['water_1', 'water_2'],
  confetti: ['confetti_1'],
};

export function playAceSound(style: AceStyle): void {
  const pool = ACE_SOUNDS[style];
  if (!pool || pool.length === 0) return;
  const clip = pool[Math.floor(Math.random() * pool.length)];
  const audio = new Audio(`/sounds/ace/${clip}.mp3`);
  // Under the dice clatter it rides with, and muted with everything else.
  const s = useGameStore.getState();
  audio.volume = 0.5 * s.localSfxVolume * (s.clientMuted ? 0 : 1);
  // Autoplay may be blocked before the user's first interaction — ignore.
  audio.play().catch(() => undefined);
}

/** A character's dice overrides read straight off their sheet — the fallback
 *  for rolls posted before the look started riding along with them. */
function sheetLook(sheet: SheetData | undefined): DiceLook | null {
  if (!sheet) return null;
  const pick = (k: string) => (typeof sheet[k] === 'string' && (sheet[k] as string).trim() ? sheet[k] as string : undefined);
  const look: DiceLook = {};
  const trait = pick('diceTraitColor'); if (trait) look.trait = trait;
  const wild = pick('diceWildColor'); if (wild) look.wild = wild;
  const traitText = pick('diceTraitTextColor'); if (traitText) look.traitText = traitText;
  const wildText = pick('diceWildTextColor'); if (wildText) look.wildText = wildText;
  const ace = pick('diceAceStyle'); if (ace && isAceStyle(ace)) look.ace = ace;
  return Object.keys(look).length > 0 ? look : null;
}

export function DiceOverlay() {
  const anim = useGameStore((s) => s.diceAnim);
  const ending = useGameStore((s) => s.diceAnimEnding);
  const members = useGameStore((s) => s.members);
  const characters = useGameStore((s) => s.characters);
  const system = useGameStore((s) => s.campaign?.system);
  if (!anim) return null;
  const member = anim.byUserId ? members.find((m) => m.userId === anim.byUserId) : undefined;
  /**
   * The character's own look, where they have one.
   *
   * Somebody running four characters throws the same dice for all of them,
   * and from the felt alone the table cannot tell whose roll is in the air.
   * A sheet may say otherwise field by field — anything it leaves blank falls
   * straight through to the roller's own settings, so an untouched sheet
   * behaves exactly as it always did.
   */
  const look = anim.look
    // Older messages predate the look riding along; fall back to the sheet,
    // which every DM has and which is right for their own rolls.
    ?? (anim.characterId ? sheetLook(characters.find((c) => c.id === anim.characterId)?.sheet) : null);
  const own = (key: keyof NonNullable<typeof look>): string | null => {
    const v = look?.[key];
    return typeof v === 'string' && v.trim() ? v : null;
  };
  const color = member?.diceColor ?? null;
  const textColor = member?.diceTextColor ?? null;
  // Only SWADE distinguishes trait / Wild Die / raise; every other system keeps
  // the by-size colors and the single-color override.
  const palette: DicePalette | null = system === 'swade'
    ? {
      trait: own('trait') ?? member?.diceTraitColor ?? DICE_ROLE_DEFAULTS.trait,
      wild: own('wild') ?? member?.diceWildColor ?? DICE_ROLE_DEFAULTS.wild,
      raise: member?.diceRaiseColor ?? DICE_ROLE_DEFAULTS.raise,
      traitText: own('traitText') ?? member?.diceTextColor ?? null,
      wildText: own('wildText') ?? member?.diceTextColor ?? null,
    }
    : null;
  const aceStyle = look?.ace ?? member?.diceAceStyle ?? ACE_STYLE_DEFAULT;
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
      // The ROLLER's setting, not the watcher's — same as their dice colors,
      // so a player's throw looks the same on every screen at the table.
      bouncePct={member?.diceBouncePct ?? DICE_BOUNCE_PCT_DEFAULT}
      aceStyle={aceStyle}
    />
  );
}
