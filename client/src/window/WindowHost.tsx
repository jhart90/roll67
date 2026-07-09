import type { ReactNode } from 'react';
import { useGameStore } from '../store/game';
import { closeWindow, useWindowManager } from '../store/windowManager';
import { WindowFrame } from './WindowFrame';
import { CharacterSheetWindow } from '../panels/CharacterSheet';
import { HandoutWindow } from '../panels/HandoutsPanel';
import { ShopEditor } from '../panels/ShopsPanel';
import { TableEditor } from '../panels/RollableTables';
import { LocationEditor } from '../panels/LocationsPanel';
import { MapEditorWindow } from '../table/dm/MapManager';
import { NpcLibrary } from '../panels/NpcLibrary';
import { RandomizeNpcModal } from '../panels/RandomizeNpcModal';
import { AssetLibrary } from '../panels/AssetLibrary';
import { AccountDetails } from '../panels/AccountDetails';

/** Mounted once at the top level: renders every open window instance,
 *  each in its own draggable/poppable WindowFrame, so multiple windows
 *  (two handouts, a sheet + a shop, …) can coexist. */
export function WindowHost() {
  const windows = useWindowManager((s) => s.windows);
  const handouts = useGameStore((s) => s.handoutList);
  const shops = useGameStore((s) => s.shopList);
  const tables = useGameStore((s) => s.tableList);
  const locations = useGameStore((s) => s.locationList);

  return (
    <>
      {windows.map((w) => {
        const onClose = () => closeWindow(w.id);
        let content: ReactNode = null;
        switch (w.kind) {
          case 'characterSheet':
            content = <CharacterSheetWindow characterId={w.key} onClose={onClose} />;
            break;
          case 'handout':
            content = <HandoutWindow handout={w.key === 'new' ? null : handouts.find((h) => h.id === w.key) ?? null} onClose={onClose} />;
            break;
          case 'shop': {
            const shop = shops.find((s) => s.id === w.key);
            content = shop ? <ShopEditor shop={shop} onClose={onClose} /> : null;
            break;
          }
          case 'table': {
            const table = tables.find((t) => t.id === w.key);
            content = table ? <TableEditor table={table} onClose={onClose} /> : null;
            break;
          }
          case 'location': {
            const loc = locations.find((l) => l.id === w.key);
            content = loc ? <LocationEditor loc={loc} onClose={onClose} /> : null;
            break;
          }
          case 'mapEditor':
            content = <MapEditorWindow mapId={w.key} onClose={onClose} />;
            break;
          case 'npcLibrary':
            content = <NpcLibrary onClose={onClose} />;
            break;
          case 'randomizeNpc':
            content = <RandomizeNpcModal onClose={onClose} />;
            break;
          case 'assetLibrary':
            content = <AssetLibrary onClose={onClose} />;
            break;
          case 'accountDetails':
            content = <AccountDetails onClose={onClose} />;
            break;
        }
        if (!content) return null;
        return <WindowFrame key={w.id} win={w}>{content}</WindowFrame>;
      })}
    </>
  );
}
