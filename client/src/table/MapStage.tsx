import { useCallback, useEffect, useMemo, useRef } from 'react';
import { canMoveToken, hexToPixel, pixelToHex } from 'shared';
import { intents, useGameStore } from '../store/game';
import { worldDrag } from '../store/worldDrag';
import { mapPixelSize, StageContext, type StageApi } from '../util/stage';
import { AoeTemplateLayer } from './AoeTemplateLayer';
import { BackgroundCanvas } from './BackgroundCanvas';
import { CombatTextLayer } from './CombatTextLayer';
import { DrawingLayer } from './DrawingLayer';
import { FogCanvas } from './FogCanvas';
import { GeometryLayer } from './GeometryLayer';
import { MapObjectLayer } from './MapObjectLayer';
import { LightColorOverlay } from './LightColorOverlay';
import { PingMeasureLayer } from './PingMeasureLayer';
import { TargetPreviewLayer } from './TargetPreviewLayer';
import { TerrainCanvas } from './TerrainCanvas';
import { TerrainPainter } from './TerrainPainter';
import { TokenLayer } from './TokenLayer';

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const SQRT3 = Math.sqrt(3);
/** How many hexes across the shorter viewport dimension when centered on your own token — a tactical close-in view, not a whole-map fit. */
const FOCUS_HEXES_ACROSS = 12;

/** Pan/zoom container holding every map layer, ordered bottom to top. */
export function MapStage({ children }: { children?: React.ReactNode }) {
  const map = useGameStore((s) => s.map);
  const camera = useGameStore((s) => s.camera);
  const tool = useGameStore((s) => s.tool);
  const visible = useGameStore((s) => (s.isDm() && !s.viewingAs ? null : s.visible));
  const fade = useGameStore((s) => (s.isDm() && !s.viewingAs ? null : s.fade));
  const exploredLog = useGameStore((s) => (s.isDm() && !s.viewingAs ? null : s.exploredLog));
  // The log grows IN PLACE (stable reference), so also subscribe to its length —
  // that's what tells React a reveal happened and the fog needs a redraw.
  const exploredCount = useGameStore((s) => (s.isDm() && !s.viewingAs ? 0 : s.exploredLog?.length ?? 0));
  void exploredCount;
  const visiblePolygons = useGameStore((s) => (s.isDm() && !s.viewingAs ? null : s.visiblePolygons));
  const fadePolygons = useGameStore((s) => (s.isDm() && !s.viewingAs ? null : s.fadePolygons));
  const visibleLitMask = useGameStore((s) => (s.isDm() && !s.viewingAs ? null : s.visibleLitMask));
  const fadeLitMask = useGameStore((s) => (s.isDm() && !s.viewingAs ? null : s.fadeLitMask));

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
      if (e.key === 'Escape' && useGameStore.getState().aoeTargeting) {
        e.preventDefault();
        useGameStore.getState().cancelAoeTargeting();
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
      const canMove = token && s.you && canMoveToken(s.you.role, s.you.userId, token, s.characters.find((c) => c.id === token.characterId));

      if (token && canMove) {
        const vertUp = (token.r & 1) === 0 ? { q: 1, r: -1 } : { q: 0, r: -1 };
        const vertDown = (token.r & 1) === 0 ? { q: 0, r: 1 } : { q: -1, r: 1 };
        const DIRS: Record<string, { q: number; r: number }> = {
          a: { q: -1, r: 0 }, arrowleft: { q: -1, r: 0 },
          d: { q: 1, r: 0 }, arrowright: { q: 1, r: 0 },
          q: { q: 0, r: -1 },
          e: { q: 1, r: -1 },
          w: vertUp, arrowup: vertUp,
          s: vertDown, arrowdown: vertDown,
        };
        const dir = DIRS[e.key.toLowerCase()];
        if (!dir) return;
        e.preventDefault();
        if (s.selectedTokenIds.length > 1) {
          for (const id of s.selectedTokenIds) {
            const t = s.tokens[id];
            if (!t) continue;
            const tDir = { ...dir };
            if (dir === vertUp) {
              const up = (t.r & 1) === 0 ? { q: 1, r: -1 } : { q: 0, r: -1 };
              tDir.q = up.q; tDir.r = up.r;
            } else if (dir === vertDown) {
              const dn = (t.r & 1) === 0 ? { q: 0, r: 1 } : { q: -1, r: 1 };
              tDir.q = dn.q; tDir.r = dn.r;
            }
            intents.moveToken(id, t.q + tDir.q, t.r + tDir.r);
          }
        } else {
          intents.moveToken(token.id, token.q + dir.q, token.r + dir.r);
        }
        return;
      }

      // 'L' toggles layer for all selected tokens (DM only)
      if (e.key.toLowerCase() === 'l' && s.you?.role === 'dm' && s.selectedTokenIds.length > 0) {
        e.preventDefault();
        for (const id of s.selectedTokenIds) {
          const t = s.tokens[id];
          if (!t) continue;
          const newLayer = t.layer === 'gm' ? 'token' : 'gm';
          intents.updateToken(id, { layer: newLayer });
        }
        return;
      }

      // No movable token selected — pan the camera instead.
      const PAN_PX = 80;
      const PAN_DIRS: Record<string, { dx: number; dy: number }> = {
        w: { dx: 0, dy: PAN_PX }, arrowup: { dx: 0, dy: PAN_PX },
        s: { dx: 0, dy: -PAN_PX }, arrowdown: { dx: 0, dy: -PAN_PX },
        a: { dx: PAN_PX, dy: 0 }, arrowleft: { dx: PAN_PX, dy: 0 },
        d: { dx: -PAN_PX, dy: 0 }, arrowright: { dx: -PAN_PX, dy: 0 },
      };
      const pan = PAN_DIRS[e.key.toLowerCase()];
      if (!pan) return;
      e.preventDefault();
      const cam = useGameStore.getState().camera;
      useGameStore.getState().setCamera({ x: cam.x + pan.dx, y: cam.y + pan.dy, scale: cam.scale });
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Center the map when it first loads (or changes). A player whose own
  // character has a token here gets a tactical close-in view centered on it
  // (e.g. the DM just moved their token onto a new map); everyone else — the
  // DM, or a player with no token here yet — gets the whole map fit to
  // screen, as before.
  useEffect(() => {
    if (!map) return;
    const el = containerRef.current;
    if (!el) return;

    const s = useGameStore.getState();
    const myToken = s.you && s.you.role !== 'dm'
      ? Object.values(s.tokens).find((t) => {
          const c = s.characters.find((ch) => ch.id === t.characterId);
          return !!c && c.ownerUserId === s.you!.userId;
        })
      : undefined;

    if (myToken) {
      const center = hexToPixel({ q: myToken.q, r: myToken.r }, map.grid);
      const target = Math.min(el.clientWidth, el.clientHeight) / (map.grid.hexSize * SQRT3 * FOCUS_HEXES_ACROSS);
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number.isFinite(target) && target > 0 ? target : 1));
      useGameStore.getState().setCamera({
        x: el.clientWidth / 2 - center.x * scale,
        y: el.clientHeight / 2 - center.y * scale,
        scale,
      });
      return;
    }

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
      useGameStore.getState().selectWall(null);
      useGameStore.getState().selectDoor(null);
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

  // DM dragging a character row from the World tab and dropping it on the
  // map: place its token at the exact hex released and nest it under this
  // map (mirrors dragging onto the map's row in the tree, but with an
  // explicit landing spot instead of the spawn point).
  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    const k = worldDrag.current?.kind;
    if (k !== 'character' && k !== 'folder' && k !== 'shop' && k !== 'light') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    const drag = worldDrag.current;
    worldDrag.current = null;
    if (!drag || !map) return;
    e.preventDefault();
    if (useGameStore.getState().you?.role !== 'dm') return;
    const p = stageApi.toMap(e.clientX, e.clientY);
    const hex = pixelToHex(p, map.grid);
    if (drag.kind === 'character') {
      intents.dropCharacterOnMap(drag.id, map.id, hex.q, hex.r);
    } else if (drag.kind === 'folder') {
      const tokenOnHex = Object.values(useGameStore.getState().tokens).find((t) => t.q === hex.q && t.r === hex.r);
      if (tokenOnHex?.characterId) {
        intents.dropFolderOnCharacter(drag.id, tokenOnHex.characterId);
      } else {
        intents.dropFolderOnMap(drag.id, map.id, hex.q, hex.r);
      }
    } else if (drag.kind === 'shop') {
      const tokenOnHex = Object.values(useGameStore.getState().tokens).find((t) => t.q === hex.q && t.r === hex.r);
      if (tokenOnHex?.characterId) {
        intents.updateShop(drag.id, { linkedCharacterId: tokenOnHex.characterId });
      } else {
        intents.dropShopOnMap(drag.id, map.id, hex.q, hex.r);
      }
    } else if (drag.kind === 'light') {
      const tokenOnHex = Object.values(useGameStore.getState().tokens).find((t) => t.q === hex.q && t.r === hex.r);
      if (tokenOnHex?.characterId) {
        intents.linkLightToToken(drag.id, map.id, tokenOnHex.id);
      }
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
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div
          className="map-surface"
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
            transformOrigin: '0 0',
          }}
        >
          <BackgroundCanvas map={map} />
          <TerrainCanvas grid={map.grid} />
          <LightColorOverlay map={map} visibleLitMask={visibleLitMask} fadePolygons={fadePolygons} />
          <DrawingLayer />
          <MapObjectLayer />
          <TokenLayer />
          <FogCanvas
            map={map} visible={visible} fade={fade} exploredLog={exploredLog}
            visiblePolygons={visiblePolygons} fadePolygons={fadePolygons}
            visibleLitMask={visibleLitMask} fadeLitMask={fadeLitMask}
          />
          <GeometryLayer />
          <PingMeasureLayer />
          <AoeTemplateLayer />
          <TargetPreviewLayer />
          <CombatTextLayer />
          <TerrainPainter />
          {children}
        </div>
      </div>
    </StageContext.Provider>
  );
}
