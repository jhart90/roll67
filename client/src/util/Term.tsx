import { useState, type ReactNode } from 'react';

/**
 * A rules term with a hover/focus tooltip carrying its full description.
 * The tip is position:fixed (anchored from the term's rect) so it never
 * gets clipped by the wizard panels' overflow scrolling. Renders children
 * unadorned when no description is available — callers can wrap everything
 * and let unknown terms degrade to plain text.
 */
export function Term({ desc, children }: { desc?: string | null; children: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  if (!desc) return <>{children}</>;
  return (
    <span
      className="term"
      tabIndex={0}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        // Flip below the term when it sits near the top of the viewport.
        const below = r.top < 120;
        setPos({
          x: Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170),
          y: below ? r.bottom + 8 : r.top - 8,
          below,
        });
      }}
      onMouseLeave={() => setPos(null)}
      onFocus={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const below = r.top < 120;
        setPos({
          x: Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170),
          y: below ? r.bottom + 8 : r.top - 8,
          below,
        });
      }}
      onBlur={() => setPos(null)}
    >
      {children}
      {pos && (
        <span
          className={`term-tip ${pos.below ? 'below' : ''}`}
          role="tooltip"
          style={{ left: pos.x, top: pos.y }}
        >
          {desc}
        </span>
      )}
    </span>
  );
}
