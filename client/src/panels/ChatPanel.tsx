import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from 'shared';
import { intents, useGameStore } from '../store/game';

function RollCard({ msg }: { msg: ChatMessage }) {
  const r = msg.roll!;
  const isCrit = r.dice.some((d) => d.sides === 20 && d.kept && d.value === 20);
  const isFumble = r.dice.some((d) => d.sides === 20 && d.kept && d.value === 1);
  return (
    <div className={`roll-card ${isCrit ? 'crit' : ''} ${isFumble ? 'fumble' : ''}`}>
      {msg.text && <div className="roll-label">{msg.text}</div>}
      <div className="roll-main">
        <span className="roll-expr">{r.expression}</span>
        <span className="roll-total">{r.total}</span>
      </div>
      <div className="roll-detail">{r.detail}</div>
    </div>
  );
}

function Message({ msg, isDm, onMenu }: {
  msg: ChatMessage; isDm: boolean; onMenu: (id: number, x: number, y: number) => void;
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
        <span className="chat-from">{playerHidden ? 'DM' : msg.fromName}</span>
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
        : msg.roll ? <RollCard msg={msg} /> : <div className="chat-text">{msg.text}</div>}
    </div>
  );
}

export function ChatPanel() {
  const chatLog = useGameStore((s) => s.chatLog);
  const isDm = useGameStore((s) => s.you?.role === 'dm');
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
        {chatLog.map((m) => <Message key={m.id} msg={m} isDm={!!isDm} onMenu={(id, x, y) => setMenu({ id, x, y })} />)}
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
