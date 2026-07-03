import { LocationsPanel } from './LocationsPanel';
import { ShopsPanel } from './ShopsPanel';

/** Worldbuilding hub: locations and shops. */
export function WorldPanel() {
  return (
    <div className="dock-panel">
      <LocationsPanel />
      <ShopsPanel />
    </div>
  );
}
