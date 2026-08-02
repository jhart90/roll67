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
export function PublicSheetWindow({ characterId }: { characterId: string }) {
  const sheet = useGameStore((s) => s.publicSheets[characterId]);
  const [tab, setTab] = useState<'profile' | 'stats'>('profile');
  useEffect(() => { intents.getPublicSheet(characterId); }, [characterId]);

  if (!sheet) return <p className="dim" style={{ margin: 8 }}>Loading…</p>;
  const fg = readableOn(sheet.color);
  return (
    <div className="public-sheet">
      <div className="public-sheet-head" style={{ background: sheet.color, color: fg }}>
        {sheet.portraitUrl && <img className="public-sheet-portrait" src={sheet.portraitUrl} alt="" />}
        <div className="public-sheet-id">
          <strong>{sheet.name}</strong>
          {sheet.lines.map((l, i) => <span key={i}>{l}</span>)}
        </div>
        {sheet.tokenImageUrl && sheet.tokenImageUrl !== sheet.portraitUrl && (
          <img className="public-sheet-token" src={sheet.tokenImageUrl} alt="" title="Token art" />
        )}
      </div>
      <div className="sheet-tabs">
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>Profile</button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>📊 Roll Stats</button>
      </div>
      {tab === 'profile' ? (
        <div className="public-sheet-bio">
          {sheet.bio.length === 0 && <p className="dim">Nothing written about {sheet.name} yet.</p>}
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
