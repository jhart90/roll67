// Dice expression parser. Grammar (case-insensitive):
//   expr   := term (('+' | '-') term)*
//   term   := factor ('*' factor)*
//   factor := dice | number | '(' expr ')' | 'best(' expr (',' expr)+ ')'
//   dice   := [count] 'd' sides ['!'] [('kh' | 'kl') keep]
//   sugar  := 'adv' == 2d20kh1, 'dis' == 2d20kl1
// '!' = exploding/acing dice (max roll rolls again and adds, SWADE-style);
// 'best(a, b)' rolls each argument and keeps the highest total (SWADE trait
// die vs wild die). Limits: count <= 100, sides <= 1000 — friendly errors.

export type DiceNode =
  | { kind: 'num'; value: number }
  | { kind: 'dice'; count: number; sides: number; explode: boolean; keep: { mode: 'kh' | 'kl'; n: number } | null }
  | { kind: 'best'; args: DiceNode[] }
  | { kind: 'binop'; op: '+' | '-' | '*'; left: DiceNode; right: DiceNode };

export class DiceParseError extends Error {}

interface Cursor {
  src: string;
  pos: number;
}

function skipWs(c: Cursor): void {
  while (c.pos < c.src.length && c.src[c.pos] === ' ') c.pos++;
}

function peek(c: Cursor): string {
  return c.src[c.pos] ?? '';
}

function readNumber(c: Cursor): number | null {
  skipWs(c);
  let end = c.pos;
  while (end < c.src.length && c.src[end] >= '0' && c.src[end] <= '9') end++;
  if (end === c.pos) return null;
  const n = parseInt(c.src.slice(c.pos, end), 10);
  c.pos = end;
  return n;
}

function parseFactor(c: Cursor): DiceNode {
  skipWs(c);
  if (peek(c) === '(') {
    c.pos++;
    const inner = parseExpr(c);
    skipWs(c);
    if (peek(c) !== ')') throw new DiceParseError('Missing closing parenthesis.');
    c.pos++;
    return inner;
  }

  // adv / dis sugar + best(a, b) keep-highest-arm
  const rest = c.src.slice(c.pos).toLowerCase();
  if (rest.startsWith('adv')) {
    c.pos += 3;
    return { kind: 'dice', count: 2, sides: 20, explode: false, keep: { mode: 'kh', n: 1 } };
  }
  if (rest.startsWith('dis')) {
    c.pos += 3;
    return { kind: 'dice', count: 2, sides: 20, explode: false, keep: { mode: 'kl', n: 1 } };
  }
  if (rest.startsWith('best(')) {
    c.pos += 5;
    const args: DiceNode[] = [parseExpr(c)];
    skipWs(c);
    while (peek(c) === ',') {
      c.pos++;
      args.push(parseExpr(c));
      skipWs(c);
    }
    if (peek(c) !== ')') throw new DiceParseError('best(...) is missing its closing parenthesis.');
    c.pos++;
    if (args.length < 2) throw new DiceParseError('best(...) needs at least two arguments, e.g. best(1d8!, 1d6!).');
    return { kind: 'best', args };
  }

  const num = readNumber(c);
  skipWs(c);
  if (peek(c).toLowerCase() === 'd') {
    c.pos++;
    const sides = readNumber(c);
    if (sides === null || sides < 2) throw new DiceParseError('Die needs at least 2 sides (e.g. d6).');
    if (sides > 1000) throw new DiceParseError('Dice can have at most 1000 sides.');
    const count = num ?? 1;
    if (count < 1) throw new DiceParseError('Dice count must be at least 1.');
    if (count > 100) throw new DiceParseError('At most 100 dice per roll.');
    let explode = false;
    if (peek(c) === '!') {
      c.pos++;
      explode = true;
    }
    let keep: { mode: 'kh' | 'kl'; n: number } | null = null;
    const after = c.src.slice(c.pos, c.pos + 2).toLowerCase();
    if (after === 'kh' || after === 'kl') {
      c.pos += 2;
      const n = readNumber(c);
      if (n === null || n < 1) throw new DiceParseError(`${after} needs a count, e.g. 2d20${after}1.`);
      if (n > count) throw new DiceParseError(`Cannot keep ${n} of ${count} dice.`);
      keep = { mode: after, n };
    }
    return { kind: 'dice', count, sides, explode, keep };
  }
  if (num !== null) return { kind: 'num', value: num };
  throw new DiceParseError(`Cannot read dice expression at "${c.src.slice(c.pos, c.pos + 10)}".`);
}

function parseTerm(c: Cursor): DiceNode {
  let left = parseFactor(c);
  for (;;) {
    skipWs(c);
    if (peek(c) === '*') {
      c.pos++;
      left = { kind: 'binop', op: '*', left, right: parseFactor(c) };
    } else {
      return left;
    }
  }
}

function parseExpr(c: Cursor): DiceNode {
  let left = parseTerm(c);
  for (;;) {
    skipWs(c);
    const ch = peek(c);
    if (ch === '+' || ch === '-') {
      c.pos++;
      left = { kind: 'binop', op: ch, left, right: parseTerm(c) };
    } else {
      return left;
    }
  }
}

export function parseDice(expression: string): DiceNode {
  const c: Cursor = { src: expression.trim(), pos: 0 };
  if (!c.src) throw new DiceParseError('Empty dice expression.');
  const node = parseExpr(c);
  skipWs(c);
  if (c.pos !== c.src.length) {
    throw new DiceParseError(`Unexpected "${c.src.slice(c.pos, c.pos + 10)}" at end of expression.`);
  }
  return node;
}
