// Guard against the bug that has now torn the app down three times: a hook
// called BELOW an early `return` in a component. React counts hooks per
// render, so a component that returns early on one render and reaches the
// hook on the next throws — and an uncaught throw during render unmounts the
// whole tree, which is how "end combat" and "right-click a token" became
// black screens.
//
// Deliberately text, not an AST: the bug has exactly one shape — a top-level
// `use*()` CALL after a top-level `if (...) return` inside a component — and
// that shape is cheap to see. The rules below exist because the first draft
// cried wolf four times, and a guard nobody believes is worse than none:
//
//   * only lines at EXACTLY two spaces count, so a nested component's own
//     hooks (indented four) are its business, not its parent's;
//   * `function useThing(...)` is a declaration, not a call — several
//     helpers are named use* without being hooks;
//   * entering any nested function clears the early-return mark.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'client/src';
/** A hook CALL at the top level of a component body. */
const HOOK_CALL = /^ {2}(?!function\b)(?:(?:const|let|var)\s[^=]*=\s*)?\b(use[A-Z]\w*)\s*\(/;
/** `if (…) return …` at the top level of a component body. */
const EARLY_RETURN = /^ {2}if\s*\(.*\)\s*return\b/;
/** A component: a capitalised function declaration at column 0. */
const COMPONENT = /^(?:export\s+)?function\s+[A-Z]\w*\s*[(<]/;
/** Anything that opens a nested function body — the mark does not carry in. */
const NESTED = /\bfunction\s+\w*\s*\(|=>\s*\{$/;

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
})(ROOT);

const bad = [];
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  let inComponent = false;
  let returnedAt = 0;
  lines.forEach((line, i) => {
    if (COMPONENT.test(line)) { inComponent = true; returnedAt = 0; return; }
    if (/^\}/.test(line)) { inComponent = false; returnedAt = 0; return; }
    if (!inComponent) return;
    if (EARLY_RETURN.test(line)) { returnedAt = returnedAt || i + 1; return; }
    if (NESTED.test(line)) { returnedAt = 0; return; }
    const m = HOOK_CALL.exec(line);
    if (m && returnedAt) {
      bad.push(`${file}:${i + 1}  ${m[1]}() runs after the early return on line ${returnedAt}`);
    }
  });
}

if (bad.length) {
  console.error(`Hooks after an early return (React will throw and unmount the app):\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log(`hook order: ${files.length} components clean.`);
