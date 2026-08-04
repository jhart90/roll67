import { useEffect, useState } from 'react';
import type { Character } from 'shared';
import { intents, useGameStore } from '../store/game';

/**
 * The sheet's Notes tab: one big free-text field the character's player (and
 * the DM) can read and edit, saved on blur. Below it, DM-only: a second
 * secret-notes field that players can never see — it isn't part of the sheet
 * at all, but lives behind its own DM-gated socket events, so no client-side
 * mistake can ever leak it.
 */
export function NotesTab({ character, editable }: { character: Character; editable: boolean }) {
  const isDm = useGameStore((s) => s.you?.role) === 'dm';
  const secret = useGameStore((s) => s.dmNotesData[character.id]);

  const saved = String(character.sheet.playerNotes ?? '');
  const [notes, setNotes] = useState(saved);
  // Follow external edits (the other of player/DM saving) unless mid-edit.
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setNotes(saved); }, [saved, dirty]);

  const [secretDraft, setSecretDraft] = useState('');
  const [secretDirty, setSecretDirty] = useState(false);
  useEffect(() => { if (isDm) intents.getDmNotes(character.id); }, [isDm, character.id]);
  useEffect(() => { if (!secretDirty) setSecretDraft(secret ?? ''); }, [secret, secretDirty]);

  return (
    <div className="notes-tab">
      <label>
        Notes <span className="dim">(visible to {character.ownerUserId ? 'the player and the DM' : 'the DM'}; saved when you click away)</span>
      </label>
      <textarea
        className="notes-field"
        value={notes}
        readOnly={!editable}
        placeholder="Session notes, plans, contacts, loose threads…"
        onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
        onBlur={() => {
          if (dirty && notes !== saved) intents.updateCharacter(character.id, { playerNotes: notes });
          setDirty(false);
        }}
      />
      {isDm && (
        <>
          <label style={{ marginTop: 10 }}>
            🕶 DM secret notes <span className="dim">(only DM eyes ever see this — it never reaches a player's client)</span>
          </label>
          <textarea
            className="notes-field notes-secret"
            value={secretDraft}
            placeholder="What they don't know… true motives, hidden HP, the twist."
            onChange={(e) => { setSecretDraft(e.target.value); setSecretDirty(true); }}
            onBlur={() => {
              if (secretDirty && secretDraft !== (secret ?? '')) intents.setDmNotes(character.id, secretDraft);
              setSecretDirty(false);
            }}
          />
        </>
      )}
    </div>
  );
}
