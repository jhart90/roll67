import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A pop-up anchored at a click point that always lands fully on screen.
 *
 * Menus positioned straight at the cursor run off the bottom or right edge —
 * the counters along the bottom of the table were the worst case, where most
 * of the menu was unreachable. This measures itself after rendering and flips
 * back inside, preferring to open upward/leftward from the click (the usual
 * desktop behaviour), and only clamping to the edge when even that won't fit.
 */
export function AnchoredMenu({
  x, y, className, margin = 8, onClick, onMouseLeave, children,
}: {
  x: number;
  y: number;
  className?: string;
  margin?: number;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = y;
    if (y + height + margin > vh) top = y - height;          // open upward
    if (top < margin) top = Math.max(margin, vh - height - margin);

    let left = x;
    if (x + width + margin > vw) left = x - width;           // open leftward
    if (left < margin) left = Math.max(margin, vw - width - margin);

    setPos({ left, top });
  }, [x, y, margin, children]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ left: pos.left, top: pos.top, maxHeight: `calc(100vh - ${margin * 2}px)`, overflowY: 'auto' }}
      onClick={onClick}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
}
