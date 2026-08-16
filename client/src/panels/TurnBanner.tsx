import { useGameStore } from '../store/game';
import { playerColorFor } from '../util/playerColor';

/**
 * Whose turn it is, over the map. Deliberately loud — at a table the single
 * most-asked question is "wait, whose go is it?".
 */
/**
 * Black or white for the BAR, whichever actually contrasts more.
 *
 * `readableOn` flips at a tuned luminance (0.40 rather than the true ~0.18
 * crossover) because white looks better than the raw ratio suggests on a
 * saturated mid-tone token. A token shows a name; this bar carries a link, a
 * label, a dropdown and the loudest text on screen, and at that threshold a
 * mid tan gets white ink at 2.33:1 — legible in a screenshot, not across a
 * table. Here the ratio decides, which is never worse than 4.58:1.
 */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The app's near-black, not pure black — so the comparison has to use its
 *  real luminance rather than assume zero, or it picks wrong near the flip. */
const BAR_INK_DARK = '#10131a';
function barInkOn(bg: string): string {
  const l = luminance(bg);
  const contrast = (ink: number) => (Math.max(l, ink) + 0.05) / (Math.min(l, ink) + 0.05);
  return contrast(luminance(BAR_INK_DARK)) >= contrast(1) ? BAR_INK_DARK : '#ffffff';
}

/**
 * The color the top bar wears while someone is up, plus the text color that
 * stays legible on it. Exported so the bar itself can take the fill — the
 * banner alone is a small target, and the whole bar changing color is
 * impossible to miss from across a table.
 *
 * `chip` and `edge` are what the bar's own BUTTONS wear. They cannot keep
 * their usual dark fill: the ink is picked to read against the bar, so under
 * a pale player color it turns black, and black on a dark chip is the one
 * combination that disappears entirely. Instead each control gets a scrim of
 * the bar — lifted toward white beneath dark ink, pushed toward black beneath
 * white ink. Being a move directly AWAY from the ink, it can only ever add
 * contrast, whatever color the player chose.
 */
export function useTurnTint(): { bg: string; fg: string; chip: string; chipHi: string; edge: string } | null {
  const state = useGameStore((s) => s.initiativeState);
  const members = useGameStore((s) => s.members);
  if (!state.active || state.entries.length === 0) return null;
  const current = state.entries[state.turnIdx];
  if (!current) return null;
  const member = current.ownerUserId ? members.find((m) => m.userId === current.ownerUserId) : undefined;
  // A player's combatant wears their color; a DM-run one wears its own token
  // color, so a fight full of NPCs still changes hue turn to turn instead of
  // sitting on one anonymous grey. Grey only survives as a last resort.
  const bg = member ? playerColorFor(member) : (current.color || '#3a3f4d');
  const fg = barInkOn(bg);
  const darkInk = fg !== '#ffffff';
  return {
    bg,
    fg,
    chip: darkInk ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.34)',
    chipHi: darkInk ? 'rgba(255, 255, 255, 0.66)' : 'rgba(0, 0, 0, 0.52)',
    edge: darkInk ? 'rgba(0, 0, 0, 0.32)' : 'rgba(255, 255, 255, 0.38)',
  };
}

export function TurnBanner() {
  const state = useGameStore((s) => s.initiativeState);
  const tint = useTurnTint();
  if (!tint || !state.active) return null;
  const current = state.entries[state.turnIdx];
  if (!current) return null;
  return (
    <div className="turn-banner" style={{ color: tint.fg }}>
      <strong>Round {state.round}: {current.name}’s Turn</strong>
      <span className="turn-banner-sub">
        {current.ownerName ? `(controlled by ${current.ownerName})` : '(controlled by the DM)'}
      </span>
    </div>
  );
}
