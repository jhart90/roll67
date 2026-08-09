import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useWindowManager, type WindowInstance } from '../store/windowManager';

const DEFAULT_POPUP_FEATURES = 'width=720,height=640';
// Compact windows get a compact popup — the soundboard is a small pad grid.
const POPUP_FEATURES_BY_KIND: Partial<Record<WindowInstance['kind'], string>> = {
  soundboard: 'width=360,height=320',
};

/** Generic draggable/poppable chrome wrapping one window instance's content. */
export function WindowFrame({ win, children }: { win: WindowInstance; children: ReactNode }) {
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [popup, setPopup] = useState<Window | null>(null);

  useEffect(() => {
    if (!win.poppedOut) return;
    const w = window.open('', '', POPUP_FEATURES_BY_KIND[win.kind] ?? DEFAULT_POPUP_FEATURES);
    if (!w) {
      // Popup blocked — fall back to staying docked instead of vanishing silently.
      useWindowManager.getState().popIn(win.id);
      return;
    }
    // Normalize the about:blank document (Safari in particular can hand back
    // a quirks-mode shell whose layout is off until a real doctype is written).
    const doc = w.document;
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>');
    doc.close();
    doc.title = win.title;
    // Any relative URL inside the popup (images, fonts pulled by CSS) must
    // resolve against the app origin, not about:blank.
    const base = doc.createElement('base');
    base.href = document.baseURI;
    doc.head.appendChild(base);
    // Stylesheets: rebuild rather than cloneNode. A cloned production
    // <link href="/assets/….css"> keeps its RELATIVE href, which cannot
    // resolve from about:blank — Safari renders the popup completely
    // unstyled. The DOM's resolved `.href` property is absolute, so use it.
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((node) => {
      const l = doc.createElement('link');
      l.rel = 'stylesheet';
      l.href = node.href;
      doc.head.appendChild(l);
    });
    document.querySelectorAll('style').forEach((node) => {
      const s = doc.createElement('style');
      s.textContent = node.textContent;
      doc.head.appendChild(s);
    });
    // Theme classes + a solid background so nothing flashes white while the
    // stylesheet streams in.
    doc.documentElement.className = document.documentElement.className;
    doc.body.className = document.body.className;
    doc.body.style.margin = '0';
    const cs = getComputedStyle(document.body);
    doc.body.style.background = cs.backgroundColor;
    doc.body.style.color = cs.color;
    setPopup(w);
    const onUnload = () => useWindowManager.getState().popIn(win.id);
    // Safari fires pagehide more reliably than beforeunload for closed popups.
    w.addEventListener('beforeunload', onUnload);
    w.addEventListener('pagehide', onUnload);
    return () => {
      w.removeEventListener('beforeunload', onUnload);
      w.removeEventListener('pagehide', onUnload);
      setPopup(null);
      w.close();
    };
    // Re-run only when this window's popped state changes, not on every prop/title tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.poppedOut, win.id]);

  function startDrag(e: ReactPointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    // A centered window has no meaningful stored x/y — pick the drag up from
    // where the frame actually sits (the first move pins it there).
    const rect = win.centered
      ? (e.currentTarget as HTMLElement).closest('.win-frame')?.getBoundingClientRect()
      : null;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      originX: rect ? rect.left : win.x, originY: rect ? rect.top : win.y,
    };
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

  // Centered mode (DM-pushed handouts): the midpoint of the map pane — the
  // viewport minus the left toolbar (61px) and the right UI panel (308px) —
  // until the user drags the window somewhere on purpose.
  const style = win.centered
    ? { left: 'calc(61px + (100vw - 61px - 308px) / 2)', top: '50vh', transform: 'translate(-50%, -50%)', zIndex: win.z }
    : { left: win.x, top: win.y, zIndex: win.z };

  return (
    <div
      className="win-frame"
      style={style}
      onPointerDownCapture={() => useWindowManager.getState().focusWindow(win.id)}
    >
      {bar}
      <div className="win-frame-body">{children}</div>
    </div>
  );
}
