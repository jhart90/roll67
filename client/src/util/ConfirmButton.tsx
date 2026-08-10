import { useEffect, useRef, useState } from 'react';

/** How long an armed button waits before going back to its resting label. */
const ARMED_MS = 4000;

/**
 * A destructive action that asks once, in the app.
 *
 * Replaces `window.confirm()`: a native dialog steals focus, cannot be styled,
 * renders outside the window it belongs to, and on a second monitor can appear
 * somewhere the user is not even looking. This asks in place — the first click
 * arms the button and changes its label, the second commits.
 *
 * It disarms itself after a few seconds. A half-armed delete button sitting
 * there indefinitely is exactly the accident the confirmation exists to
 * prevent, just moved one click later.
 */
export function ConfirmButton({
  onConfirm, children, confirmLabel = 'Really?', className = 'link danger',
  title, disabled, style,
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  /** What the button says once armed. Should read as the question. */
  confirmLabel?: React.ReactNode;
  className?: string;
  title?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  const disarm = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setArmed(false);
  };
  // Never leave a timer pointing at an unmounted component — these buttons
  // live in menus and inspectors that close the moment the action fires.
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return (
    <button
      className={`${className} ${armed ? 'confirm-armed' : ''}`.trim()}
      title={armed ? 'Click again to confirm' : title}
      disabled={disabled}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) { disarm(); onConfirm(); return; }
        setArmed(true);
        timer.current = window.setTimeout(() => setArmed(false), ARMED_MS);
      }}
      onPointerLeave={armed ? disarm : undefined}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
