import type { ReactNode } from 'react';
import { needsNpcBoost } from 'shared';
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
import { Soundboard } from '../panels/Soundboard';
import { RollStatsWindow } from '../panels/RollStats';
import { IronDiceWindow } from '../panels/IronDice';
import { PublicSheetWindow } from '../panels/PublicSheet';
import { MapDetailsWindow } from '../panels/MapDetails';
import { SwadeCharacterCreator } from '../panels/SwadeCharacterCreator';
import { SwnCharacterCreator } from '../panels/SwnCharacterCreator';
import { Dnd5eCharacterCreator } from '../panels/Dnd5eCharacterCreator';
import { SwadeAdvanceWizard } from '../panels/SwadeAdvanceWizard';
import { SwnLevelUpWizard } from '../panels/SwnLevelUpWizard';
import { NpcBoostWizard } from '../panels/NpcBoostWizard';
import { LevelUpWizard } from '../panels/LevelUpWizard';
import { Compendium } from '../panels/Compendium';
import { AssetPickerWindow, SheetPickerWindow, parsePickerKey } from '../panels/SheetPickerWindow';

/** Mounted once at the top level: renders every open window instance,
 *  each in its own draggable/poppable WindowFrame, so multiple windows
 *  (two handouts, a sheet + a shop, …) can coexist. */
export function WindowHost() {
  const windows = useWindowManager((s) => s.windows);
  const handouts = useGameStore((s) => s.handoutList);
  const shops = useGameStore((s) => s.shopList);
  const tables = useGameStore((s) => s.tableList);
  const locations = useGameStore((s) => s.locationList);
  const characters = useGameStore((s) => s.characters);
  const system = useGameStore((s) => s.campaign?.system);

  return (
    <>
      {windows.map((w) => {
        const onClose = () => closeWindow(w.id);
        let content: ReactNode = null;
        switch (w.kind) {
          case 'soundboard':
            content = <Soundboard />;
            break;
          case 'rollStats':
            content = <RollStatsWindow />;
            break;
          case 'ironDice':
            content = <IronDiceWindow />;
            break;
          case 'mapDetails':
            content = <MapDetailsWindow mapId={w.key} />;
            break;
          case 'publicSheet':
            content = <PublicSheetWindow characterId={w.key} />;
            break;
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
          case 'characterCreator':
            content = system === 'swade' ? <SwadeCharacterCreator onClose={onClose} />
              : system === 'swn' ? <SwnCharacterCreator onClose={onClose} />
                : system === 'dnd5e' ? <Dnd5eCharacterCreator onClose={onClose} />
                  : null;
            break;
          case 'levelUp': {
            // Which wizard is the character's own business, not the opener's,
            // so the branch lives here rather than at every ⬆ button.
            const ch = characters.find((c) => c.id === w.key);
            content = !ch ? null
              : ch.system === 'swade' ? <SwadeAdvanceWizard character={ch} onClose={onClose} />
                : ch.system === 'swn' ? <SwnLevelUpWizard character={ch} onClose={onClose} />
                  : needsNpcBoost(String(ch.sheet.class ?? '')) ? <NpcBoostWizard character={ch} onClose={onClose} />
                    : <LevelUpWizard character={ch} onClose={onClose} />;
            break;
          }
          case 'compendium': {
            const ch = characters.find((c) => c.id === w.key);
            content = ch ? <Compendium character={ch} onClose={onClose} /> : null;
            break;
          }
          // Both wrap their child so the picker's own backdrop and header stop
          // applying — the frame is the window now (see .picker-in-window).
          case 'sheetPicker': {
            const { what, characterId } = parsePickerKey(w.key);
            content = (
              <div className="picker-in-window">
                <SheetPickerWindow characterId={characterId} what={what} onClose={onClose} />
              </div>
            );
            break;
          }
          case 'assetPicker': {
            const i = w.key.indexOf(':');
            content = (
              <div className="picker-in-window">
                <AssetPickerWindow characterId={w.key.slice(i + 1)} fieldId={w.key.slice(0, i)} onClose={onClose} />
              </div>
            );
            break;
          }
        }
        if (!content) return null;
        return <WindowFrame key={w.id} win={w}>{content}</WindowFrame>;
      })}
    </>
  );
}
