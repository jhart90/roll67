import {
  applyBackground, applyFocus, applyNamedPick, applyPackage, takenFocusIds, takenPickIds,
  INFUSIONS_5E, INVOCATIONS_5E, METAMAGIC_5E, SWN_BACKGROUNDS, SWN_FOCI, SWN_PACKAGES,
  type NamedPick,
} from 'shared';
import { intents, useGameStore } from '../store/game';
import { AssetPicker } from './AssetPicker';
import { FeatPicker } from './FeatPicker';
import { PickerModal, type PickItem } from './SwnFeatures';

/** What a sheet picker can be picking. Encoded in the window key. */
export type PickerWhat =
  | 'feats'
  | 'invocations' | 'metamagic' | 'infusions'
  | 'focus' | 'background' | 'package';

/** The window key for one picker: `${what}:${characterId}`. */
export function pickerKey(what: PickerWhat, characterId: string): string {
  return `${what}:${characterId}`;
}

export function parsePickerKey(key: string): { what: PickerWhat; characterId: string } {
  const i = key.indexOf(':');
  return { what: key.slice(0, i) as PickerWhat, characterId: key.slice(i + 1) };
}

/** Window titles, so the frame says what you are choosing before you open it. */
export const PICKER_TITLE: Record<PickerWhat, string> = {
  feats: 'Feats',
  invocations: 'Eldritch Invocations',
  metamagic: 'Metamagic',
  infusions: 'Infusions',
  focus: 'Foci',
  background: 'Backgrounds',
  package: 'Equipment packages',
};

/** The three 5e lists that all add the same way — one entry, one apply call. */
const NAMED: Partial<Record<PickerWhat, { list: 'invocations' | 'metamagic' | 'infusions'; catalog: NamedPick[] }>> = {
  invocations: { list: 'invocations', catalog: INVOCATIONS_5E },
  metamagic: { list: 'metamagic', catalog: METAMAGIC_5E },
  infusions: { list: 'infusions', catalog: INFUSIONS_5E },
};

const asItems = (catalog: NamedPick[]): PickItem[] =>
  catalog.map((p) => ({ id: p.id, name: p.name, desc: p.desc }));

/**
 * Every "add something to this sheet" picker, in one window.
 *
 * They used to be modals owned by the panel that opened them, which meant the
 * sheet you were choosing FOR was covered by the thing you were choosing from.
 * Nothing here needs that ownership: each picker's result goes straight to the
 * server through `intents` against a character id, so the window can resolve
 * the character itself and no callback has to survive its opener.
 */
export function SheetPickerWindow({ characterId, what, onClose }: {
  characterId: string; what: PickerWhat; onClose: () => void;
}) {
  const character = useGameStore((s) => s.characters.find((c) => c.id === characterId));
  if (!character) return null;
  const sheet = character.sheet;

  if (what === 'feats') return <FeatPicker character={character} onClose={onClose} />;

  const named = NAMED[what];
  if (named) {
    return (
      <PickerModal
        title={PICKER_TITLE[what]}
        subtitle={`add to ${character.name}`}
        onClose={onClose}
        taken={new Set(takenPickIds(sheet, named.list))}
        items={asItems(named.catalog)}
        onAdd={(id) => {
          intents.updateCharacter(character.id, applyNamedPick(sheet, named.list, named.catalog, id));
          onClose();
        }}
      />
    );
  }

  // SWN: each of these announces itself in chat as well as patching the sheet,
  // because taking a focus or a package is a table-visible change.
  if (what === 'focus') {
    return (
      <PickerModal
        title={PICKER_TITLE.focus} subtitle={`add to ${character.name}`} onClose={onClose}
        taken={new Set(takenFocusIds(sheet))}
        items={SWN_FOCI.map((f) => ({
          id: f.id, name: f.name,
          tag: f.combat ? 'combat' : f.grantsSkill ? f.grantsSkill : undefined,
          desc: f.level1,
        }))}
        onAdd={(id) => {
          const f = SWN_FOCI.find((x) => x.id === id)!;
          // Read before the patch: "advances" vs "gains" depends on whether
          // they already had it.
          const already = takenFocusIds(sheet).includes(id);
          intents.updateCharacter(character.id, applyFocus(sheet, id));
          intents.chat(`${character.name} ${already ? 'advances' : 'gains'} the ${f.name} focus.`);
          onClose();
        }}
      />
    );
  }
  if (what === 'background') {
    return (
      <PickerModal
        title={PICKER_TITLE.background} subtitle={`add to ${character.name}`} onClose={onClose}
        taken={new Set()}
        items={SWN_BACKGROUNDS.map((b) => ({ id: b.id, name: b.name, tag: `free ${b.freeSkill}`, desc: b.desc }))}
        onAdd={(id) => {
          const b = SWN_BACKGROUNDS.find((x) => x.id === id)!;
          intents.updateCharacter(character.id, applyBackground(sheet, id));
          intents.chat(`${character.name} takes the ${b.name} background (free ${b.freeSkill}).`);
          onClose();
        }}
      />
    );
  }
  return (
    <PickerModal
      title={PICKER_TITLE.package} subtitle={`add to ${character.name}`} onClose={onClose}
      taken={new Set()}
      items={SWN_PACKAGES.map((p) => ({
        id: p.id, name: p.name, tag: `${p.credits} cr`,
        desc: `${p.desc} · ${[...p.weapons.map((w) => w.name), ...p.armor.map((a) => a.name)].join(', ')}`,
      }))}
      onAdd={(id) => {
        const p = SWN_PACKAGES.find((x) => x.id === id)!;
        intents.updateCharacter(character.id, applyPackage(sheet, id));
        intents.chat(`${character.name} outfits with the ${p.name} equipment package.`);
        onClose();
      }}
    />
  );
}

/**
 * The image chooser, as a window. Keyed `${fieldId}:${characterId}` so a token
 * image and a portrait can be open at once, and so the commit needs nothing
 * from the sheet that opened it.
 */
export function AssetPickerWindow({ characterId, fieldId, onClose }: {
  characterId: string; fieldId: string; onClose: () => void;
}) {
  const character = useGameStore((s) => s.characters.find((c) => c.id === characterId));
  if (!character) return null;
  return (
    <AssetPicker
      title={fieldId === 'tokenImage' ? 'Choose a token image' : 'Choose a portrait image'}
      onPick={(a) => {
        // Setting the token image also carries the assetId, so the server can
        // repaint this character's tokens on every map.
        intents.updateCharacter(character.id, {
          [fieldId]: a.url,
          ...(fieldId === 'tokenImage' ? { tokenImageAssetId: a.id } : {}),
        });
        onClose();
      }}
      onClose={onClose}
    />
  );
}
