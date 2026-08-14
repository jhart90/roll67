import { useEffect, useState } from 'react';

/** Gap left between a floating banner and whatever is above it. */
export const TOP_GAP = 8;

/**
 * How far down the screen a floating banner has to start: under the top bar,
 * and under the counter dock when the DM has one up.
 *
 * Measured rather than guessed, for the same reason the counters measure the
 * chrome beneath them — "however many counters are up" has no constant, and a
 * banner parked at a fixed offset ends up sitting on top of them.
 *
 * `below` names elements this banner must ALSO clear (the turn guide, for the
 * roll callout that sits under it), so the stack orders itself without any
 * one of them knowing the others' heights.
 */
export function useTopChrome(below: string[] = []): number {
  const [top, setTop] = useState(TOP_GAP);
  useEffect(() => {
    const measure = () => {
      // These banners are positioned against the whole screen shell, which
      // starts ABOVE the top bar — so everything is measured in viewport
      // terms and turned back into an offset from the shell at the end.
      const shell = document.querySelector('.table-shell');
      const pane = document.querySelector('.table-main');
      if (!shell || !pane) { setTop(TOP_GAP); return; }
      const shellTop = shell.getBoundingClientRect().top;
      let y = pane.getBoundingClientRect().top;   // just under the top bar
      for (const sel of ['.counters-top', ...below]) {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        if (r && r.height > 0) y = Math.max(y, r.bottom);
      }
      setTop(Math.max(TOP_GAP, y - shellTop + TOP_GAP));
    };
    measure();
    window.addEventListener('resize', measure);
    // Re-measure whenever anything above changes size: a counter appearing,
    // the guide growing a third lane, the top bar wrapping.
    const ro = new ResizeObserver(measure);
    for (const sel of ['.counters-top', '.table-main', ...below]) {
      const el = document.querySelector(sel);
      if (el) ro.observe(el);
    }
    return () => { window.removeEventListener('resize', measure); ro.disconnect(); };
  });
  return top;
}
