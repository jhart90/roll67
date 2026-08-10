/**
 * The app's one swatch palette, ordered as a colour wheel with the neutrals
 * leading it: white → grey → black, then hue climbing steadily left-to-right
 * and down — pink (330°) → red → coral → brown → orange → yellow → lime →
 * green → teal → cyan → light blue → deep blue → purple (285°), closing back
 * round to the pink it opened with.
 *
 * Brown sits between coral and orange because at hue 22° that is where it
 * falls: it is a dark, desaturated orange, not a category of its own. Each of
 * orange, teal and blue carries a light/dark pair so "light blue near dark
 * blue" is a real relationship rather than two arbitrary blues.
 *
 * Black is a near-black rather than #000 — a pure-black swatch reads as a hole
 * in the panel instead of a colour.
 *
 * Shared by the pinned-pill picker and the player-colour picker so the two
 * cannot drift into two different ideas of "the colours".
 */
export const WHEEL_COLORS = [
  // neutrals ─────────────  warm ───────────────────────────────────
  '#ffffff', '#8a93a6', '#14171d', '#ff7fbf', '#d26c6c', '#e35c3c', '#a97455', '#d2a56c',
  // cool ────────────────────────────────────────────────────────────
  '#d2d26c', '#9ccc4f', '#7ed28a', '#6cd2c8', '#3fc2cf', '#6c9bd2', '#3f5bbf', '#b06cd2',
];

/** How many leading entries are neutrals — auto-assignment skips them, since a
 *  new item arriving white, then grey, then BLACK reads as broken rather than
 *  as a colour scheme. Picking one by hand is of course still allowed. */
export const WHEEL_NEUTRALS = 3;
