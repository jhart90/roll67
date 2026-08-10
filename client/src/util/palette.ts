/**
 * The app's one swatch palette, ordered as a colour wheel with the neutrals
 * leading it: white → grey → black, then hue climbing steadily left-to-right
 * and down — pink (330°) → red → coral → orange → amber → yellow → lime →
 * green → teal → cyan → light blue → deep blue → purple (280°), closing back
 * round to the pink it opened with.
 *
 * There is no brown, and only two greens. The warm arc used to spend three of
 * its slots on brown, tan and olive — colours that read as three shades of mud
 * on a dark panel — while having no true orange and no true yellow at all.
 * Those slots are orange (34°), amber (42°) and yellow (52°) now, and the
 * greens went from three to two by dropping the palest.
 *
 * Black is a near-black rather than #000 — a pure-black swatch reads as a hole
 * in the panel instead of a colour.
 *
 * Shared by the pinned-pill picker and the player-colour picker so the two
 * cannot drift into two different ideas of "the colours".
 */
export const WHEEL_COLORS = [
  // neutrals ───────────────  warm: red → orange → yellow ──────────
  '#ffffff', '#8a93a6', '#14171d', '#ff7fbf', '#d94b4b', '#e35c3c', '#f2900d', '#f0b429',
  // cool: yellow → green → blue → purple ────────────────────────────
  '#f5e050', '#9ccc4f', '#3fbf6a', '#6cd2c8', '#3fc2cf', '#6c9bd2', '#3f5bbf', '#b06cd2',
];

/** How many leading entries are neutrals — auto-assignment skips them, since a
 *  new item arriving white, then grey, then BLACK reads as broken rather than
 *  as a colour scheme. Picking one by hand is of course still allowed. */
export const WHEEL_NEUTRALS = 3;
