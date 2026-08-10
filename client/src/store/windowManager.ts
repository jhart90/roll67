import { create } from 'zustand';

export type WindowKind =
  | 'characterSheet'
  | 'handout'
  | 'shop'
  | 'table'
  | 'location'
  | 'mapEditor'
  | 'npcLibrary'
  | 'randomizeNpc'
  | 'assetLibrary'
  | 'soundboard'
  | 'rollStats'
  | 'ironDice'
  | 'publicSheet'
  | 'mapDetails'
  | 'accountDetails'
  // Long-running jobs that used to be centred modals. They are multi-minute
  // tasks you want to do WITH the map and your sheet visible, so they belong
  // in the window system like everything else.
  | 'characterCreator'
  | 'levelUp'
  | 'compendium';

export interface WindowInstance {
  /** `${kind}:${key}` — opening the same kind+key again focuses this instance. */
  id: string;
  kind: WindowKind;
  key: string;
  props: Record<string, unknown>;
  title: string;
  x: number;
  y: number;
  z: number;
  poppedOut: boolean;
  /** Centered in the map pane (DM-pushed handouts) until the user drags it —
   *  x/y are ignored while set. */
  centered?: boolean;
}

interface WindowManagerState {
  windows: WindowInstance[];
  topZ: number;
  openWindow(kind: WindowKind, key: string, props: Record<string, unknown>, title: string, opts?: { centered?: boolean }): void;
  closeWindow(id: string): void;
  focusWindow(id: string): void;
  moveWindow(id: string, x: number, y: number): void;
  popOut(id: string): void;
  popIn(id: string): void;
}

const CASCADE_STEP = 28;
const CASCADE_SLOTS = 8;

export const useWindowManager = create<WindowManagerState>((set, get) => ({
  windows: [],
  topZ: 50,

  openWindow(kind, key, props, title, opts) {
    const id = `${kind}:${key}`;
    const existing = get().windows.find((w) => w.id === id);
    const z = get().topZ + 1;
    if (existing) {
      set((s) => ({
        topZ: z,
        windows: s.windows.map((w) => (w.id === id ? { ...w, props, title, z, ...(opts?.centered ? { centered: true } : {}) } : w)),
      }));
      return;
    }
    const slot = get().windows.length % CASCADE_SLOTS;
    set((s) => ({
      topZ: z,
      windows: [...s.windows, {
        id, kind, key, props, title, z,
        x: 72 + slot * CASCADE_STEP,
        y: 48 + slot * CASCADE_STEP,
        poppedOut: false,
        ...(opts?.centered ? { centered: true } : {}),
      }],
    }));
  },

  closeWindow(id) {
    set((s) => ({ windows: s.windows.filter((w) => w.id !== id) }));
  },

  focusWindow(id) {
    const z = get().topZ + 1;
    set((s) => ({ topZ: z, windows: s.windows.map((w) => (w.id === id ? { ...w, z } : w)) }));
  },

  moveWindow(id, x, y) {
    // Dragging pins the window: centered mode ends where the user puts it.
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, x, y, centered: false } : w)) }));
  },

  popOut(id) {
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, poppedOut: true } : w)) }));
  },

  popIn(id) {
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, poppedOut: false } : w)) }));
  },
}));

export function openWindow(kind: WindowKind, key: string, props: Record<string, unknown>, title: string, opts?: { centered?: boolean }): void {
  useWindowManager.getState().openWindow(kind, key, props, title, opts);
}

export function closeWindow(id: string): void {
  useWindowManager.getState().closeWindow(id);
}
