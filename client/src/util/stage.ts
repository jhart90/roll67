import { createContext, useContext } from 'react';
import type { MapView, Point } from 'shared';

const SQRT3 = Math.sqrt(3);

/** Pixel size of the whole map surface (bg image, or grid extent if none). */
export function mapPixelSize(map: MapView): { width: number; height: number } {
  if (map.bgUrl && map.bgWidth > 0 && map.bgHeight > 0) {
    return { width: map.bgWidth, height: map.bgHeight };
  }
  const g = map.grid;
  return {
    width: Math.ceil(SQRT3 * g.hexSize * (g.cols + 0.5) + g.originX),
    height: Math.ceil(g.hexSize * (1.5 * g.rows + 0.5) + g.originY),
  };
}

export interface StageApi {
  /** Convert a pointer event's client coords to map pixel coords. */
  toMap(clientX: number, clientY: number): Point;
}

export const StageContext = createContext<StageApi>({
  toMap: () => ({ x: 0, y: 0 }),
});

export function useStage(): StageApi {
  return useContext(StageContext);
}
