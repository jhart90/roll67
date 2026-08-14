import { hexDistance, hexToPixel, rayBlocked, sightSegments } from 'shared';
import { sightGeometry, useGameStore } from '../store/game';

/**
 * "Who is this used on?" — the picker for anything aimed at a person rather
 * than fired at one: a thrown potion, a First Aid Kit, a Healing power.
 *
 * Healing used to have no picker at all unless it came out of a bag. A power
 * fell through to the map's targeting ring, which lights up hexes and says
 * nothing, so a healer with a touch-range power saw a board where nothing was
 * clickable and no explanation of why. Every heal comes here now, whatever it
 * is carried in, and the list says who can be treated and who cannot.
 */
export function TargetPopup() {
  const targeting = useGameStore((s) => s.targeting);
  const tokens = useGameStore((s) => s.tokens);
  const characters = useGameStore((s) => s.characters);
  const system = useGameStore((s) => s.campaign?.system);
  const map = useGameStore((s) => s.map);

  const action = targeting?.action;
  const heal = action?.effect === 'heal';
  if (!targeting || !action || !map || !(heal || action.source === 'item')) return null;
  const src = tokens[targeting.sourceTokenId];
  const feetPerHex = map.grid.feetPerHex > 0 ? map.grid.feetPerHex : 5;
  const rangeHexes = action.rangeFt <= 0 ? 0 : Math.max(1, Math.ceil(action.rangeFt / feetPerHex));

  // The same walls the map's ring respects. A potion cannot be handed through
  // a door any more than a bullet can go through it, and a list that offered
  // the man on the other side would be offering an error message.
  const geo = sightGeometry();
  const segs = src && geo ? sightSegments(geo.walls, geo.doors, hexToPixel({ q: src.q, r: src.r }, map.grid)) : null;

  /** Who this token is, in the name the table calls them — the token's own
   *  name is often the player's, and "Jack (self)" is nobody's character. */
  const nameOf = (id: string | null, fallback: string) =>
    (id ? characters.find((c) => c.id === id)?.name : null) ?? fallback;

  /**
   * Wounds, read off the token rather than the sheet: nobody is sent another
   * character's sheet, and a SWADE token carries its wound slots in the bar
   * (maxHp is the wound cap, hp what is left of it).
   */
  const woundsOf = (t: { bar: { hp: number; maxHp: number } | null; characterId: string | null }) =>
    system === 'swade' && t.characterId && t.bar && t.bar.maxHp > 0 && t.bar.maxHp <= 6
      ? Math.max(0, t.bar.maxHp - t.bar.hp)
      : null;

  const candidates = Object.values(tokens)
    .filter((t) => src && t.mapId === map.id
      && hexDistance({ q: src.q, r: src.r }, { q: t.q, r: t.r }) <= rangeHexes + (t.size >= 3 ? 1 : 0)
      && !(segs && t.id !== src.id && rayBlocked(
        hexToPixel({ q: src.q, r: src.r }, map.grid), hexToPixel({ q: t.q, r: t.r }, map.grid), segs)))
    // The hurt first: a healer is looking for the person who needs them, not
    // reading an alphabetical roll-call.
    .sort((a, b) => (woundsOf(b) ?? 0) - (woundsOf(a) ?? 0));

  /** Why this one cannot be treated, or null when they can. */
  function refusal(t: (typeof candidates)[number]): string | null {
    if (action!.wildCardOnly === true && t.nameplate?.wildCard !== true) return 'an Extra';
    if (!heal) return null;
    const w = woundsOf(t);
    if (action!.healsWounds && w === 0) return 'unhurt';
    return null;
  }

  function cancel() { useGameStore.getState().cancelTargeting(); }

  const reach = action.rangeFt <= feetPerHex ? 'within arm’s reach' : `within ${action.rangeFt} ft`;
  return (
    <div className="sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="panel target-popup">
        <div className="dock-header">
          <h3>{heal ? 'Treat with' : 'Throw'} {action.label}</h3>
          <button className="link" onClick={cancel}>cancel</button>
        </div>
        <p className="dim" style={{ fontSize: 12 }}>
          {/* A SWADE heal has no amount worth printing — the roll's own margin
              is the healing, and the item's vestigial "0" said nothing. */}
          {action.healsWounds
            ? <>A <strong>Healing</strong> roll vs TN 4 — a success mends a Wound, a raise two. Choose who to treat, {reach}.</>
            : <>{heal ? 'Heals' : 'Deals'} <strong>{action.amountExpr}</strong> — choose a target {reach}.</>}
        </p>
        <ul className="target-list">
          {candidates.map((t) => {
            const why = refusal(t);
            const w = woundsOf(t);
            return (
              <li key={t.id}>
                <span className="target-name">
                  {nameOf(t.characterId, t.name)}{t.id === src?.id ? ' (self)' : ''}
                </span>
                <span className="dim">
                  {w !== null
                    ? (w > 0 ? `${w} Wound${w === 1 ? '' : 's'}` : 'unhurt')
                    : t.bar ? `${t.bar.hp}/${t.bar.maxHp} HP` : ''}
                </span>
                <span className="spacer" />
                <button
                  className="btn btn-sm btn-accent"
                  disabled={!!why}
                  title={why ? `${nameOf(t.characterId, t.name)} is ${why}` : undefined}
                  onClick={() => useGameStore.getState().resolveTarget(t.id)}
                >
                  {why ?? (heal ? 'Treat' : 'Use')}
                </button>
              </li>
            );
          })}
          {candidates.length === 0 && <li className="dim">Nobody in reach — move closer.</li>}
        </ul>
      </div>
    </div>
  );
}
