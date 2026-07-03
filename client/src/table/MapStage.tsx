import { useCallback, useEffect, useMemo, useRef } from 'react';
import { canMoveToken } from 'shared';
import { intents, useGameStore } from '../store/game';
import { mapPixelSize, StageContext, type StageApi } from '../util/stage';
import { BackgroundCanvas } from './BackgroundCanvas';
import { CombatTextLayer } from './CombatTextLayer';
import { DrawingLayer } from './DrawingLayer';
import { FogCanvas } from './FogCanvas';
import { GeometryLayer } from './GeometryLayer';
import { PingMeasureLayer } from './PingMeasureLayer';
import { TokenLayer } from './TokenLayer';

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;

/** Pan/zoom container holding every map layer, ordered bottom to top. */
export function MapStage({ children }: { children?: React.ReactNode }) {
  const map = useGameStore((s) => s.map);
  const camera = useGameStore((s) => s.camera);
  const tool = useGameStore((s) => s.tool);
  const visible = useGameStore((s) => (s.isDm() && !s.viewingAs ? null : s.visible));
  const fade = useGameStore((s) => (s.isDm() && !s.viewingAs ? null : s.fade));
  const explored = useGameStore((s) => (s.isDm() && !s.viewingAs ? null : s.explored));

  const containerRef = useRef<HTMLDivElement>(null);
  const panState = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

  const stageApi = useMemo<StageApi>(() => ({
    toMap(clientX, clientY) {
      const rect = containerRef.current?.getBoundingClientRect();
      const cam = useGameStore.getState().camera;
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - cam.x) / cam.scale,
        y: (clientY - rect.top - cam.y) / cam.scale,
      };
    },
  }), []);

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cam = useGameStore.getState().camera;
    const factor = Math.exp(-e.deltaY * 0.0012);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale * factor));
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    useGameStore.getState().setCamera({
      x: sx - ((sx - cam.x) * scale) / cam.scale,
      y: sy - ((sy - cam.y) * scale) / cam.scale,
      scale,
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // Keyboard: =/- zoom (tap or hold), WASDQE / arrow keys move the selected token.
  useEffect(() => {
    function zoomBy(factor: number) {
      const el = containerRef.current;
      if (!el) return;
      const cam = useGameStore.getState().camera;
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale * factor));
      // Zoom around the viewport centre.
      const cx = el.clientWidth / 2;
      const cy = el.clientHeight / 2;
      useGameStore.getState().setCamera({
        x: cx - ((cx - cam.x) * scale) / cam.scale,
        y: cy - ((cy - cam.y) * scale) / cam.scale,
        scale,
      });
    }

    function onKeyDown(e: KeyboardEvent) {
      // Never steal keys from chat, sheet fields, or other inputs.
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;

      // Escape cancels an in-progress combat target selection.
      if (e.key === 'Escape' && useGameStore.getState().targeting) {
        e.preventDefault();
        useGameStore.getState().cancelTargeting();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomBy(1.12);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomBy(1 / 1.12);
        return;
      }

      const s = useGameStore.getState();
      const token = s.selectedTokenId ? s.tokens[s.selectedTokenId] : undefined;
      if (!token || !s.you) return;
      const character = s.characters.find((c) => c.id === token.characterId);
      if (!canMoveToken(s.you.role, s.you.userId, token, character)) return;

      // Pointy-top axial directions. W/S ("up"/"down") alternate NW-NE / SW-SE
      // by parity so repeated presses walk visually straight up or down.
      const vertUp = ((token.q + token.r) & 1) === 0 ? { q: 1, r: -1 } : { q: 0, r: -1 };
      const vertDown = ((token.q + token.r) & 1) === 0 ? { q: -1, r: 1 } : { q: 0, r: 1 };
      const DIRS: Record<string, { q: number; r: number }> = {
        a: { q: -1, r: 0 }, arrowleft: { q: -1, r: 0 },
        d: { q: 1, r: 0 }, arrowright: { q: 1, r: 0 },
        q: { q: 0, r: -1 },  // northwest
        e: { q: 1, r: -1 },  // northeast
        w: vertUp, arrowup: vertUp,
        s: vertDown, arrowdown: vertDown,
      };
      const dir = DIRS[e.key.toLowerCase()];
      if (!dir) return;
      e.preventDefault();
      intents.moveToken(token.id, token.q + dir.q, token.r + dir.r);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Center the map when it first loads (or changes).
  useEffect(() => {
    if (!map) return;
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = mapPixelSize(map);
    // Clamp: a zero/tiny container (e.g. hidden panel) must never zero the
    // scale — camera math multiplies it, so 0 would be unrecoverable.
    const fit = Math.min(el.clientWidth / width, el.clientHeight / height, 1);
    const scale = Math.max(MIN_SCALE, Number.isFinite(fit) && fit > 0 ? fit : 1);
    useGameStore.getState().setCamera({
      x: (el.clientWidth - width * scale) / 2,
      y: (el.clientHeight - height * scale) / 2,
      scale,
    });
  }, [map?.id]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Middle button always pans; left button pans with the select tool
    // (tokens stop propagation so they still drag normally).
    const panButton = e.button === 1 || (e.button === 0 && tool === 'select');
    if (!panButton) return;
    const cam = useGameStore.getState().camera;
    panState.current = { startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    if (e.button === 0) {
      useGameStore.getState().selectToken(null);
      useGameStore.getState().openInspector(null);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const pan = panState.current;
    if (!pan) return;
    const cam = useGameStore.getState().camera;
    useGameStore.getState().setCamera({
      ...cam,
      x: pan.camX + (e.clientX - pan.startX),
      y: pan.camY + (e.clientY - pan.startY),
    });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    panState.current = null;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture may already be gone
    }
  }

  if (!map) {
    return (
      <div className="stage-empty">
        <p className="dim">No active map yet.</p>
      </div>
    );
  }

  return (
    <StageContext.Provider value={stageApi}>
      <div
        ref={containerRef}
        className="map-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className="map-surface"
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
            transformOrigin: '0 0',
          }}
        >
          <BackgroundCanvas map={map} />
          <DrawingLayer />
          <TokenLayer />
          <FogCanvas map={map} visible={visible} fade={fade} explored={explored} />
          <GeometryLayer />
          <PingMeasureLayer />
          <CombatTextLayer />
          {children}
        </div>
      </div>
    </StageContext.Provider>
  );
}
