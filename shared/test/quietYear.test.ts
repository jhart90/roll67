import { describe, expect, it } from 'vitest';
import {
  QY_FINAL_CARD, QY_CONTEMPT_POOL, parseOracle, qyApply, qyBuildDeck, qyInitialState, qyRuleHints,
  type QyAction, type QyActor, type QyState,
} from '../src/quietYear.js';

// The rules engine for The Quiet Year. Card text in these tests is invented:
// the real prompts are the published game and live only in a group's own
// campaign, imported from the deck they own.

const dm: QyActor = { userId: 'dm', name: 'Facilitator', isDm: true };
const ana: QyActor = { userId: 'ana', name: 'Ana', isDm: false };
const ben: QyActor = { userId: 'ben', name: 'Ben', isDm: false };

function seeded(seed = 1): () => number {
  let x = seed;
  return () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
}
function run(s: QyState, steps: Array<[QyAction, QyActor]>): QyState {
  for (const [a, who] of steps) {
    const r = qyApply(s, a, who, seeded());
    if (r.error) throw new Error(`${a.type}: ${r.error}`);
    s = r.state;
  }
  return s;
}
function started(): QyState {
  return run(qyInitialState(), [
    [{ type: 'setSeats', seats: [{ userId: 'dm', name: 'Facilitator' }, { userId: 'ana', name: 'Ana' }, { userId: 'ben', name: 'Ben' }] }, dm],
    [{ type: 'nameResource', resource: 'fish' }, ana],
    [{ type: 'nameResource', resource: 'clean water' }, ben],
    [{ type: 'nameResource', resource: 'shelter' }, dm],
    [{ type: 'start', abundance: 'fish' }, dm],
  ]);
}

describe('the deck', () => {
  it('stacks the seasons in order, each shuffled, with the Frost Shepherds in Winter', () => {
    const deck = qyBuildDeck(false, seeded(7));
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
    const seasons = deck.map((id) => id.split('-')[0]);
    expect(seasons.slice(0, 13).every((x) => x === 'spring')).toBe(true);
    expect(seasons.slice(13, 26).every((x) => x === 'summer')).toBe(true);
    expect(seasons.slice(26, 39).every((x) => x === 'autumn')).toBe(true);
    expect(seasons.slice(39).every((x) => x === 'winter')).toBe(true);
    expect(deck.slice(39)).toContain(QY_FINAL_CARD);
  });

  it('a fleeting year drops five per suit: always the King of Diamonds, never the King of Spades', () => {
    for (let seed = 1; seed < 30; seed++) {
      const deck = qyBuildDeck(true, seeded(seed));
      expect(deck).toHaveLength(32);
      expect(deck).not.toContain('summer-K');
      expect(deck).toContain(QY_FINAL_CARD);
    }
  });
});

describe('setup', () => {
  it('turns the named resources into one Abundance and the rest Scarcities', () => {
    const s = started();
    expect(s.phase).toBe('play');
    expect(s.abundances).toEqual(['fish']);
    expect(s.scarcities.sort()).toEqual(['clean water', 'shelter']);
    expect(s.deck).toHaveLength(52);
  });
  it('only the facilitator starts the year', () => {
    const r = qyApply(qyInitialState(), { type: 'start', abundance: 'x' }, ana);
    expect(r.error).toMatch(/facilitator/);
  });
});

describe('a week', () => {
  it('runs card, dice, action, end — and only the active player may run it', () => {
    let s = started();
    expect(qyApply(s, { type: 'draw' }, ana).error).toMatch(/Facilitator/);
    s = run(s, [[{ type: 'draw' }, dm]]);
    expect(s.week).toBe(1);
    expect(s.current?.cardId.startsWith('spring')).toBe(true);
    s = run(s, [[{ type: 'choose', option: 0 }, dm], [{ type: 'adjustDice' }, dm]]);
    expect(s.step).toBe('action');
    s = run(s, [[{ type: 'startProject', text: 'Dig a well', weeks: 2 }, dm]]);
    expect(s.step).toBe('done');
    s = run(s, [[{ type: 'endWeek' }, dm]]);
    expect(s.seats[s.activeSeat].userId).toBe('ana');
  });

  it('ticks project dice each week and completes them at zero; a card-started die waits a week', () => {
    let s = started();
    s = run(s, [
      [{ type: 'draw' }, dm], [{ type: 'choose', option: 0 }, dm], [{ type: 'adjustDice' }, dm],
      [{ type: 'startProject', text: 'Walls', weeks: 1 }, dm], [{ type: 'endWeek' }, dm],
      // Ana's card starts a project before the dice move: it must not tick yet.
      [{ type: 'draw' }, ana], [{ type: 'startProject', text: 'Boat', weeks: 1 }, ana],
      [{ type: 'choose', option: 0 }, ana], [{ type: 'adjustDice' }, ana],
    ]);
    expect(s.projects.map((p) => p.text)).toEqual(['Boat']);
    expect(s.log.some((l) => /Completed: Walls/.test(l.text))).toBe(true);
  });

  it('a discussion goes clockwise once each, the asker last, and never decides anything', () => {
    let s = started();
    s = run(s, [[{ type: 'draw' }, dm], [{ type: 'choose', option: 0 }, dm], [{ type: 'adjustDice' }, dm],
      [{ type: 'openDiscussion', kind: 'question', text: 'Should we fight?' }, dm]]);
    expect(s.discussion?.waiting).toEqual(['ana', 'ben', 'dm']);
    expect(qyApply(s, { type: 'weighIn', text: 'Yes' }, ben).error).toMatch(/turn/);
    s = run(s, [[{ type: 'weighIn', text: 'No.' }, ana], [{ type: 'passWeighIn' }, ben], [{ type: 'weighIn', text: 'Maybe.' }, dm]]);
    expect(s.discussion).toBeNull();
    expect(s.step).toBe('done');
  });

  it('a statement opener does not weigh in again', () => {
    let s = started();
    s = run(s, [[{ type: 'draw' }, dm], [{ type: 'choose', option: 0 }, dm], [{ type: 'adjustDice' }, dm],
      [{ type: 'openDiscussion', kind: 'statement', text: 'We build.' }, dm]]);
    expect(s.discussion?.waiting).toEqual(['ana', 'ben']);
  });
});

describe('Contempt', () => {
  it('comes out of a pool of sixteen and goes back when a tension heals', () => {
    let s = started();
    s = run(s, [[{ type: 'takeContempt' }, ana], [{ type: 'takeContempt' }, ana]]);
    expect(s.contempt.ana).toBe(2);
    s = run(s, [[{ type: 'discardContempt' }, ana]]);
    expect(s.contempt.ana).toBe(1);
    for (let i = 0; i < QY_CONTEMPT_POOL - 1; i++) s = run(s, [[{ type: 'takeContempt' }, ben]]);
    expect(qyApply(s, { type: 'takeContempt' }, ben).error).toMatch(/already taken/);
  });
});

describe('the Frost Shepherds', () => {
  it('end the game the moment their card is drawn', () => {
    let s = started();
    s = { ...s, deck: [QY_FINAL_CARD, 'winter-2'] };
    s = run(s, [[{ type: 'draw' }, dm]]);
    expect(s.phase).toBe('over');
    expect(qyApply(s, { type: 'endWeek' }, dm).error).toMatch(/over/);
  });
  it('cannot be discarded unseen', () => {
    let s = started();
    s = { ...s, deck: ['winter-3', QY_FINAL_CARD, 'winter-4'] };
    s = run(s, [[{ type: 'discardCards', count: 2 }, dm]]);
    expect(s.deck[0]).toBe(QY_FINAL_CARD);
  });
});

describe("the group's own deck text", () => {
  // Invented text in the deck PDF's shape: a header line, options split by "or...".
  const SAMPLE = [
    'Some Title Page',
    'A Spring',
    'Invented question one about the',
    'community?',
    'or...',
    'Invented question two?',
    '',
    'K Summer',
    'Invented rule. Discard the top two cards off the top of the deck. Take two actions this week.',
    '4 Autumn',
    'Invented choice. Choose one:',
    '• First path. Do not reduce project dice this week.',
    '• Second path.',
    'Turn Summary',
    'A Winter',
    'should be ignored',
  ].join('\n');

  it('splits cards and options, re-joins wrapped lines, keeps bullets, stops at the Turn Summary', () => {
    const p = parseOracle(SAMPLE);
    expect(p.found).toBe(3);
    expect(p.cards['spring-A']).toEqual(['Invented question one about the community?', 'Invented question two?']);
    expect(p.cards['autumn-4'][0]).toContain('\n• First path.');
    expect(p.cards['winter-A']).toBeUndefined();
    expect(p.missing).toHaveLength(49);
  });

  it('reads a card’s rules out of its own words', () => {
    expect(qyRuleHints('Do not reduce project dice this week.').skipDice).toBe(true);
    const k = qyRuleHints('Discard the top two cards off the top of the deck. Take two actions this week.');
    expect(k.discardTwo && k.twoActions).toBe(true);
  });

  it('applies those rules when the option is chosen', () => {
    let s = run(started(), [[{ type: 'importOracle', text: SAMPLE }, dm]]);
    s = { ...s, deck: ['summer-K', 'summer-2', 'summer-3', 'summer-4'] };
    s = run(s, [[{ type: 'draw' }, dm], [{ type: 'choose', option: 0 }, dm]]);
    expect(s.actionsLeft).toBe(2);
    expect(s.deck).toEqual(['summer-4']);
  });
});
