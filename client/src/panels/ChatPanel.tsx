import { useEffect, useMemo, useRef, useState } from 'react';
import type { Character, ChatMessage, MemberInfo, TokenView } from 'shared';
import { contentForSystem } from 'shared';
import { intents, useGameStore } from '../store/game';
import { playerColorFor } from '../util/playerColor';
import { DieShape } from '../table/DiceShapes';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface NameHighlights {
  regex: RegExp | null;
  colors: Map<string, string | null>;
}

/** Every currently-known token name (from this viewer's already vision-filtered
 * token list, so secrecy is preserved for free) mapped to the color of the
 * player who controls it, if any. Longer names are matched first so e.g.
 * "Lucky Piper Coldiron" isn't fragmented by a shorter "Piper" match. */
function useNameHighlights(): NameHighlights {
  const tokens = useGameStore((s) => s.tokens);
  const characters = useGameStore((s) => s.characters);
  const members = useGameStore((s) => s.members);
  return useMemo(() => buildNameHighlights(tokens, characters, members), [tokens, characters, members]);
}

function buildNameHighlights(
  tokens: Record<string, TokenView>,
  characters: Character[],
  members: MemberInfo[],
): NameHighlights {
  const colors = new Map<string, string | null>();
  for (const t of Object.values(tokens)) {
    if (!t.name?.trim()) continue;
    let color: string | null = null;
    if (t.characterId) {
      const owner = characters.find((c) => c.id === t.characterId)?.ownerUserId;
      const member = owner ? members.find((m) => m.userId === owner) : undefined;
      if (member) color = playerColorFor(member);
    }
    if (!colors.has(t.name) || (color && !colors.get(t.name))) colors.set(t.name, color);
  }
  if (colors.size === 0) return { regex: null, colors };
  const names = [...colors.keys()].sort((a, b) => b.length - a.length);
  return { regex: new RegExp(`(${names.map(escapeRegExp).join('|')})`, 'g'), colors };
}

/** Bolds any mentioned token name, and colors it if that token is player-controlled. */
function Highlighted({ text, hl }: { text: string; hl: NameHighlights }) {
  if (!hl.regex || !text) return <>{text}</>;
  return (
    <>
      {text.split(hl.regex).map((part, i) =>
        hl.colors.has(part)
          ? <b key={i} style={hl.colors.get(part) ? { color: hl.colors.get(part)! } : undefined}>{part}</b>
          : part,
      )}
    </>
  );
}

/** Beyond this the equation is more clutter than information. */
const MAX_SHOWN_DICE = 20;

/**
 * The roll as its actual faces: a die glyph per rolled value, joined into the
 * sum that produced the total — `[19] + [13] = 32`.
 *
 * Only dice that counted are drawn. Dropped ones (a losing best() arm, the low
 * die of an advantage roll) would break the running sum, and the detail line
 * underneath already spells them out with ~strikethrough~.
 *
 * The trailing modifier is derived as `total - sum(faces)` rather than parsed
 * back out of the expression, so the equation always balances against the
 * total the server actually sent, whatever the expression did to get there.
 */
function DiceEquation({ r }: { r: NonNullable<ChatMessage['roll']> }) {
  const counted = r.dice.filter((d) => d.kept);
  if (counted.length === 0) return null;
  const shown = counted.slice(0, MAX_SHOWN_DICE);
  const hidden = counted.length - shown.length;
  const mod = r.total - counted.reduce((s, d) => s + d.value, 0);
  return (
    <div className="roll-dice">
      {shown.map((d, i) => (
        <span className="roll-die" key={i}>
          {i > 0 && <span className="roll-op">+</span>}
          <DieShape sides={d.sides} size={30} value={d.value} />
        </span>
      ))}
      {hidden > 0 && <span className="roll-op">+ {hidden} more</span>}
      {mod !== 0 && <span className="roll-op">{mod > 0 ? '+' : '−'} {Math.abs(mod)}</span>}
      <span className="roll-op">=</span>
      <span className="roll-eq-total">{r.total}</span>
    </div>
  );
}

function RollCard({ msg, hl }: { msg: ChatMessage; hl: NameHighlights }) {
  const r = msg.roll!;
  // A pass/fail roll (e.g. a saving throw) reuses the crit/fumble green/red
  // theme so it reads at a glance without inventing a separate color scheme.
  const isCrit = r.outcome === 'success' || r.dice.some((d) => d.sides === 20 && d.kept && d.value === 20);
  const isFumble = r.outcome === 'failure' || r.dice.some((d) => d.sides === 20 && d.kept && d.value === 1);
  return (
    <div className={`roll-card ${isCrit ? 'crit' : ''} ${isFumble ? 'fumble' : ''}`}>
      {msg.text && (
        <div className="roll-label">
          <Highlighted text={msg.text} hl={hl} />
          {msg.actionName && <> <ActionTerm name={msg.actionName} /></>}
        </div>
      )}
      <div className="roll-main">
        <span className="roll-expr">{r.expression}</span>
        <span className="roll-total">{r.total}</span>
      </div>
      <DiceEquation r={r} />
      <div className="roll-detail">{r.detail}</div>
      {/* Why it landed, last — the dice come first, the verdict reads as their
          conclusion rather than a spoiler above them. */}
      {msg.outcomeNote && <div className="roll-outcome">{msg.outcomeNote}</div>}
    </div>
  );
}

/**
 * An action's name, underlined and explained on hover. The blurb comes from
 * the compendium entry of the same name — actions are content, not rules
 * vocabulary, so the glossary has nothing to say about them.
 */
function ActionTerm({ name }: { name: string }) {
  const system = useGameStore((s) => s.campaign?.system);
  const entry = system
    ? contentForSystem(system).find((e) => e.name.toLowerCase() === name.toLowerCase())
    : undefined;
  const blurb = entry?.detail?.trim();
  return (
    <span className="action-term" title={blurb || `${name} — no compendium entry`}>
      {name}
    </span>
  );
}

/**
 * Who a message came from. Anything a character did is attributed to the
 * character first — "Kira (jackh)" — because at the table people track the
 * character, not the account. Tinted with that player's colour, the same one
 * used for their presence dot and their tokens' rings.
 */
function ChatFrom({ msg, playerHidden }: { msg: ChatMessage; playerHidden: boolean }) {
  const members = useGameStore((s) => s.members);
  if (playerHidden) return <span className="chat-from">DM</span>;
  const member = msg.fromUserId ? members.find((m) => m.userId === msg.fromUserId) : undefined;
  const color = member ? playerColorFor(member) : null;
  return (
    <span className="chat-from" style={color ? { color } : undefined}>
      {msg.fromCharacter
        ? <>{msg.fromCharacter} <span className="chat-from-player">({msg.fromName})</span></>
        : msg.fromName}
    </span>
  );
}

function Message({ msg, isDm, hl, onMenu }: {
  msg: ChatMessage; isDm: boolean; hl: NameHighlights; onMenu: (id: number, x: number, y: number) => void;
}) {
  const time = new Date(msg.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // Players receive an already-redacted placeholder; the DM sees the original
  // with a "hidden" marker so they can unhide it.
  const playerHidden = msg.hidden && !isDm;
  return (
    <div
      className={`chat-msg ${msg.kind} ${msg.hidden ? 'hidden' : ''}`}
      onContextMenu={isDm ? (e) => { e.preventDefault(); onMenu(msg.id, e.clientX, e.clientY); } : undefined}
    >
      <div className="chat-meta">
        <ChatFrom msg={msg} playerHidden={!!playerHidden} />
        {msg.hidden && isDm && <span className="chat-whisper-tag">hidden</span>}
        {msg.kind === 'whisper' && !playerHidden && (
          <span className="chat-whisper-tag">
            whisper{msg.recipients?.length ? ` → ${msg.recipients.join(', ')}` : ''}
          </span>
        )}
        <span className="chat-time">{time}</span>
      </div>
      {playerHidden
        ? <div className="chat-text hidden-text">The DM has hidden this message.</div>
        : msg.roll ? <RollCard msg={msg} hl={hl} /> : <div className="chat-text"><Highlighted text={msg.text} hl={hl} /></div>}
    </div>
  );
}

export function ChatPanel() {
  const chatLog = useGameStore((s) => s.chatLog);
  const isDm = useGameStore((s) => s.you?.role === 'dm');
  const hl = useNameHighlights();
  const [text, setText] = useState('');
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatLog.length]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); };
  }, [menu]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    intents.chat(text.trim());
    setText('');
  }

  const menuMsg = menu ? chatLog.find((m) => m.id === menu.id) : null;

  return (
    <div className="chat-panel">
      <div className="chat-log" ref={logRef}>
        {chatLog.map((m) => <Message key={m.id} msg={m} isDm={!!isDm} hl={hl} onMenu={(id, x, y) => setMenu({ id, x, y })} />)}
        {chatLog.length === 0 && <p className="dim">Say hi, or roll with /r 1d20+5</p>}
      </div>

      {menu && menuMsg && (
        <div className="chat-context-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menuMsg.hidden ? (
            <button onClick={() => { intents.moderateMessage(menu.id, 'unhide'); setMenu(null); }}>Unhide</button>
          ) : (
            <>
              <button onClick={() => { intents.moderateMessage(menu.id, 'hide'); setMenu(null); }}>Hide</button>
              {menuMsg.kind === 'roll' && (
                <button onClick={() => { intents.moderateMessage(menu.id, 'hideUndo'); setMenu(null); }}>Hide &amp; undo effects</button>
              )}
            </>
          )}
        </div>
      )}

      <form className="chat-input" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="/r 2d6+3 · /w name hi · #macro"
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
