// The regression gate: every committed check, one command, fail-fast.
//
// Every push to main IS a production deploy, so this is the thing to run
// before pushing. It stages the cheap checks first, boots ONE throwaway
// server (fresh temp DATA_DIR — the dev database is never touched) for all
// the live socket suites, runs the self-booting round-trips, and finishes
// with the production client build.
//
// Usage:
//   npm run gate             everything
//   npm run gate -- --quick  skip the client build (the slowest stage)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const QUICK = process.argv.includes('--quick');
const t0 = Date.now();
const done = [];
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

function run(label, cmd, args) {
  return new Promise((resolve) => {
    const started = Date.now();
    console.log(`\n=== ${label} ===`);
    const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    p.on('close', (code) => resolve({ label, code: code ?? 1, ms: Date.now() - started }));
  });
}

function summary() {
  console.log('\n--- gate summary ---');
  for (const r of done) console.log(`  ${r.code === 0 ? 'ok  ' : 'FAIL'} ${r.label} (${secs(r.ms)})`);
}

/** Record the result; on failure print the summary and stop the gate. The
 *  caller must have no server left running — process.exit skips finally. */
function settle(r) {
  done.push(r);
  if (r.code !== 0) {
    summary();
    console.error(`\nGATE: FAILED at "${r.label}" after ${secs(Date.now() - t0)} -- fix it before pushing.`);
    process.exit(1);
  }
}

const stage = async (label, cmd, args) => settle(await run(label, cmd, args));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function startServer(port, dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const proc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: path.resolve('server'),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  proc.stdout.on('data', (b) => log.push(String(b)));
  proc.stderr.on('data', (b) => log.push(String(b)));
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 90_000;
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`http://localhost:${port}/healthz`);
        if (r.ok) { clearInterval(poll); resolve(proc); }
      } catch {
        if (Date.now() > deadline) { clearInterval(poll); reject(new Error(`gate server never came up:\n${log.join('')}`)); }
      }
    }, 500);
  });
}

/** Kill the whole process tree: on Windows, proc.kill() only takes the npx
 *  shell and orphans the actual node server, which then squats on the port. */
function killTree(proc) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill();
}

async function main() {
  // Cheap and static first: most breakage dies here in under a minute.
  await stage('typecheck (all workspaces + hook guard)', 'npm', ['run', 'typecheck']);
  await stage('unit tests (shared)', 'npm', ['test']);
  await stage('upload pipeline + thumbnails', 'npm', ['run', 'check:uploads']);

  // One throwaway server for every live socket suite.
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r67gate-'));
  const base = `http://localhost:${port}`;
  console.log(`\nbooting a throwaway server on :${port} (DATA_DIR ${dataDir})...`);
  const server = await startServer(port, dataDir);
  // Ordering matters once: integration-smoke creates testdm's campaign,
  // which combat-check assumes already exists.
  const liveSuites = [
    ['integration smoke', 'integration-smoke.mjs'],
    ['combat system', 'combat-check.mjs'],
    ['multi-action penalty', 'check-multi-action.mjs'],
    ['loot drop', 'check-loot-drop.mjs'],
    ['orphaned map markers', 'check-orphans.mjs'],
    ['shopkeeper range', 'check-shopkeeper.mjs'],
    ['world-tree nesting', 'check-tree-nesting.mjs'],
  ];
  for (const [label, script] of liveSuites) {
    const r = await run(label, 'node', [`scripts/${script}`, base]);
    if (r.code !== 0) killTree(server);
    settle(r);
  }
  killTree(server);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* windows holds the db briefly */ }

  // Round-trips that boot their own servers.
  await stage('password reset round-trip', 'node', ['scripts/reset-check.mjs']);
  await stage('campaign backup round-trip', 'node', ['scripts/backup-check.mjs']);
  await stage('database snapshots', 'node', ['scripts/snapshot-check.mjs']);

  // Last because it is the slowest, and a build that breaks with everything
  // else green is exactly what Railway would otherwise discover for us.
  if (!QUICK) await stage('client production build', 'npm', ['run', 'build']);

  summary();
  console.log(`\nGATE: all green in ${secs(Date.now() - t0)}${QUICK ? ' (client build skipped: --quick)' : ''}. Safe to push.`);
}

main().catch((err) => { console.error('GATE FATAL:', err.message); process.exit(1); });
