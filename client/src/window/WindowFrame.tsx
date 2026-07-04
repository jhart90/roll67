import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useWindowManager, type WindowInstance } from '../store/windowManager';

const POPUP_FEATURES = 'width=720,height=640';

/** Generic draggable/poppable chrome wrapping one window instance's content. */
export function WindowFrame({ win, children }: { win: WindowInstance; children: ReactNode }) {
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [popup, setPopup] = useState<Window | null>(null);

  useEffect(() => {
    if (!win.poppedOut) return;
    const w = window.open('', '', POPUP_FEATURES);
    if (!w) {
      // Popup blocked — fall back to staying docked instead of vanishing silently.
      useWindowManager.getState().popIn(win.id);
      return;
    }
    w.document.title = win.title;
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      w.document.head.appendChild(node.cloneNode(true));
    });
    w.document.body.style.margin = '0';
    setPopup(w);
    const onUnload = () => useWindowManager.getState().popIn(win.id);
    w.addEventListener('beforeunload', onUnload);
    return () => {
      w.removeEventListener('beforeunload', onUnload);
      setPopup(null);
      w.close();
    };
    // Re-run only when this window's popped state changes, not on every prop/title tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.poppedOut, win.id]);

  function startDrag(e: ReactPointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: win.x, originY: win.y };
    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      useWindowManager.getState().moveWindow(
        win.id,
        Math.max(0, drag.originX + (ev.clientX - drag.startX)),
        Math.max(0, drag.originY + (ev.clientY - drag.startY)),
      );
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const bar = (
    <div className={`win-frame-bar ${win.poppedOut ? 'win-frame-bar-popped' : ''}`} onPointerDown={win.poppedOut ? undefined : startDrag}>
      <span className="win-frame-title">{win.title}</span>
      <span className="spacer" />
      <button
        className="link"
        title={win.poppedOut ? 'Bring back into the main window' : 'Pop out to its own window'}
        onClick={() => (win.poppedOut ? useWindowManager.getState().popIn(win.id) : useWindowManager.getState().popOut(win.id))}
      >
        {win.poppedOut ? '⧉ pop in' : '⧉ pop out'}
      </button>
      <button className="link" onClick={() => useWindowManager.getState().closeWindow(win.id)}>✕</button>
    </div>
  );

  if (win.poppedOut) {
    if (!popup) return null;
    return createPortal(
      <>
        {bar}
        <div className="win-frame-body win-frame-body-popped">{children}</div>
      </>,
      popup.document.body,
    );
  }

  return (
    <div
      className="win-frame"
      style={{ left: win.x, top: win.y, zIndex: win.z }}
      onPointerDownCapture={() => useWindowManager.getState().focusWindow(win.id)}
    >
      {bar}
      <div className="win-frame-body">{children}</div>
    </div>
  );
}
