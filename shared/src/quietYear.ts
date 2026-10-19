// The Quiet Year (Avery Alder, Buried Without Ceremony): a map-drawing game
// about a community's one year of peace before the Frost Shepherds come.
//
// This module is the whole game's rules engine, kept pure so the server only
// persists and broadcasts what it returns. It holds the MECHANICS — the
// season-stacked deck, the week's three phases, project dice, discussions,
// Contempt, the Abundance/Scarcity lists — and none of the book's prose.
//
// The card prompts are NOT here, and must not be: they are the published
// game. A group plays with their own copy, either reading the physical card
// that matches the one drawn, or by pasting the text of the deck they own into
// `parseOracle`, which stores it on THEIR campaign. What the app learns from
// that text is only its rules ("do not reduce project dice this week"), so a
// card's mechanics apply themselves when the prompt is chosen.

export type QySeason = 'spring' | 'summer' | 'autumn' | 'winter';

export const QY_SEASONS: ReadonlyArray<{ id: QySeason; label: string; suit: string; suitName: string }> = [
  { id: 'spring', label: 'Spring', suit: '♥', suitName: 'Hearts' },
  { id: 'summer', label: 'Summer', suit: '♦', suitName: 'Diamonds' },
  { id: 'autumn', label: 'Autumn', suit: '♣', suitName: 'Clubs' },
  { id: 'winter', label: 'Winter', suit: '♠', suitName: 'Spades' },
];

export const QY_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

/** The card that ends the game the moment it is drawn. */
export const QY_FINAL_CARD = 'winter-K';
/** The card a shortened ("fleeting") year always takes out. */
const QY_FLEETING_REMOVED = 'summer-K';
/** Contempt is a fixed pool on the table. */
export const QY_CONTEMPT_POOL = 16;

export function qyCardId(season: QySeason, rank: string): string {
  return `${season}-${rank}`;
}
export function qySeasonOf(cardId: string): QySeason {
  return cardId.split('-')[0] as QySeason;
}
export function qyCardLabel(cardId: string): string {
  const [season, rank] = cardId.split('-');
  const s = QY_SEASONS.find((x) => x.id === season);
  return s ? `${rank}${s.suit} · ${s.label}` : cardId;
}

export interface QyProject {
  id: string;
  text: string;
  weeksLeft: number;
  startedBy: string;
  startedByName: string;
  startedWeek: number;
  /** Put down this week by a card: it does not tick until next week. */
  fresh?: boolean;
}

export type QyLogKind = 'card' | 'project' | 'discover' | 'discussion' | 'contempt' | 'list' | 'names' | 'system';
export interface QyLogEntry { id: number; week: number; kind: QyLogKind; by: string; text: string }

export interface QyDiscussion {
  openerId: string;
  openerName: string;
  kind: 'question' | 'statement';
  opening: string;
  /** Who still gets to weigh in, in turn order. */
  waiting: string[];
  statements: Array<{ userId: string; name: string; text: string }>;
}

export interface QySeat { userId: string; name: string }

export interface QyState {
  phase: 'setup' | 'play' | 'over';
  /** The shorter game: five cards out of each suit. */
  fleeting: boolean;
  seats: QySeat[];
  activeSeat: number;
  /** Cards played so far — the week number. */
  week: number;
  /** Remaining deck, top first. */
  deck: string[];
  played: string[];
  current: { cardId: string; choice: number | null } | null;
  /** Where the active week stands. */
  step: 'card' | 'dice' | 'action' | 'done';
  /** This week's card says the dice stay where they are. */
  skipDice: boolean;
  /** How far the dice move this week: 1, or 2 when a card says so. */
  diceStep: number;
  actionsLeft: number;
  projects: QyProject[];
  abundances: string[];
  scarcities: string[];
  /** The index card for names. */
  names: string[];
  contempt: Record<string, number>;
  discussion: QyDiscussion | null;
  setup: { terrain: string; resources: Array<{ userId: string; name: string; resource: string }> };
  log: QyLogEntry[];
  /** The group's own deck text, keyed by card id: one entry per option. */
  oracle: Record<string, string[]> | null;
  nextId: number;
}

export function qyInitialState(): QyState {
  return {
    phase: 'setup', fleeting: false, seats: [], activeSeat: 0, week: 0,
    deck: [], played: [], current: null, step: 'card', skipDice: false, diceStep: 1, actionsLeft: 1,
    projects: [], abundances: [], scarcities: [], names: [], contempt: {},
    discussion: null, setup: { terrain: '', resources: [] }, log: [], oracle: null, nextId: 1,
  };
}

/** Normalise whatever was stored (an older shape, a hand-edited row). */
export function qyNormalize(raw: unknown): QyState {
  const base = qyInitialState();
  if (!raw || typeof raw !== 'object') return base;
  return { ...base, ...(raw as Partial<QyState>), setup: { ...base.setup, ...((raw as QyState).setup ?? {}) } };
}

type Rng = () => number;
function shuffle<T>(list: T[], rng: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The year as a stack: each season shuffled on its own, Spring on top and
 * Winter at the bottom, so the seasons arrive in order while the weeks inside
 * them do not. A fleeting year takes five cards out of every suit — always
 * including the King of Diamonds, never the King of Spades.
 */
export function qyBuildDeck(fleeting: boolean, rng: Rng = Math.random): string[] {
  const out: string[] = [];
  for (const s of QY_SEASONS) {
    let cards = QY_RANKS.map((r) => qyCardId(s.id, r));
    if (fleeting) {
      const keep = (id: string) => id !== QY_FINAL_CARD;
      const forced = cards.filter((id) => id === QY_FLEETING_REMOVED);
      const pool = shuffle(cards.filter((id) => keep(id) && id !== QY_FLEETING_REMOVED), rng);
      const removed = new Set([...forced, ...pool.slice(0, 5 - forced.length)]);
      cards = cards.filter((id) => !removed.has(id));
    }
    out.push(...shuffle(cards, rng));
  }
  return out;
}

// ---------------------------------------------------------------- the oracle

const HEADER = /^\s*(A|[2-9]|10|J|Q|K)\s+(Spring|Summer|Autumn|Fall|Winter)\s*$/i;
const DIVIDER = /^\s*or\s*(\.\.\.|…)\s*$/i;
const BULLET = /^[•·▪●]\s*/;

/**
 * Which cards offer two prompts to choose between — game STRUCTURE, the same
 * fact as "the deck has 52 cards", not any card's words. Printed decks draw
 * the divider between the two as a graphic, so copied text often has no
 * "or..." to split on; knowing a card has two lets the importer find the seam.
 */
const QY_TWO_PROMPT_CARDS = new Set([
  ...['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].map((r) => `spring-${r}`),
  ...['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J'].map((r) => `summer-${r}`),
  ...['2', '3', '4', '5', '6', '7', '8', '9', '10'].map((r) => `autumn-${r}`),
  ...['A', '3', '4', '5', '6'].map((r) => `winter-${r}`),
]);

const QUESTION_START = /^(who|what|where|when|why|how|is|are|do|does|did|can|could|will|would|if)\b/i;

/** The divider sometimes lands mid-line once the text is copied out. */
const INLINE_DIVIDER = /\s+or\s*(?:\.\.\.|…)\s+/i;
/** A back-reference to what the sentence before set up ("What sets THEM
 *  apart?") marks a follow-up question rather than a fresh prompt. */
const BACK_REFERENCE = /\b(they|them|their|it|its|he|him|his|she|her)\b/i;

/**
 * Two prompts run together with no divider: pick the sentence boundary that
 * most looks like the seam. Printed cards start each prompt on a new line,
 * the second prompt usually opens the way the first did ("Outsiders
 * arrive…" / "Outsiders arrive…"), the first usually ends on a question, and
 * the second is not a follow-up that leans on the first ("Who?", "What sets
 * them apart?").
 */
function splitTwo(lines: string[]): string[] {
  // Sentences, each remembering whether it began a printed line.
  const parts: Array<{ text: string; lineStart: boolean }> = [];
  for (const line of lines) {
    line.split(/(?<=[.?!][”"']?)\s+(?=[A-Z“"])/).forEach((sent, i) => {
      const t = sent.trim();
      if (t) parts.push({ text: t, lineStart: i === 0 });
    });
  }
  if (parts.length < 2) return [lines.join(' ')];
  const words = (x: string, n: number) => x.split(/\s+/).slice(0, n).join(' ').toLowerCase();
  const total = parts.reduce((n, p) => n + p.text.length, 0);
  let best = 1;
  let bestScore = -Infinity;
  for (let i = 1; i < parts.length; i++) {
    const leftLen = parts.slice(0, i).reduce((n, p) => n + p.text.length, 0);
    const next = parts[i].text;
    let score = 0;
    if (parts[i].lineStart) score += 3;
    if (words(next, 2) === words(parts[0].text, 2)) score += 4;
    else if (words(next, 1) === words(parts[0].text, 1)) score += 2;
    if (/[?][”"']?$/.test(parts[i - 1].text)) score += 2;
    if (QUESTION_START.test(next) && next.split(/\s+/).length <= 3) score -= 4;
    if (QUESTION_START.test(next) && BACK_REFERENCE.test(next)) score -= 3;
    score -= Math.abs(leftLen - (total - leftLen)) / total;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return [parts.slice(0, best).map((p) => p.text).join(' '), parts.slice(best).map((p) => p.text).join(' ')];
}

/** "Choose one:" cards: each bullet is its own choice, under the shared lead. */
function splitBullets(lines: string[]): string[] {
  const lead: string[] = [];
  const bullets: string[][] = [];
  for (const line of lines) {
    if (BULLET.test(line)) { bullets.push([line.replace(BULLET, '')]); continue; }
    if (bullets.length === 0) lead.push(line);
    else bullets[bullets.length - 1].push(line);
  }
  const head = lead.join(' ');
  return bullets.map((b) => `${head}\n• ${b.join(' ')}`);
}

/** "Or, if there were no projects underway, …" is a choice of its own. */
function splitOrIf(option: string): string[] {
  const at = option.search(/(?<=[.?!])\s+Or, if\b/);
  if (at < 0) return [option];
  return [option.slice(0, at).trim(), option.slice(at).trim()];
}

/**
 * Read a deck's text, as copied out of the PDF a group owns: blocks headed
 * "8 Spring", "K Winter" and so on. Anything before the first header (a title
 * page) and from a "Turn Summary" onwards is ignored.
 */
export function parseOracle(text: string): { cards: Record<string, string[]>; found: number; missing: string[] } {
  const blocks: Record<string, string[]> = {};
  let cur: string | null = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (/^turn summary/i.test(line)) break;
    const h = HEADER.exec(line);
    if (h) {
      const season = h[2].toLowerCase() === 'fall' ? 'autumn' : h[2].toLowerCase();
      cur = qyCardId(season as QySeason, h[1].toUpperCase());
      blocks[cur] = [];
      continue;
    }
    if (cur && line) blocks[cur].push(line);
  }
  const cards: Record<string, string[]> = {};
  for (const [id, lines] of Object.entries(blocks)) {
    let options: string[];
    if (lines.some((l) => DIVIDER.test(l))) {
      const groups: string[][] = [[]];
      for (const l of lines) {
        if (DIVIDER.test(l)) groups.push([]);
        else groups[groups.length - 1].push(l);
      }
      options = groups.map((g) => g.join(' '));
    } else if (INLINE_DIVIDER.test(` ${lines.join(' ')} `)) {
      options = lines.join(' ').split(INLINE_DIVIDER);
    } else if (lines.some((l) => BULLET.test(l))) {
      options = splitBullets(lines);
    } else if (QY_TWO_PROMPT_CARDS.has(id)) {
      options = splitTwo(lines);
    } else {
      options = [lines.join(' ')];
    }
    options = options.flatMap(splitOrIf).map((o) => o.replace(/[ \t]+/g, ' ').trim()).filter((o) => o.length > 0);
    if (options.length > 0) cards[id] = options;
  }
  const all = QY_SEASONS.flatMap((s) => QY_RANKS.map((r) => qyCardId(s.id, r)));
  return { cards, found: Object.keys(cards).length, missing: all.filter((id) => !cards[id]) };
}

/** The mechanical rules a chosen option carries, read from its own words. */
export function qyRuleHints(optionText: string): {
  skipDice: boolean; discardTwo: boolean; twoActions: boolean; endsWeek: boolean; extraDiscussion: boolean;
  /** How far the project dice move this week (normally 1). */
  diceStep: number;
} {
  const t = optionText.toLowerCase();
  return {
    skipDice: /do not reduce project dice/.test(t),
    discardTwo: /discard the top two cards/.test(t),
    twoActions: /take two actions/.test(t),
    endsWeek: /the week ends immediately/.test(t),
    extraDiscussion: /hold a discussion about this \(in addition/.test(t),
    diceStep: /reduce all remaining projects by 2/.test(t) ? 2 : 1,
  };
}

// ---------------------------------------------------------------- actions

export type QyAction =
  | { type: 'setSeats'; seats: QySeat[] }
  | { type: 'setFleeting'; fleeting: boolean }
  | { type: 'setTerrain'; text: string }
  | { type: 'nameResource'; resource: string }
  | { type: 'start'; abundance: string }
  | { type: 'draw' }
  | { type: 'choose'; option: number }
  | { type: 'setSkipDice'; skip: boolean }
  | { type: 'adjustDice' }
  | { type: 'discover'; text: string }
  | { type: 'startProject'; text: string; weeks: number }
  | { type: 'openDiscussion'; kind: 'question' | 'statement'; text: string }
  | { type: 'weighIn'; text: string }
  | { type: 'passWeighIn' }
  | { type: 'endWeek' }
  | { type: 'projectFail'; id: string }
  | { type: 'projectFinish'; id: string }
  | { type: 'projectAdjust'; id: string; delta: number }
  | { type: 'discardCards'; count: number }
  | { type: 'addExtraAction' }
  | { type: 'list'; list: 'abundances' | 'scarcities' | 'names'; op: 'add' | 'remove'; text: string }
  | { type: 'takeContempt' }
  | { type: 'discardContempt' }
  | { type: 'importOracle'; text: string }
  | { type: 'clearOracle' }
  | { type: 'reset' };

export interface QyActor { userId: string; name: string; isDm: boolean }
export interface QyResult { state: QyState; error?: string; announce?: string[] }

const DM_ONLY = new Set<QyAction['type']>(['setSeats', 'setFleeting', 'start', 'importOracle', 'clearOracle', 'reset', 'discardCards', 'addExtraAction']);
/** The active player runs their own week; the facilitator can step in. */
const ACTIVE_ONLY = new Set<QyAction['type']>([
  'draw', 'choose', 'setSkipDice', 'adjustDice', 'discover', 'startProject', 'openDiscussion', 'endWeek',
  'projectFail', 'projectFinish', 'projectAdjust',
]);

export function qyContemptHeld(s: QyState): number {
  return Object.values(s.contempt).reduce((a, b) => a + b, 0);
}

export function qyActiveSeat(s: QyState): QySeat | null {
  return s.seats.length ? s.seats[s.activeSeat % s.seats.length] : null;
}

/** Apply one action. Pure: returns a new state, an error, or both untouched. */
export function qyApply(prev: QyState, action: QyAction, actor: QyActor, rng: Rng = Math.random): QyResult {
  const s: QyState = structuredClone(prev);
  const announce: string[] = [];
  const fail = (error: string): QyResult => ({ state: prev, error });
  const log = (kind: QyLogKind, text: string, by = actor.name) => {
    s.log.push({ id: s.nextId++, week: s.week, kind, by, text });
    if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
  };
  const active = qyActiveSeat(s);
  const isActive = !!active && active.userId === actor.userId;

  if (DM_ONLY.has(action.type) && !actor.isDm) return fail('Only the facilitator can do that.');
  if (ACTIVE_ONLY.has(action.type)) {
    if (s.phase === 'setup') return fail('The year has not started.');
    if (s.phase === 'over') return fail('The year is over.');
    if (!isActive && !actor.isDm) return fail(`It is ${active?.name ?? 'someone else'}’s week.`);
  }
  const spendAction = () => {
    s.actionsLeft = Math.max(0, s.actionsLeft - 1);
    if (s.actionsLeft === 0) s.step = 'done';
  };
  const needAction = (): string | null => {
    if (s.step !== 'action') return s.step === 'done' ? 'This week’s action is spent — end the week.' : 'Play the card and adjust the dice first.';
    if (s.discussion) return 'A discussion is still going.';
    return null;
  };
  const project = (id: string) => s.projects.find((p) => p.id === id);
  const finishProject = (p: QyProject, how: string) => {
    s.projects = s.projects.filter((x) => x.id !== p.id);
    log('project', `${how}: ${p.text} (${p.startedByName} tells how it turns out)`);
    announce.push(`🎲 Project complete — ${p.text}. ${p.startedByName} tells everyone how it turns out.`);
  };

  switch (action.type) {
    case 'setSeats': {
      if (s.phase === 'over') return fail('The year is over.');
      const seen = new Set<string>();
      s.seats = action.seats.filter((x) => x.userId && !seen.has(x.userId) && seen.add(x.userId))
        .map((x) => ({ userId: x.userId, name: String(x.name).slice(0, 40) }));
      s.activeSeat = 0;
      break;
    }
    case 'setFleeting':
      if (s.phase !== 'setup') return fail('The deck is already built.');
      s.fleeting = action.fleeting;
      break;
    case 'setTerrain':
      if (s.phase !== 'setup') return fail('The year has begun.');
      s.setup.terrain = action.text.slice(0, 500);
      break;
    case 'nameResource': {
      if (s.phase !== 'setup') return fail('The year has begun.');
      const r = action.resource.trim().slice(0, 80);
      s.setup.resources = s.setup.resources.filter((x) => x.userId !== actor.userId);
      if (r) s.setup.resources.push({ userId: actor.userId, name: actor.name, resource: r });
      break;
    }
    case 'start': {
      if (s.phase !== 'setup') return fail('The year has already begun.');
      if (s.seats.length === 0) return fail('Seat the players first.');
      const named = s.setup.resources.map((x) => x.resource);
      const abundance = action.abundance.trim();
      if (!abundance) return fail('Choose which resource is in Abundance.');
      s.abundances = [abundance];
      s.scarcities = named.filter((r) => r !== abundance);
      s.deck = qyBuildDeck(s.fleeting, rng);
      s.played = [];
      s.week = 0;
      s.activeSeat = 0;
      s.step = 'card';
      s.current = null;
      s.phase = 'play';
      log('system', `The year begins${s.fleeting ? ' — a fleeting one' : ''}. Abundance: ${abundance}. Scarcity: ${s.scarcities.join(', ') || 'none named'}.`);
      announce.push(`🌱 The Quiet Year begins. ${s.seats[0].name} plays the first week.`);
      break;
    }
    case 'draw': {
      if (s.step !== 'card' || s.current) return fail('This week’s card is already drawn.');
      const cardId = s.deck.shift();
      if (!cardId) return fail('The deck is empty.');
      s.week += 1;
      s.played.push(cardId);
      s.current = { cardId, choice: null };
      log('card', `draws ${qyCardLabel(cardId)}`);
      announce.push(`🃏 Week ${s.week} — ${actor.name} draws ${qyCardLabel(cardId)}.`);
      if (cardId === QY_FINAL_CARD) {
        s.phase = 'over';
        s.step = 'done';
        log('system', 'The Frost Shepherds arrive. The year is over.');
        announce.push('❄ The Frost Shepherds arrive. The game is over.');
      }
      break;
    }
    case 'choose': {
      if (!s.current || s.step !== 'card') return fail('Draw a card first.');
      const opts = s.oracle?.[s.current.cardId] ?? [];
      const option = Math.max(0, Math.floor(action.option));
      if (opts.length > 0 && option >= opts.length) return fail('That card has no such option.');
      s.current.choice = option;
      const text = opts[option] ?? '';
      const hints = qyRuleHints(text);
      s.skipDice = hints.skipDice;
      s.diceStep = hints.diceStep;
      s.actionsLeft = hints.twoActions ? 2 : 1;
      if (hints.extraDiscussion) s.actionsLeft += 1;
      if (hints.discardTwo) {
        const gone = s.deck.splice(0, 2);
        if (gone.length) log('card', `discards ${gone.map(qyCardLabel).join(' and ')} unseen`);
        // A discard can bury the Frost Shepherds' card no more than it can
        // skip Winter — put it back on top if it went.
        if (gone.includes(QY_FINAL_CARD)) s.deck.unshift(QY_FINAL_CARD);
      }
      log('card', opts.length ? `chooses: ${text.split('\n')[0]}` : `chooses option ${option + 1}`);
      s.step = hints.endsWeek ? 'done' : 'dice';
      if (hints.endsWeek) s.actionsLeft = 0;
      break;
    }
    case 'setSkipDice':
      if (s.step !== 'card' && s.step !== 'dice') return fail('The dice have already moved this week.');
      s.skipDice = action.skip;
      break;
    case 'adjustDice': {
      if (s.step === 'card') {
        if (!s.current) return fail('Draw a card first.');
        s.current.choice ??= 0;
      } else if (s.step !== 'dice') return fail('The dice have already moved this week.');
      if (s.skipDice) {
        log('project', 'the project dice stay where they are this week');
      } else {
        for (const p of [...s.projects]) {
          if (p.fresh) continue;
          p.weeksLeft -= s.diceStep || 1;
          if (p.weeksLeft <= 0) finishProject(p, 'Completed');
        }
      }
      for (const p of s.projects) delete p.fresh;
      s.step = s.actionsLeft > 0 ? 'action' : 'done';
      break;
    }
    case 'discover': {
      const why = needAction();
      if (why) return fail(why);
      const text = action.text.trim().slice(0, 300);
      if (!text) return fail('Describe what is discovered.');
      log('discover', `discovers: ${text}`);
      announce.push(`🗺 ${actor.name} discovers something new: ${text}`);
      spendAction();
      break;
    }
    case 'startProject': {
      // A card can start a project before the dice move ("start a project to
      // reflect"); that die is fresh and does not tick this week.
      const byCard = s.step === 'card' || s.step === 'dice';
      if (!byCard) {
        const why = needAction();
        if (why) return fail(why);
      }
      const text = action.text.trim().slice(0, 200);
      const weeks = Math.floor(action.weeks);
      if (!text) return fail('Say what the community will do.');
      if (!(weeks >= 1 && weeks <= 6)) return fail('A project takes 1 to 6 weeks — longer ones go in stages.');
      s.projects.push({
        id: `p${s.nextId++}`, text, weeksLeft: weeks, startedBy: actor.userId, startedByName: actor.name,
        startedWeek: s.week, ...(byCard ? { fresh: true } : {}),
      });
      log('project', `starts a project (${weeks} week${weeks === 1 ? '' : 's'}): ${text}`);
      announce.push(`🎲 ${actor.name} starts a project — ${text} (${weeks} week${weeks === 1 ? '' : 's'}).`);
      if (!byCard) spendAction();
      break;
    }
    case 'openDiscussion': {
      const why = needAction();
      if (why) return fail(why);
      const text = action.text.trim().slice(0, 300);
      if (!text) return fail('Open with a question or a statement.');
      const n = s.seats.length;
      const start = s.seats.findIndex((x) => x.userId === actor.userId);
      const from = start >= 0 ? start : s.activeSeat;
      // Clockwise from the opener; a question lets them weigh in last.
      const others = Array.from({ length: n - 1 }, (_, i) => s.seats[(from + 1 + i) % n].userId);
      s.discussion = {
        openerId: actor.userId, openerName: actor.name, kind: action.kind, opening: text,
        waiting: action.kind === 'question' ? [...others, actor.userId] : others,
        statements: [],
      };
      log('discussion', `opens a discussion with a ${action.kind}: ${text}`);
      announce.push(`💬 ${actor.name} holds a discussion: “${text}”`);
      if (s.discussion.waiting.length === 0) { s.discussion = null; spendAction(); }
      break;
    }
    case 'weighIn':
    case 'passWeighIn': {
      const d = s.discussion;
      if (!d) return fail('No discussion is going.');
      const next = d.waiting[0];
      if (next !== actor.userId && !actor.isDm) return fail('Wait your turn to weigh in.');
      const who = s.seats.find((x) => x.userId === next);
      if (action.type === 'weighIn') {
        const text = action.text.trim().slice(0, 300);
        if (!text) return fail('Say one or two sentences.');
        d.statements.push({ userId: next, name: who?.name ?? actor.name, text });
        log('discussion', text, who?.name ?? actor.name);
        announce.push(`💬 ${who?.name ?? actor.name}: “${text}”`);
      } else {
        log('discussion', 'stays silent', who?.name ?? actor.name);
      }
      d.waiting.shift();
      if (d.waiting.length === 0) {
        s.discussion = null;
        log('discussion', 'the discussion ends without a decision — mark the situation with a dot');
        spendAction();
      }
      break;
    }
    case 'endWeek': {
      if (s.discussion) return fail('Finish the discussion first.');
      if (!s.current) return fail('Draw this week’s card first.');
      s.current = null;
      s.step = 'card';
      s.skipDice = false;
      s.diceStep = 1;
      s.actionsLeft = 1;
      s.activeSeat = s.seats.length ? (s.activeSeat + 1) % s.seats.length : 0;
      const next = qyActiveSeat(s);
      log('system', `week ${s.week} ends`);
      if (next) announce.push(`➡ ${next.name}’s week.`);
      break;
    }
    case 'projectFail': {
      const p = project(action.id);
      if (!p) return fail('No such project.');
      s.projects = s.projects.filter((x) => x.id !== p.id);
      log('project', `the project fails: ${p.text}`);
      announce.push(`✖ A project fails — ${p.text}.`);
      break;
    }
    case 'projectFinish': {
      const p = project(action.id);
      if (!p) return fail('No such project.');
      // Finished early by a card: the active player narrates, not its starter.
      s.projects = s.projects.filter((x) => x.id !== p.id);
      log('project', `finishes early: ${p.text}`);
      announce.push(`✔ A project finishes early — ${p.text}. ${actor.name} tells how it turns out.`);
      break;
    }
    case 'projectAdjust': {
      const p = project(action.id);
      if (!p) return fail('No such project.');
      p.weeksLeft = Math.max(0, Math.min(12, p.weeksLeft + Math.round(action.delta)));
      log('project', `${action.delta > 0 ? 'adds' : 'takes'} ${Math.abs(action.delta)} week${Math.abs(action.delta) === 1 ? '' : 's'} ${action.delta > 0 ? 'to' : 'off'}: ${p.text}`);
      if (p.weeksLeft === 0) finishProject(p, 'Completed');
      break;
    }
    case 'discardCards': {
      if (s.phase !== 'play') return fail('The year has not started.');
      const n = Math.max(1, Math.min(5, Math.floor(action.count)));
      // Never discard the Frost Shepherds unseen: the year ends when they are DRAWN.
      const gone = s.deck.splice(0, n);
      if (gone.includes(QY_FINAL_CARD)) s.deck.unshift(QY_FINAL_CARD);
      log('card', `discards ${gone.filter((id) => id !== QY_FINAL_CARD).map(qyCardLabel).join(', ') || 'nothing'} unseen`);
      break;
    }
    case 'addExtraAction':
      if (s.phase !== 'play') return fail('The year has not started.');
      s.actionsLeft += 1;
      if (s.step === 'done' && s.current) s.step = 'action';
      log('system', 'an extra action this week');
      break;
    case 'list': {
      const text = action.text.trim().slice(0, 80);
      if (!text) return fail('Name it.');
      const list = s[action.list];
      const label = action.list === 'abundances' ? 'Abundance' : action.list === 'scarcities' ? 'Scarcity' : 'name';
      if (action.op === 'add') {
        if (!list.includes(text)) list.push(text);
        log(action.list === 'names' ? 'names' : 'list', `adds ${label === 'name' ? 'the name' : `an ${label}`}: ${text}`);
      } else {
        s[action.list] = list.filter((x) => x !== text);
        log(action.list === 'names' ? 'names' : 'list', `removes ${label === 'name' ? 'the name' : `the ${label}`}: ${text}`);
      }
      break;
    }
    case 'takeContempt': {
      if (s.phase === 'setup') return fail('The year has not started.');
      if (qyContemptHeld(s) >= QY_CONTEMPT_POOL) return fail('All the Contempt is already taken.');
      s.contempt[actor.userId] = (s.contempt[actor.userId] ?? 0) + 1;
      log('contempt', 'takes a Contempt token');
      announce.push(`😠 ${actor.name} takes a Contempt token.`);
      break;
    }
    case 'discardContempt': {
      if ((s.contempt[actor.userId] ?? 0) <= 0) return fail('You hold no Contempt.');
      s.contempt[actor.userId] -= 1;
      log('contempt', 'discards a Contempt token — a past tension healed');
      announce.push(`🕊 ${actor.name} discards a Contempt token.`);
      break;
    }
    case 'importOracle': {
      const parsed = parseOracle(action.text);
      if (parsed.found === 0) return fail('No cards found. Paste the deck’s text: each card starts with a line like "8 Spring".');
      s.oracle = parsed.cards;
      log('system', `the deck's text is loaded (${parsed.found} of 52 cards)`);
      break;
    }
    case 'clearOracle':
      s.oracle = null;
      log('system', 'the deck’s text is removed — read prompts from the physical cards');
      break;
    case 'reset': {
      const keep = { seats: s.seats, oracle: s.oracle };
      const fresh = qyInitialState();
      return { state: { ...fresh, ...keep, nextId: s.nextId, log: [{ id: s.nextId, week: 0, kind: 'system', by: actor.name, text: 'starts a new year' }] } };
    }
    default:
      return fail('Unknown action.');
  }
  return { state: s, ...(announce.length ? { announce } : {}) };
}
