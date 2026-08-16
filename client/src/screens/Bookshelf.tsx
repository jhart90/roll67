import { useEffect, useState, type ReactNode } from 'react';

/**
 * The lobby's bookshelf.
 *
 * The whole front door is one painting — a shelf of eleven great tomes over a
 * summoning circle — and the interface is laid ONTO the painting: each
 * campaign lives in one of the books, its name lettered down the spine, and
 * the sign-in card floats over the portal on the desk.
 *
 * The one real problem this file solves is registration. The art fills the
 * window like `background-size: cover`, which crops differently at every
 * aspect ratio — so nothing positioned against the VIEWPORT can stay on a
 * book. Instead a canvas div is kept at exactly the image's aspect, scaled
 * and centred by the same math cover uses, and every hotspot is positioned in
 * percentages OF THE IMAGE. Wherever the crop falls, 8.2% of the canvas is
 * the same leather it was in the painting.
 */

/** The source painting's pixel size — the coordinate space the slots use. */
export const SHELF_W = 1448;
export const SHELF_H = 1086;

/**
 * The eleven books, measured off the painting: left/width/top as percentages
 * of the image, and each spine's sigil so a tooltip can call the book
 * something. Bottoms all land on the shelf (~60.5%).
 */
export interface BookSlot {
  left: number;
  width: number;
  top: number;
  sigil: string;
}
export const BOOK_SLOTS: BookSlot[] = [
  { left: 6.6, width: 7.9, top: 20.8, sigil: '⚔️' },
  { left: 14.9, width: 7.3, top: 25.0, sigil: '🤠' },
  { left: 22.9, width: 8.7, top: 22.8, sigil: '🔍' },
  { left: 32.2, width: 8.4, top: 18.8, sigil: '🏛️' },
  { left: 41.0, width: 6.7, top: 25.4, sigil: '🐉' },
  { left: 47.8, width: 7.1, top: 24.0, sigil: '🪐' },
  { left: 55.3, width: 7.4, top: 22.9, sigil: '⭐' },
  { left: 63.1, width: 8.2, top: 25.4, sigil: '🐙' },
  { left: 71.9, width: 7.0, top: 21.2, sigil: '🔌' },
  { left: 79.4, width: 7.1, top: 27.2, sigil: '☣️' },
  { left: 86.8, width: 7.3, top: 24.9, sigil: '🔫' },
];
export const BOOK_BOTTOM = 60.5;

/**
 * Replicate cover's crop: the canvas is the image's aspect, scaled so it
 * covers the viewport, centred so the overflow splits evenly. Everything
 * inside is positioned in image percentages and simply comes along.
 */
function useCoverBox(): { width: number; height: number; left: number; top: number } {
  const compute = () => {
    const scale = Math.max(window.innerWidth / SHELF_W, window.innerHeight / SHELF_H);
    const width = SHELF_W * scale;
    const height = SHELF_H * scale;
    return { width, height, left: (window.innerWidth - width) / 2, top: (window.innerHeight - height) / 2 };
  };
  const [box, setBox] = useState(compute);
  useEffect(() => {
    const on = () => setBox(compute());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return box;
}

/**
 * The stage: painting behind, children registered to it.
 *
 * `--su` is the shelf unit — how many screen pixels one image pixel currently
 * occupies — so type set in image-space (a spine's lettering) scales with the
 * painting instead of with the viewport.
 */
export function ShelfStage({ children, overlay }: { children?: ReactNode; overlay?: ReactNode }) {
  const box = useCoverBox();
  return (
    <div className="shelf-screen">
      <div
        className="shelf-canvas"
        style={{
          width: box.width, height: box.height, left: box.left, top: box.top,
          ['--su' as never]: `${box.width / SHELF_W}`,
        }}
      >
        {children}
      </div>
      {overlay}
    </div>
  );
}
