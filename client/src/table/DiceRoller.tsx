import { intents, useGameStore } from '../store/game';
import { openWindow } from '../store/windowManager';
import { DieShape } from './DiceShapes';
import { DICE_ROLE_DEFAULTS } from './dice3d';
import { ACE_STYLES, ACE_STYLE_DEFAULT, DICE_BOUNCE_PCT_DEFAULT, type AceStyle, type DiceRole } from 'shared';

const DICE_TYPES = [2, 4, 6, 8, 10, 12, 20, 100];
const COUNTS = [1, 2, 3, 4, 5, 6];

// Swatch offers match the new bold defaults: starburst brights plus white
// and near-black for anyone who wants a quiet die anyway.
const DICE_PALETTE = [
  '#ff3d57', '#ff8a00', '#ffe234', '#2fe04a', '#00e5d0',
  '#0aa8ff', '#b444ff', '#ff4fa3', '#ffffff', '#14171d',
];

const TEXT_PALETTE = ['#10131a', '#f4f6fb', '#ffe08a', '#ff6b6b', '#7ee89a', '#6cd2c8'];

/** Pick the color everyone sees when your 3D dice roll across the table. */
export function DiceColorPicker() {
  const you = useGameStore((s) => s.you);
  const members = useGameStore((s) => s.members);
  const current = you ? members.find((m) => m.userId === you.userId)?.diceColor ?? null : null;

  return (
    <div className="dice-color-row">
      <span className="dim" style={{ fontSize: 11 }}>Your dice:</span>
      <button
        className={`link ${current === null ? 'active' : ''}`}
        style={{ fontSize: 11 }}
        title="Use the per-die default colors"
        onClick={() => intents.setDiceColor(null)}
      >
        default
      </button>
      {DICE_PALETTE.map((c) => (
        <button
          key={c}
          className={`dice-color-swatch ${current === c ? 'active' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => intents.setDiceColor(c)}
        />
      ))}
      <input
        type="color"
        className="dice-color-custom"
        value={current ?? '#6c9bd2'}
        title="Custom color"
        onChange={(e) => intents.setDiceColor(e.target.value)}
      />
    </div>
  );
}

/** Pick the color of the pips/numbers painted on your own dice. */
export function DiceTextColorPicker() {
  const you = useGameStore((s) => s.you);
  const members = useGameStore((s) => s.members);
  const current = you ? members.find((m) => m.userId === you.userId)?.diceTextColor ?? null : null;

  return (
    <div className="dice-color-row">
      <span className="dim" style={{ fontSize: 11 }}>Your dice text:</span>
      <button
        className={`link ${current === null ? 'active' : ''}`}
        style={{ fontSize: 11 }}
        title="Automatic (dark on light dice, light on dark dice)"
        onClick={() => intents.setDiceTextColor(null)}
      >
        auto
      </button>
      {TEXT_PALETTE.map((c) => (
        <button
          key={c}
          className={`dice-color-swatch ${current === c ? 'active' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => intents.setDiceTextColor(c)}
        />
      ))}
      <input
        type="color"
        className="dice-color-custom"
        value={current ?? '#10131a'}
        title="Custom color"
        onChange={(e) => intents.setDiceTextColor(e.target.value)}
      />
    </div>
  );
}

/**
 * SWADE colours dice by their role in the roll — trait die, Wild Die, and the
 * bonus die a raise earns — so each gets its own slot. Shown only for SWADE;
 * every other system uses the single-colour picker above.
 */
const DICE_ROLES: Array<{ role: DiceRole; label: string; hint: string }> = [
  { role: 'trait', label: 'Trait', hint: 'Your skill or attribute die' },
  { role: 'wild', label: 'Wild', hint: 'The d6 Wild Die a Wild Card rolls alongside it' },
];

export function SwadeDicePalettePicker() {
  const you = useGameStore((s) => s.you);
  const members = useGameStore((s) => s.members);
  const me = you ? members.find((m) => m.userId === you.userId) : undefined;
  const currentOf = (role: DiceRole): string | null =>
    role === 'trait' ? me?.diceTraitColor ?? null
      : role === 'wild' ? me?.diceWildColor ?? null
        : me?.diceRaiseColor ?? null;

  return (
    <>
      {DICE_ROLES.map(({ role, label, hint }) => {
        const current = currentOf(role);
        return (
          <div className="dice-color-row" key={role}>
            <span className="dim" style={{ fontSize: 11 }} title={hint}>{label} dice:</span>
            <button
              className={`link ${current === null ? 'active' : ''}`}
              style={{ fontSize: 11 }}
              title={`Use the default ${label.toLowerCase()} colour (${DICE_ROLE_DEFAULTS[role]})`}
              onClick={() => intents.setDiceRoleColor(role, null)}
            >
              default
            </button>
            {DICE_PALETTE.map((c) => (
              <button
                key={c}
                className={`dice-color-swatch ${current === c ? 'active' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => intents.setDiceRoleColor(role, c)}
              />
            ))}
            <input
              type="color"
              className="dice-color-custom"
              value={current ?? DICE_ROLE_DEFAULTS[role]}
              title={`Custom ${label.toLowerCase()} colour`}
              onChange={(e) => intents.setDiceRoleColor(role, e.target.value)}
            />
          </div>
        );
      })}
    </>
  );
}

/**
 * How often YOUR dice carom off a wall on their way in. Saved to the account
 * and sent with presence, so it follows your rolls to every screen at the
 * table rather than being how you happen to like watching other people's.
 */
export function DiceBouncePicker() {
  const you = useGameStore((s) => s.you);
  const members = useGameStore((s) => s.members);
  const me = you ? members.find((m) => m.userId === you.userId) : undefined;
  const pct = me?.diceBouncePct ?? DICE_BOUNCE_PCT_DEFAULT;
  return (
    <div className="dice-color-row">
      <span className="dim" style={{ fontSize: 11 }} title="Share of your dice that ricochet off the edge of the map before settling">
        Bounce:
      </span>
      <input
        type="range"
        className="dice-bounce-slider"
        min={0}
        max={100}
        step={1}
        value={pct}
        title={`${pct}% of your dice bounce off a wall`}
        onChange={(e) => intents.setDiceBounce(Number(e.target.value))}
      />
      <span className="dice-bounce-val">{pct}%</span>
      <button
        className={`link ${me?.diceBouncePct == null ? 'active' : ''}`}
        style={{ fontSize: 11 }}
        title={`Back to the default (${DICE_BOUNCE_PCT_DEFAULT}%)`}
        onClick={() => intents.setDiceBounce(null)}
      >
        default
      </button>
    </div>
  );
}

/** What each ace style looks like, for the dropdown's own hint line. */
const ACE_STYLE_LABELS: Record<AceStyle, string> = {
  flash: 'Flash — a golden halo and sparks (the classic)',
  explosion: 'Explosion — a shockwave ring and flying debris',
  flames: 'Flames — tongues of fire and drifting embers',
  disco: 'Disco — sweeping coloured beams and glitter',
  rainbow: 'Rainbow — a seven-colour arc encircling the die',
  smoke: 'Smoke — grey puffs billowing up and thinning out',
  water: 'Water — a splash crown, spreading ripples and falling droplets',
};

/**
 * How YOUR aced dice celebrate. Saved to the account and sent with presence
 * like the colours and the bounce, so an ace looks the same on every screen at
 * the table rather than however each watcher happens to like other people's.
 */
export function DiceAceStylePicker() {
  const you = useGameStore((s) => s.you);
  const members = useGameStore((s) => s.members);
  const me = you ? members.find((m) => m.userId === you.userId) : undefined;
  const current = me?.diceAceStyle ?? ACE_STYLE_DEFAULT;
  return (
    <div className="dice-color-row">
      <span className="dim" style={{ fontSize: 11 }} title="Exploding dice — how yours announce themselves when they ace">
        Aces:
      </span>
      <select
        className="dice-ace-select"
        value={current}
        title={ACE_STYLE_LABELS[current]}
        onChange={(e) => intents.setDiceAceStyle(e.target.value as AceStyle)}
      >
        {ACE_STYLES.map((s) => (
          <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
        ))}
      </select>
      <span className="dim dice-ace-hint">{ACE_STYLE_LABELS[current]}</span>
    </div>
  );
}

/** Quick-roll panel: click to roll 1-6 dice of any standard type. */
export function DiceRoller({ onClose }: { onClose: () => void }) {
  const isSwade = useGameStore((s) => s.campaign?.system) === 'swade';
  return (
    <div className="dice-panel">
      <div className="dock-header">
        <h3>Roll dice</h3>
        <button
          className="link"
          title="Lifetime roll statistics for everyone in this campaign"
          onClick={() => openWindow('rollStats', 'main', {}, 'Roll Stats')}
        >
          📊 stats
        </button>
        <button
          className="link iron-footer"
          title="Provably-fair rolling: server-side, cryptographically random, verifiable"
          onClick={() => openWindow('ironDice', 'main', {}, 'IronDice')}
        >
          🛡 IronDice
        </button>
        <button className="link" onClick={onClose}>close</button>
      </div>
      <table className="dice-grid">
        <tbody>
          {DICE_TYPES.map((sides) => (
            <tr key={sides}>
              <td className="dice-type">
                <button
                  className="dice-type-btn"
                  title={`Roll 1d${sides}`}
                  onClick={() => intents.chat(`/r 1d${sides}`)}
                >
                  <DieShape sides={sides} size={26} />
                  <span>D{sides}</span>
                </button>
              </td>
              {COUNTS.map((n) => (
                <td key={n}>
                  <button
                    className="dice-count-btn"
                    title={`Roll ${n}d${sides}`}
                    onClick={() => intents.chat(`/r ${n}d${sides}`)}
                  >
                    {n}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {isSwade ? <SwadeDicePalettePicker /> : (
        <>
          <DiceColorPicker />
          <DiceTextColorPicker />
        </>
      )}
      <DiceBouncePicker />
      <DiceAceStylePicker />
      <p className="dim" style={{ fontSize: 11, margin: '6px 0 0' }}>
        Rolls go to chat for everyone. Use /r in chat for modifiers (e.g. /r 2d6+3).
      </p>
    </div>
  );
}
