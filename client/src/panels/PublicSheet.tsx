import { useEffect, useState } from 'react';
import { intents, useGameStore } from '../store/game';
import { readableOn } from '../util/playerColor';
import { RollStatsTab } from './RollStats';

/**
 * The safe view of somebody else's character: exactly what their nameplate
 * already shows (name, colour, descriptive lines), plus portrait, token art,
 * and the sheet's free-text bio sections — and the Roll Stats tab. Never
 * stats, gear, HP, or anything mechanical; the server builds the payload,
 * the full sheet never reaches this client.
 */
/**
 * The viewer's OWN scratchpad about this character — what you suspect, what
 * they owe you, where you saw them last. Keyed per user + character on the
 * server and only ever sent back to your own sockets: not the token's owner,
 * not the DM, nobody else can read it.
 */
function PrivateNotesTab({ characterId, name }: { characterId: string; name: string }) {
  const saved = useGameStore((s) => s.privateNotesData[characterId]);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { intents.getPrivateNotes(characterId); }, [characterId]);
  useEffect(() => { if (!dirty) setDraft(saved ?? ''); }, [saved, dirty]);
  return (
    <div className="notes-tab" style={{ padding: '8px 10px' }}>
      <label>
        My notes on {name} <span className="dim">(only you can see this; saved when you click away)</span>
      </label>
      <textarea
        className="notes-field"
        value={draft}
        placeholder="Suspicions, debts, favors, where you last saw them…"
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        onBlur={() => {
          if (dirty && draft !== (saved ?? '')) intents.setPrivateNotes(characterId, draft);
          setDirty(false);
        }}
      />
    </div>
  );
}

export function PublicSheetWindow({ characterId }: { characterId: string }) {
  const sheet = useGameStore((s) => s.publicSheets[characterId]);
  const isDm = useGameStore((s) => s.you?.role) === 'dm';
  const [tab, setTab] = useState<'profile' | 'stats' | 'notes'>('profile');
  useEffect(() => { intents.getPublicSheet(characterId); }, [characterId]);

  if (!sheet) return <p className="dim" style={{ margin: 8 }}>Loading…</p>;
  const fg = readableOn(sheet.color);
  return (
    <div className="public-sheet">
      <div className="public-sheet-head" style={{ background: sheet.color, color: fg }}>
        {sheet.portraitUrl && <img className="public-sheet-portrait" src={sheet.portraitUrl} alt="" />}
        <div className="public-sheet-id">
          <strong>{sheet.name}</strong>
          {sheet.lines.map((l, i) => <span key={i} className={`np-${l.kind}`}>{l.text}</span>)}
        </div>
        {sheet.tokenImageUrl && sheet.tokenImageUrl !== sheet.portraitUrl && (
          <img className="public-sheet-token" src={sheet.tokenImageUrl} alt="" title="Token art" />
        )}
        {isDm && sheet.system === 'swade' && (
          <button
            className="link"
            style={{ marginLeft: 'auto', flex: '0 0 auto' }}
            title={`Give ${sheet.name} a Benny — announced in chat`}
            onClick={() => intents.awardBenny(characterId)}
          >
            🪙 award
          </button>
        )}
      </div>
      <div className="sheet-tabs">
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>Profile</button>
        <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>📝 My Notes</button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>📊 Roll Stats</button>
      </div>
      {tab === 'notes' ? (
        <PrivateNotesTab characterId={characterId} name={sheet.name} />
      ) : tab === 'profile' ? (
        <div className="public-sheet-bio">
          {/* The portrait leads: it's what the table actually wants to see.
              It spans the sheet's full width and the sheet grows to show it,
              up to the height of the map pane it lives in. */}
          {sheet.detailImageUrl && (
            <img className="public-sheet-art" src={sheet.detailImageUrl} alt={`${sheet.name} portrait`} />
          )}
          {sheet.bioText && <p className="public-sheet-blurb">{sheet.bioText}</p>}
          {sheet.bio.length === 0 && !sheet.bioText && !sheet.detailImageUrl && (
            <p className="dim">Nothing written about {sheet.name} yet.</p>
          )}
          {sheet.bio.map((section) => (
            <div key={section.title}>
              <h4>{section.title}</h4>
              {section.entries.map((e) => (
                <p key={e.label} style={{ margin: '2px 0' }}>
                  <span className="dim">{e.label}: </span>{e.text}
                </p>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <RollStatsTab characterId={characterId} />
      )}
    </div>
  );
}
