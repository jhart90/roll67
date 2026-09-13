// Guard against a socket listener registered INSIDE another listener's
// callback. The shape is one misplaced `});`, and the effect is quiet: the
// inner event is simply not listened for until the outer one has fired —
// and then it is listened for twice. That is how the DM's dice padlock kept
// reading "held" after the dice were freed: ROLL_LOCK sat inside MOVE_LOCK,
// so nothing updated until movement had been locked at least once.
//
// Text, not an AST, for the same reason check-hooks is: the bug has exactly
// one shape and brace depth is enough to see it. Strings and comments are
// skipped so a `{` in a chat template cannot fake a scope.
import fs from 'node:fs';

const FILES = ['client/src/store/game.ts'];
const LISTENER = /^\s*socket\.on\(/;

const bad = [];
for (const file of FILES) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const open = []; // listeners whose callback we are still inside: { line, depth }
  let depth = 0;
  let str = null;
  let block = false;
  lines.forEach((line, i) => {
    if (LISTENER.test(line)) {
      if (open.length) bad.push(`${file}:${i + 1}  socket.on() registered inside the listener opened on line ${open[open.length - 1].line}`);
      open.push({ line: i + 1, depth });
    }
    for (let j = 0; j < line.length; j++) {
      const c = line[j], n = line[j + 1];
      if (block) { if (c === '*' && n === '/') { block = false; j++; } continue; }
      if (str) { if (c === '\\') { j++; continue; } if (c === str) str = null; continue; }
      if (c === '/' && n === '/') break;
      if (c === '/' && n === '*') { block = true; j++; continue; }
      if (c === '"' || c === "'" || c === '`') { str = c; continue; }
      if (c === '{' || c === '(') depth++;
      if (c === '}' || c === ')') {
        depth--;
        while (open.length && depth <= open[open.length - 1].depth) open.pop();
      }
    }
  });
}

if (bad.length) {
  console.error(`Nested socket listeners (the inner event is ignored until the outer one fires):\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log('listeners: no socket.on nested inside another.');
