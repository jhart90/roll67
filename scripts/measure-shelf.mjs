// Where each book on the shelf starts and stops, read off the art.
//
//   node scripts/measure-shelf.mjs
//
// The highlight that lights a book on hover is a plain box, and its top and
// bottom are hand-typed percentages in Bookshelf.tsx. Typed by eye they drift:
// a box a percent high hangs in the shadow above the leather, a percent low
// eats into it, and neither is obvious until somebody hovers the book and says
// it looks wrong. This measures them instead.
//
// The signal that works is the gold cap band every book wears. Below the dark
// gap above the shelf, each column steps sharply from near-black into that
// band — the largest such step in the plausible range IS the cap, and the book
// starts a hair above it. Two things that did NOT work, recorded so they are
// not tried again: absolute brightness thresholds (one book ramps up slowly
// and trips them five percent early), and contrast against the gaps between
// books (those gaps are thinner than the slot maths implies, so neighbouring
// leather bleeds in and the answer lands mid-spine).
import sharp from 'sharp';

const IMG = 'client/public/bg/ttp-books-1920.webp';
const W = 1448;
const H = 1086;

/** left/width of each book, matching BOOK_SLOTS in client/src/screens/Bookshelf.tsx. */
const SLOTS = [
  [6.6, 7.9], [14.9, 7.3], [22.9, 8.7], [32.2, 8.4], [41.0, 6.7], [47.8, 7.1],
  [55.3, 7.4], [63.1, 8.2], [71.9, 7.0], [79.4, 7.1], [86.8, 7.3],
];
/** What is in the file now, to show what each measurement would change. */
const CURRENT = [21.0, 24.3, 21.8, 21.1, 24.3, 24.8, 22.7, 25.6, 21.1, 27.6, 25.2];
/** The sliver of dark above the cap that the box should still cover. */
const CAP_MARGIN = 0.4;

const data = await sharp(IMG).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer();

console.log('book   current      cap     measured   change');
const measured = SLOTS.map(([l, w], i) => {
  // Inset half a percent each side: the slot edges are approximate and the
  // neighbouring book's leather is brighter than the gap between them.
  const x0 = Math.round(((l + 0.5) / 100) * W);
  const x1 = Math.round(((l + w - 0.5) / 100) * W);
  const col = [];
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = x0; x < x1; x++) s += data[y * W + x];
    col.push(s / (x1 - x0));
  }
  let best = -1;
  let capY = 0;
  for (let y = Math.round(0.17 * H); y < Math.round(0.33 * H); y++) {
    const before = (col[y - 2] + col[y - 1]) / 2;
    const after = (col[y + 2] + col[y + 3]) / 2;
    // Must more than double as well as jump: a gentle ramp is a shadow, and
    // the cap is an edge.
    if (after - before > best && after > 2.2 * Math.max(before, 1)) {
      best = after - before;
      capY = y;
    }
  }
  const cap = (capY / H) * 100;
  const top = Number((cap - CAP_MARGIN).toFixed(1));
  const delta = top - CURRENT[i];
  console.log(
    String(i).padStart(3), String(CURRENT[i]).padStart(9), cap.toFixed(1).padStart(9),
    top.toFixed(1).padStart(11), `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`.padStart(9),
  );
  return top;
});

// The bottom is shared by every book, and confirmed the other way round: the
// gaps between books stay dark right down to it, and the shelf board below is
// bright enough to end the reading on its own.
const gaps = [[0.145, 0.149], [0.222, 0.229], [0.311, 0.322], [0.548, 0.553], [0.626, 0.631], [0.786, 0.794]];
const gapAt = (y) => {
  let s = 0;
  let n = 0;
  for (const [a, b] of gaps) {
    for (let x = Math.round(a * W); x < Math.round(b * W); x++) { s += data[y * W + x]; n++; }
  }
  return s / n;
};
// The FIRST brightening, not the last: below the shelf board there is shadow
// again, and a reading that runs to the last dark row lands five percent under
// the shelf rather than on it.
let bottom = Math.round(0.70 * H);
for (let y = Math.round(0.45 * H); y < Math.round(0.70 * H); y++) {
  if (gapAt(y) >= 15 && gapAt(y + 3) >= 15) { bottom = y; break; }
}
console.log('');
console.log(`tops: ${JSON.stringify(measured)}`);
console.log(`BOOK_BOTTOM: ${((bottom / H) * 100).toFixed(1)} (gaps stay dark to here)`);
