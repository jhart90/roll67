/**
 * The Flash ace animation, borrowed for the map: a golden halo pulsing around
 * a piece. Worn by whatever the pointer is over in the World pane, so running
 * the mouse down that list answers "where is this actually placed?" without
 * clicking through everything.
 *
 * Two circles rather than a radial gradient — a gradient needs a <defs> entry,
 * and this renders once per hovered piece, not once per map.
 */
export function FlashHalo({ r }: { r: number }) {
  return (
    <g className="map-flash">
      <circle r={r * 1.6} fill="#ffba3c" opacity={0.2} />
      <circle r={r * 1.2} fill="none" stroke="#ffe28a" strokeWidth={3} />
    </g>
  );
}
