import { useState } from 'react';
import { intents, useGameStore } from '../store/game';
import { CardChip } from '../util/PlayingCardView';
import { SavePrompt } from './SavePrompt';
import { ChasePrompt } from './ChasePrompt';
import { DealCardsPrompt } from './DealCardsPrompt';
import { FearPrompt } from './FearPrompt';
import { TestPrompt } from './TestPrompt';

export function InitiativePanel() {
  const you = useGameStore((s) => s.you);
  const state = useGameStore((s) => s.initiativeState);
  const selected = useGameStore((s) => (s.selectedTokenId ? s.tokens[s.selectedTokenId] : undefined));
  const map = useGameStore((s) => s.map);
  const campaign = useGameStore((s) => s.campaign);
  const [saving, setSaving] = useState(false);
  const [chasing, setChasing] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [fearing, setFearing] = useState(false);
  const [testing, setTesting] = useState(false);

  const isDm = useGameStore((s) => s.isDm());
  const floatHidden = useGameStore((s) => s.initFloatHidden);
  const setFloatHidden = useGameStore((s) => s.setInitFloatHidden);
  if (!you) return null;
  const swade = campaign?.system === 'swade';
  const cardMode = !!state.cardMode;
  const pending = state.pendingDraws ?? [];
  const pendingRolls = state.pendingRolls ?? [];

  return (
    <div className="dock-panel">
      <div className="dock-header">
        <h3>Initiative {state.active && <span className="tag">round {state.round}</span>}</h3>
        {/* The floating tracker's way back. It is closable by everyone and
            was previously only restored by a NEW combat, so anyone who shut
            it mid-fight had lost it until the fight ended. */}
        {state.active && (
          <button
            className="link"
            title={floatHidden
              ? 'Bring back the floating turn tracker over the map'
              : 'Hide the floating turn tracker (this list keeps working)'}
            onClick={() => setFloatHidden(!floatHidden)}
          >
            {floatHidden ? 'show tracker' : 'hide tracker'}
          </button>
        )}
        {isDm && (
          <button className="link" onClick={() => intents.initSetActive(!state.active)}>
            {state.active ? 'end combat' : 'start combat'}
          </button>
        )}
      </div>

      <ol className="init-list">
        {state.entries.map((e, i) => (
          <li key={e.id} className={`${i === state.turnIdx && state.active ? 'current' : ''} ${e.hidden ? 'hidden-entry' : ''}`}>
            {e.card ? (
              <CardChip card={e.card} />
            ) : cardMode ? (
              // In card mode the chip IS the reason this row sits where it
              // does. An entry with no card yet showed a bare "0", which read
              // as an initiative of nothing rather than as "still to draw".
              <span className="init-value" title="Waiting on an Action Card — this row is unsorted until it draws.">🂠</span>
            ) : isDm ? (
              <input
                key={`${e.id}:${e.value}`}
                type="number"
                className="init-value-input"
                defaultValue={e.value}
                title="Initiative — the higher number acts first. Type to set it by hand."
                onBlur={(ev) => {
                  const v = Number(ev.target.value);
                  if (!Number.isNaN(v) && v !== e.value) intents.initUpdate(e.id, { value: v });
                }}
              />
            ) : (
              <span className="init-value" title="Initiative — the higher number acts first.">{e.value}</span>
            )}
            <span className="init-name">{e.name}{e.hidden ? ' 🕶' : ''}</span>
            {isDm && (
              <span className="init-actions">
                {!cardMode && (
                  <button className="link" title="Re-roll this entry's initiative" onClick={() => intents.initUpdate(e.id, { reroll: true })}>
                    🎲
                  </button>
                )}
                <button className="link" title={e.hidden ? 'Reveal to players' : 'Hide from players'}
                  onClick={() => intents.initUpdate(e.id, { hidden: !e.hidden })}>
                  {e.hidden ? '👁' : '🕶'}
                </button>
                <button className="link danger" onClick={() => intents.initRemove(e.id)}>×</button>
              </span>
            )}
          </li>
        ))}
        {state.entries.length === 0 && !cardMode && <p className="dim">Nobody in initiative yet.</p>}
      </ol>

      {cardMode && pending.length > 0 && (
        <div className="init-pending">
          <span className="dim">Waiting on:</span>
          {pending.map((p) => (
            <span key={p.tokenId} className="init-pending-chip">
              {p.name}{p.hidden ? ' 🕶' : ''}
              {(isDm || p.ownerUserId === you.userId) && (
                <button className="link" title={`Draw a card for ${p.name}`} onClick={() => intents.initCardDraw(p.tokenId)}>🂠</button>
              )}
            </span>
          ))}
        </div>
      )}
      {cardMode && pending.length === 0 && state.entries.length === 0 && (
        <p className="dim">Deck shuffled — nobody dealt in yet.</p>
      )}

      {pendingRolls.length > 0 && (
        <div className="init-pending">
          <span className="dim">Waiting on rolls:</span>
          {pendingRolls.map((p) => (
            <span key={p.tokenId} className="init-pending-chip">
              {p.name}{p.hidden ? ' 🕶' : ''}
              {(isDm || p.ownerUserId === you.userId) && (
                <button className="link" title={`Roll initiative for ${p.name}`} onClick={() => intents.initRollMine(p.tokenId)}>🎲</button>
              )}
            </span>
          ))}
        </div>
      )}

      {isDm && map && (
        <div className="row" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
          {swade ? (
            <>
              <button title="Name the battle, choose who is in it, and shuffle a fresh 54-card action deck" onClick={() => setDealing(true)}>🂠 Deal action cards</button>
              <button title="Also deal to hidden (GM-layer) tokens" onClick={() => intents.initCardCall(map.id, true)}>+ hidden NPCs</button>
            </>
          ) : (
            <>
              <button title="Every combatant rolls their own initiative on their own screen" onClick={() => intents.initRollCall(map.id, false)}>🎲 Call for initiative</button>
              <button title="Also call on hidden (GM-layer) tokens" onClick={() => intents.initRollCall(map.id, true)}>+ hidden NPCs</button>
              <button title="Skip the prompts and roll for every token yourself" onClick={() => intents.initRollMap(map.id, true)}>Roll all myself</button>
            </>
          )}
          <button onClick={() => setSaving(true)}>⚑ Call for save</button>
          {swade && (state.chase
            ? <button title="Tear down the Chase Card track; the fight carries on" onClick={() => intents.chaseEnd()}>🏁 End chase</button>
            : <button title="Lay out a Chase Card track — a chase IS the combat, and deals Action Cards as usual" onClick={() => setChasing(true)}>🏁 Start a chase</button>)}
          {swade && <button title="Spirit roll against something horrific, with the Fear Table for failures" onClick={() => setFearing(true)}>😱 Call for Fear</button>}
          {swade && <button title="An opposed trick — Taunt, a trip, a stare-down — to leave a foe Distracted or Vulnerable" onClick={() => setTesting(true)}>🤼 Call for a Test</button>}
        </div>
      )}
      {saving && <SavePrompt onClose={() => setSaving(false)} />}
      {chasing && <ChasePrompt onClose={() => setChasing(false)} />}
      {dealing && <DealCardsPrompt onClose={() => setDealing(false)} />}
      {fearing && <FearPrompt onClose={() => setFearing(false)} />}
      {testing && <TestPrompt onClose={() => setTesting(false)} />}

      {isDm && state.entries.length > 0 && (
        <div className="row init-controls">
          <button onClick={() => intents.initPrev()}>◀ prev</button>
          <button className="primary" style={{ width: 'auto', flex: 1 }} onClick={() => intents.initNext()}>next ▶</button>
          <button onClick={() => intents.initSort()}>sort</button>
          <button className="link danger" onClick={() => intents.initClear()}>clear</button>
        </div>
      )}

      {/* Reinforcements. A wandering monster that turns up on round four draws
          one card and slots into the order it earns — nobody else redraws,
          because the six people already fighting should not lose the order
          they drew for just because somebody new walked in. */}
      {cardMode && isDm && state.active && (state.pendingDraws ?? []).length === 0 && (
        <div className="stack" style={{ marginTop: 12 }}>
          {selected && !state.entries.some((e) => e.tokenId === selected.id) && (
            <button
              title={`${selected.name} draws one card and joins this round's order. If the card has already gone past, they act next round.`}
              onClick={() => intents.initDealIn(selected.id)}
            >
              🂠 Deal in: {selected.name}
            </button>
          )}
          {selected && state.entries.some((e) => e.tokenId === selected.id) && (
            <p className="dim" style={{ fontSize: 12 }}>{selected.name} is already in the fight.</p>
          )}
          {!selected && <p className="dim" style={{ fontSize: 12 }}>Select a token to deal it into the fight mid-round.</p>}
        </div>
      )}

      {!cardMode && (
        <div className="stack" style={{ marginTop: 12 }}>
          {selected && (
            <button onClick={() => intents.initAdd({ tokenId: selected.id, roll: true })}>
              Roll initiative: {selected.name}
            </button>
          )}
          {!selected && <p className="dim" style={{ fontSize: 12 }}>Select a token to roll it into initiative.</p>}
          {isDm && selected && (
            <button onClick={() => intents.initAdd({ tokenId: selected.id, roll: true, hidden: true })}>
              Roll hidden: {selected.name}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
