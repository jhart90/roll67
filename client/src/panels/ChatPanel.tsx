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

function Message({ msg }: { msg: ChatMessage }) {
  const time = new Date(msg.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={`chat-msg ${msg.kind}`}>
      <div className="chat-meta">
        <span className="chat-from">{msg.fromName}</span>
        {msg.kind === 'whisper' && (
          <span className="chat-whisper-tag">
            whisper{msg.recipients?.length ? ` → ${msg.recipients.join(', ')}` : ''}
          </span>
        )}
        <span className="chat-time">{time}</span>
      </div>
      {msg.roll ? <RollCard msg={msg} /> : <div className="chat-text">{msg.text}</div>}
    </div>
  );
}

export function ChatPanel() {
  const chatLog = useGameStore((s) => s.chatLog);
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatLog.length]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    intents.chat(text.trim());
    setText('');
  }

  return (
    <div className="chat-panel">
      <div className="chat-log" ref={logRef}>
        {chatLog.map((m) => <Message key={m.id} msg={m} />)}
        {chatLog.length === 0 && <p className="dim">Say hi, or roll with /r 1d20+5</p>}
      </div>
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
