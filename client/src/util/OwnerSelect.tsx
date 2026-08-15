import { playerColorFor, readableOn } from './playerColor';
import { intents, useGameStore } from '../store/game';

/**
 * "Controlled by" — who runs this character.
 *
 * Painted in the owner's own colour, because that colour is already how the
 * table tells people apart everywhere else: the presence dots, the chat
 * names, the ring on a token. A dropdown reading "tester3" in the same grey
 * as every other dropdown made the DM match a name to a person; wearing the
 * colour, it is the same glance as looking at the map.
 *
 * Shared between the token inspector and the character sheet's own header, so
 * the two can never disagree about what the field is called, what it offers,
 * or what it looks like — and DM-only in both, since reassigning a character
 * is not a thing a player does.
 */
export function OwnerSelect({ characterId, ownerUserId, compact }: {
  characterId: string;
  ownerUserId: string | null;
  /** The sheet header's version: no label, sized to sit in a toolbar row. */
  compact?: boolean;
}) {
  const members = useGameStore((s) => s.members);
  const players = members.filter((m) => m.role === 'player');
  const owner = ownerUserId ? members.find((m) => m.userId === ownerUserId) : undefined;
  const color = owner ? playerColorFor(owner) : null;

  const select = (
    <select
      className={`owner-select${compact ? ' owner-select-compact' : ''}`}
      value={ownerUserId ?? ''}
      title={owner ? `Run by ${owner.username}` : 'Nobody runs this — it is the DM’s'}
      style={color ? { background: color, color: readableOn(color), borderColor: color } : undefined}
      onChange={(e) => intents.setCharacterOwner(characterId, e.target.value || null)}
    >
      <option value="">DM only (NPC)</option>
      {players.map((m) => (
        // The options themselves wear it too, so the list reads as the people
        // it names rather than as a column of text.
        <option
          key={m.userId}
          value={m.userId}
          style={{ background: playerColorFor(m), color: readableOn(playerColorFor(m)) }}
        >
          {m.username}
        </option>
      ))}
    </select>
  );

  if (compact) return select;
  return <label>Controlled by{select}</label>;
}
