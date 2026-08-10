import { useEffect, useMemo, useRef, useState } from 'react';
import type { Character, ChatMessage, DieRoll, MemberInfo, TokenView } from 'shared';
import { contentForSystem, swadeSnakeEyes } from 'shared';
import { intents, useGameStore } from '../store/game';
import { playerColorFor } from '../util/playerColor';
import { DIE_COLORS, DieShape } from '../table/DiceShapes';
import { DICE_ROLE_DEFAULTS } from '../table/dice3d';
import { AnchoredMenu } from '../util/AnchoredMenu';

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
/** Plain-English glosses for the server's situational modifier tags. */
const TAG_GLOSS: Array<[RegExp, string]> = [
  [/Medium range/i, 'target past the listed (Short) range, within 2×'],
  [/Long range/i, 'target past 2×, within 4× of the listed range'],
  [/Extreme range/i, 'target past 4× the listed range (Aim required)'],
  [/Recoil/i, 'automatic fire (RoF 2+)'],
  [/Multi-Action/i, 'extra action taken this turn'],
  [/Ran/i, 'spent the running die this turn'],
  [/vs Prone/i, 'shooting at a prone target'],
  [/Prone/i, 'fighting from the ground'],
  [/Cover/i, 'target partly behind cover (which also absorbs damage)'],
  [/Dim light/i, 'poor illumination'],
  [/Pitch darkness/i, 'near-total darkness'],
  [/Darkness/i, 'fighting in the dark'],
  [/Wild Attack/i, 'all-out melee: +2 to hit and damage, but Vulnerable'],
  [/The Drop/i, 'the target is dead to rights (Stunned or helpless)'],
  [/Gang Up/i, 'allies crowding the target in melee'],
  [/Aim/i, 'took time to aim'],
  [/Support/i, 'an ally’s Support roll aided this'],
  [/Size/i, 'a bigger target is easier to hit'],
  [/Joker/i, 'drew the Joker this round: +2 to rolls and damage'],
];
function glossTag(tag: string): string {
  const g = TAG_GLOSS.find(([re]) => re.test(tag));
  return g ? `${tag} — ${g[1]}` : tag;
}
const UNSKILLED_WHY = 'Unskilled penalty (−2): the character has no ranked skill for this roll, so it falls back to d4−2 — and the Wild Die takes the −2 too.';

/** Extract the situational tag list ([−4 Long range, −2 Recoil…]) from card text. */
function modTags(text: string | undefined): string[] {
  return (text?.match(/\[([^\]]+)\]/g) ?? [])
    .map((t) => t.slice(1, -1))
    .filter((t) => /[+−-]\s?\d|adv|dis/i.test(t))
    .flatMap((t) => t.split(', '));
}

/**
 * The roll expression with each modifier explained on hover: the unskilled
 * −2 baked into `best(1d4!-2, 1d6!-2)`, and the trailing situational total
 * (range, recoil, wounds…) itemized from the card's own tags.
 */
function whyLines(r: NonNullable<ChatMessage['roll']>, text?: string): string[] {
  // Server-itemized sources first (wounds/fatigue/conditions + situational
  // tags); older cards fall back to parsing the tags out of the text.
  const base = r.modWhy?.length ? r.modWhy : modTags(text);
  return [
    ...(r.expression.includes('!-2') ? [UNSKILLED_WHY] : []),
    ...base.map(glossTag),
  ];
}

/** Named source for a modifier we have no itemized breakdown for — always
 *  specific about WHERE it comes from, never a shrug. */
function fallbackWhy(system: string | undefined): string {
  return system === 'swade'
    ? 'Flat modifier written into this roll’s expression: a weapon or gear bonus, or a manual /r modifier.'
    : 'Sheet math: the ability-score modifier plus proficiency/skill bonus for this roll.';
}

function ExprWithWhy({ r, text }: { r: NonNullable<ChatMessage['roll']>; text?: string }) {
  const system = useGameStore((s) => s.campaign?.system);
  const expr = r.expression;
  const lines = whyLines(r, text).filter((l) => l !== UNSKILLED_WHY);
  const tailWhy = lines.length ? `This modifier combines:\n• ${lines.join('\n• ')}` : fallbackWhy(system);
  // Trailing +N/−N after the dice = the folded situational/wound total.
  const tail = expr.match(/([+−-]\d+)\s*$/);
  const head = tail ? expr.slice(0, tail.index) : expr;
  // The unskilled fallback's own −2s inside the head get their own story.
  const headParts = head.split(/(!-2)/g);
  return (
    <span className="roll-expr">
      {headParts.map((p, i) => p === '!-2'
        ? <span key={i}>!<span className="mod-why" title={UNSKILLED_WHY}>-2</span></span>
        : <span key={i}>{p}</span>)}
      {tail && <span className="mod-why" title={tailWhy}>{tail[1]}</span>}
    </span>
  );
}

function DiceEquation({ r, why, fromUserId }: {
  r: NonNullable<ChatMessage['roll']>; why?: string; fromUserId?: string | null;
}) {
  const counted = r.dice.filter((d) => d.kept);
  const system = useGameStore((s) => s.campaign?.system);
  const member = useGameStore((s) => (fromUserId ? s.members.find((m) => m.userId === fromUserId) : undefined));
  if (counted.length === 0) return null;
  const shown = counted.slice(0, MAX_SHOWN_DICE);
  const hidden = counted.length - shown.length;
  const mod = r.total - counted.reduce((s, d) => s + d.value, 0);
  // The equation's flat modifier is the SUM of everything: itemize it.
  const lines = whyLines(r, why);
  const modTitle = lines.length
    ? `This modifier combines:\n• ${lines.join('\n• ')}`
    : fallbackWhy(system);
  // Paint each die the same colour it wore on the table: SWADE tells trait /
  // Wild Die / raise apart by hue from the roller's palette; other systems
  // use the roller's single custom colour or the by-size default.
  const dieFill = (d: DieRoll): string => (system === 'swade'
    ? (d.raise ? member?.diceRaiseColor ?? DICE_ROLE_DEFAULTS.raise
      : d.wild ? member?.diceWildColor ?? DICE_ROLE_DEFAULTS.wild
        : member?.diceTraitColor ?? DICE_ROLE_DEFAULTS.trait)
    : member?.diceColor ?? DIE_COLORS[d.sides] ?? '#9aa1b3');
  const dieTitle = (d: DieRoll): string => [
    `d${d.sides}: ${d.value}`,
    ...(d.raise ? ['Raise bonus die — earned by beating the target number by 4+'] : []),
    ...(d.wild ? ['Wild Die — rolled alongside the trait die; the better arm counts'] : []),
    ...(d.ace ? ['Aced! Rolled its maximum and exploded into the next die'] : []),
  ].join('\n');
  return (
    <div className="roll-dice">
      {shown.map((d, i) => (
        <span className="roll-die" key={i} title={dieTitle(d)}>
          {i > 0 && <span className="roll-op">+</span>}
          <DieShape
            sides={d.sides}
            size={30}
            value={d.value}
            fill={dieFill(d)}
            textFill={system !== 'swade' ? member?.diceTextColor ?? undefined : undefined}
          />
        </span>
      ))}
      {hidden > 0 && <span className="roll-op">+ {hidden} more</span>}
      {mod !== 0 && (
        <span className="roll-op" style={{ cursor: 'help', textDecoration: 'underline dotted' }} title={modTitle}>
          {mod > 0 ? '+' : '−'} {Math.abs(mod)}
        </span>
      )}
      <span className="roll-op">=</span>
      <span className="roll-eq-total">{r.total}</span>
    </div>
  );
}

function RollCard({ msg, hl }: { msg: ChatMessage; hl: NameHighlights }) {
  const r = msg.roll!;
  const system = useGameStore((s) => s.campaign?.system);
  // A pass/fail roll (e.g. a saving throw) reuses the crit/fumble green/red
  // theme so it reads at a glance without inventing a separate color scheme.
  const isCrit = r.outcome === 'success' || r.dice.some((d) => d.sides === 20 && d.kept && d.value === 20);
  const isFumble = r.outcome === 'failure' || r.dice.some((d) => d.sides === 20 && d.kept && d.value === 1);
  // SWADE snake eyes — trait die AND Wild Die both showing 1. Read straight off
  // the dice, so it lights up for every roll from every source (attacks, saves,
  // trait rolls, a cooked grenade) without the server tagging each one.
  const snakeEyes = system === 'swade' && swadeSnakeEyes(r.dice);
  return (
    <div className={`roll-card ${isCrit ? 'crit' : ''} ${isFumble || snakeEyes ? 'fumble' : ''} ${snakeEyes ? 'critfail' : ''}`}>
      {snakeEyes && <div className="critfail-banner">💀 Snake Eyes — Critical Failure</div>}
      {msg.text && (
        <div className="roll-label">
          <Highlighted text={msg.text} hl={hl} />
          {msg.actionName && <> <ActionTerm name={msg.actionName} /></>}
        </div>
      )}
      <div className="roll-main">
        <ExprWithWhy r={r} text={msg.text} />
        <span className="roll-total">{r.total}</span>
      </div>
      <DiceEquation r={r} why={msg.text} fromUserId={msg.fromUserId} />
      <div className="roll-detail">
        {r.detail}
        {r.iron && (
          <span
            className="iron-badge"
            title={`🛡 IronDice — rolled server-side from a cryptographic keystream, provably fair.\nRoll #${r.iron.idx} · expression ${r.expression}\nSeed commitment ${r.iron.commit}\nVerify it from the 🛡 IronDice panel once the seed is revealed.`}
          >
            🛡
          </span>
        )}
      </div>
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
 * character, not the account.
 *
 * Deliberately the same dim grey as the timestamp beside it: the byline is
 * metadata, and colouring it per-player put a row of competing brights above
 * every message, pulling the eye off the roll cards that actually matter. Who
 * is who is still legible from the presence dots and the token rings.
 */
function ChatFrom({ msg, playerHidden }: { msg: ChatMessage; playerHidden: boolean }) {
  if (playerHidden) return <span className="chat-from">DM</span>;
  return (
    <span className="chat-from">
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
        <AnchoredMenu x={menu.x} y={menu.y} className="chat-context-menu" onClick={(e) => e.stopPropagation()}>
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
        </AnchoredMenu>
      )}

      <form className="chat-input" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="/r 2d6+3 · /w name (or dm) hi · #macro"
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
