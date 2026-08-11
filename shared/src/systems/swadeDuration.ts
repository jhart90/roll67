/**
 * SWADE power durations.
 *
 * The book prints one DUR column covering four different things: a count of
 * rounds ("5"), a wall-clock span ("10m", "1H"), an effect that resolves the
 * moment it lands ("Instant"), and a handful the text defines on its own
 * ("Special"). Only the first of those maps onto the initiative loop, so only
 * the first is clocked here — the rest are carried as text so the sheet and
 * the compendium can show what the book says without pretending to track it.
 *
 * Rounds are also the bucket that matters: thirty-one of the book's powers sit
 * at "5", each costing a Power Point per round to hold open.
 */

/** Rounds a power lasts, or undefined when it isn't measured in rounds. */
export function durationRounds(duration: string | undefined): number | undefined {
  if (!duration) return undefined;
  // "5 / 1H" (Detect/Conceal Arcana) — the round-based half leads.
  const head = duration.split('/')[0]!.trim();
  if (!/^\d+$/.test(head)) return undefined;
  const n = Number(head);
  return n > 0 ? n : undefined;
}

/** True when holding this power open costs a Power Point each round. */
export function isMaintained(duration: string | undefined): boolean {
  return durationRounds(duration) !== undefined;
}

/** The DUR column spelled out, for tooltips and cards. */
export function durationLabel(duration: string | undefined): string {
  if (!duration) return '';
  const rounds = durationRounds(duration);
  if (rounds !== undefined) {
    const rest = duration.includes('/') ? duration.slice(duration.indexOf('/') + 1).trim() : '';
    const head = `${rounds} round${rounds === 1 ? '' : 's'}`;
    return rest ? `${head} / ${durationLabel(rest)}` : head;
  }
  const m = /^(\d+)\s*([mhH])$/.exec(duration.trim());
  if (m) {
    const n = Number(m[1]);
    const unit = m[2]!.toLowerCase() === 'h' ? 'hour' : 'minute';
    return `${n} ${unit}${n === 1 ? '' : 's'}`;
  }
  return duration;
}

/** One power running on a character, counting down. */
export interface ActivePower {
  name: string;
  /** Rounds still to run, including the current one. */
  rounds: number;
  /** Power Points to hold it open for another round. */
  upkeep: number;
}

/** The four self-buffs whose sheet toggle mirrors a running power. */
export const MAINTAINED_TOGGLES: Record<string, string> = {
  Armor: 'armorActive',
  Protection: 'protectionActive',
  Deflection: 'deflectionActive',
  Smite: 'smiteActive',
};

/** The sheet toggle a power drives, if it drives one. */
export function toggleFor(name: string): string | undefined {
  return MAINTAINED_TOGGLES[name.trim()];
}

/**
 * One round passes for the caster. Returns the powers still running and the
 * ones that just ran out — the caller posts the expiry lines and clears any
 * sheet toggles the expired powers were driving.
 */
export function tickPowers(active: readonly ActivePower[]): {
  running: ActivePower[];
  expired: ActivePower[];
} {
  const running: ActivePower[] = [];
  const expired: ActivePower[] = [];
  for (const p of active) {
    const rounds = p.rounds - 1;
    if (rounds > 0) running.push({ ...p, rounds });
    else expired.push({ ...p, rounds: 0 });
  }
  return { running, expired };
}
