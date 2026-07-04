// Cross-panel drag state for the World tree. Native HTML5 drag-and-drop
// events fire on whatever DOM element they land on regardless of React tree
// position, so a drag started in the World dock panel needs to be readable
// from a drop handler on the map canvas in a completely different panel.
// A plain mutable ref (not Zustand state) avoids remounting the dragged row
// mid-drag, which would silently abort the browser's native drag gesture.

export type WorldDragKind = 'location' | 'character' | 'shop' | 'table' | 'handout' | 'map' | 'folder';

export interface WorldDragItem {
  kind: WorldDragKind;
  id: string;
}

export const worldDrag: { current: WorldDragItem | null } = { current: null };
