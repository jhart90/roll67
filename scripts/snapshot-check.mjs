// Automatic database snapshots: taken at boot when due, readable, rotated.
//
// The failure this guards against is quiet: the snapshot code rots, nothing
// notices because nothing reads snapshots until the day one is needed, and
// that day it turns out they stopped being written in March. So this boots a
// REAL server on a throwaway DATA_DIR, watches it take its boot snapshot, and
// then proves the file is an actual SQLite database — not just that a file
// with the right name appeared.
//
// Usage: node scripts/snapshot-check.mjs
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

let failures = 0;
const ok = (c, l, d = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${l}${d ? ` -- ${d}` : ''}`); if (!c) failures++; };

const KEEP = 14; // mirror of SNAPSHOT_KEEP's default in server/src/db/snapshots.ts

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
        if (Date.now() > deadline) { clearInterval(poll); reject(new Error(`server never came up:\n${log.join('')}`)); }
      }
    }, 500);
  });
}

function killTree(proc) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill();
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r67snap-'));
  const snapDir = path.join(root, 'backups');
  fs.mkdirSync(snapDir, { recursive: true });

  // A long backlog of ancient snapshots, so rotation has something to rotate.
  const fakes = [];
  for (let i = 1; i <= 20; i++) {
    const name = `roll67-2020-01-${String(i).padStart(2, '0')}T00-00-00.db.gz`;
    fs.writeFileSync(path.join(snapDir, name), zlib.gzipSync(Buffer.from('stand-in for an old snapshot')));
    fakes.push(name);
  }

  let proc = null;
  try {
    console.log('booting a server on a throwaway DATA_DIR…');
    proc = await startServer(await freePort(), root);

    // The newest fake is from 2020, so a boot snapshot is due immediately.
    console.log('waiting for the boot snapshot:');
    const deadline = Date.now() + 30_000;
    let fresh = null;
    while (!fresh && Date.now() < deadline) {
      fresh = fs.readdirSync(snapDir).find((n) => /^roll67-\d{4}-.*\.db\.gz$/.test(n) && !fakes.includes(n));
      if (!fresh) await new Promise((r) => setTimeout(r, 300));
    }
    ok(!!fresh, 'a snapshot is taken at boot when one is due');
    if (!fresh) throw new Error('no snapshot appeared');

    // Let the write + rotation finish before reading the file back.
    await new Promise((r) => setTimeout(r, 500));

    const raw = zlib.gunzipSync(fs.readFileSync(path.join(snapDir, fresh)));
    ok(raw.subarray(0, 16).toString('latin1').startsWith('SQLite format 3'), 'the snapshot is a SQLite database, not just a named file');

    // Open it with the same driver the server uses and ask it real questions.
    const dbFile = path.join(root, 'restored.db');
    fs.writeFileSync(dbFile, raw);
    const require = createRequire(path.resolve('server', 'package.json'));
    const Database = require('better-sqlite3');
    const db = new Database(dbFile, { readonly: true });
    try {
      const integrity = db.prepare('PRAGMA integrity_check').get();
      ok(integrity?.integrity_check === 'ok', 'PRAGMA integrity_check says ok', String(integrity?.integrity_check));
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name);
      ok(tables.includes('users') && tables.includes('campaigns'), 'the schema came through', `${tables.length} tables`);
    } finally { db.close(); }

    const remaining = fs.readdirSync(snapDir).filter((n) => /^roll67-.*\.db\.gz$/.test(n));
    ok(remaining.length === KEEP, `rotation keeps exactly the newest ${KEEP}`, `${remaining.length} on disk`);
    ok(remaining.includes(fresh), 'the fresh snapshot survives rotation');
    ok(!remaining.includes(fakes[0]), 'the oldest snapshots are the ones pruned');
  } finally {
    if (proc) killTree(proc);
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* windows holds the db briefly */ }
  }

  console.log(failures === 0 ? '\nsnapshots: all good.' : `\nsnapshots: ${failures} failure(s).`);
  // Let closed sockets finish tearing down before exiting -- process.exit
  // mid-close trips a libuv assert (UV_HANDLE_CLOSING) on Windows Node.
  await new Promise((r) => setTimeout(r, 300));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
