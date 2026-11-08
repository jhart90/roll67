// Bundle the server into one plain-JS file for production.
//
// Railway bills RAM by the minute, and running TypeScript through tsx in
// production keeps a transpiler (plus its esbuild child process) resident for
// the life of the server. This compiles once at deploy time instead, so `npm
// start` is just `node dist/index.js`.
//
// Every npm dependency stays external (native modules like better-sqlite3 and
// sharp must load from node_modules) except the `shared` workspace, which
// ships as TypeScript source and so has to be bundled in.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const external = Object.keys({
  ...pkg.dependencies,
  ...pkg.optionalDependencies,
}).filter((name) => name !== 'shared');

const outdir = path.join(root, 'dist');
fs.rmSync(outdir, { recursive: true, force: true });

await build({
  entryPoints: [path.join(root, 'src', 'index.ts')],
  outfile: path.join(outdir, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: external.flatMap((name) => [name, `${name}/*`]),
  logLevel: 'info',
});

// db.ts reads schema.sql beside itself; in the bundle "beside itself" is dist/.
fs.copyFileSync(path.join(root, 'src', 'db', 'schema.sql'), path.join(outdir, 'schema.sql'));
