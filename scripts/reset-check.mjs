// Password-recovery round trip.
//
// The question is not "does the endpoint return 200" — it is "can somebody who
// has genuinely forgotten their password get back in, and can nobody else".
// So this runs a real server on a throwaway data directory, asks for a reset
// the way the login screen does, and picks the link out of the server's own
// output (with RESEND_API_KEY unset the mailer prints the message instead of
// sending it — that fallback is exactly what a small deployment relies on, so
// testing through it tests the thing the operator will actually use).
//
// Usage: node scripts/reset-check.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/**
 * Bind a port before claiming it.
 *
 * A fixed port is a trap: an orphaned server from an earlier run answers the
 * health poll, our own bind quietly fails with EADDRINUSE, and every assertion
 * below then tests a stranger's build. Actually binding is the only honest
 * test of "free".
 *
 * Bound the way the server binds it — no host argument, i.e. the wildcard. A
 * probe against 127.0.0.1 succeeds on Windows even while another process holds
 * the wildcard on the same port, which reports "free" for a port that is about
 * to fail, and puts us straight back in the trap this function exists to avoid.
 */
function freePort(from = 3910, to = 3990) {
  return new Promise((resolve, reject) => {
    let port = from;
    const attempt = () => {
      if (port > to) { reject(new Error(`no free port in ${from}-${to}`)); return; }
      const probe = net.createServer();
      probe.once('error', () => { port++; attempt(); });
      probe.listen(port, () => probe.close(() => resolve(port)));
    };
    attempt();
  });
}

let PORT = 0;
let BASE = '';
let failures = 0;

function ok(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}`); }
}

async function api(path_, body, token) {
  const res = await fetch(`${BASE}${path_}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const log = [];

function startServer(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  // No `npx`, and deliberately no shell. Through a shell, proc.pid is the
  // shell's — kill() then reaps the wrapper and leaves the actual server alive
  // holding the port forever, which is how this machine collected two dozen
  // orphaned test servers. Running tsx's CLI directly makes proc.pid the
  // server, so kill() means what it says.
  const tsx = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs');
  const proc = spawn(process.execPath, [tsx, 'src/index.ts'], {
    cwd: path.resolve('server'),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      // Deliberately no RESEND_API_KEY: we want the console fallback.
      APP_URL: BASE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // A server that dies (EADDRINUSE, a throw during migrations) must fail the
  // run loudly rather than let the health poll time out eighty seconds later.
  proc.once('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`server exited early (${code}):\n${log.join('')}`);
  });
  proc.stdout.on('data', (b) => log.push(String(b)));
  proc.stderr.on('data', (b) => log.push(String(b)));
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 90_000;
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/healthz`);
        if (r.ok) { clearInterval(poll); resolve(proc); }
      } catch {
        if (Date.now() > deadline) { clearInterval(poll); reject(new Error(`server never came up:\n${log.join('')}`)); }
      }
    }, 500);
  });
}

/** The link the mailer printed, most recent last. */
function linksSoFar() {
  return [...log.join('').matchAll(/http:\/\/localhost:\d+\/#reset=([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
}

async function waitForNewLink(before) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const now = linksSoFar();
    if (now.length > before) return now[now.length - 1];
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function main() {
  PORT = await freePort();
  BASE = `http://localhost:${PORT}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r67reset-'));
  const server = await startServer(path.join(dir, 'data'));

  try {
    console.log('setting up an account with an email on file:');
    const reg = await api('/api/register', {
      username: 'forgetful', password: 'oldpass1', email: '  Forgetful@Example.COM ',
    });
    ok(reg.status === 200, 'the account is created with an email');
    const firstToken = reg.data.token;

    const acct = await api('/api/account', undefined, firstToken);
    ok(acct.data.user?.email === 'forgetful@example.com', 'the address is stored trimmed and lowercased');

    const dupe = await api('/api/register', { username: 'other', password: 'pw12', email: 'FORGETFUL@example.com' });
    ok(dupe.status === 409, 'a second account cannot claim the same address');

    const bad = await api('/api/register', { username: 'bademail', password: 'pw12', email: 'not-an-address' });
    ok(bad.status === 400, 'a malformed address is refused at registration');

    const noEmail = await api('/api/register', { username: 'anonymous', password: 'pw12' });
    ok(noEmail.status === 200, 'an account with no email at all is still allowed');

    console.log('asking for a reset link:');
    const before = linksSoFar().length;
    const asked = await api('/api/forgot-password', { account: 'forgetful' });
    ok(asked.status === 200 && asked.data.ok === true, 'the request is accepted');

    const missing = await api('/api/forgot-password', { account: 'nobody-by-that-name' });
    ok(
      missing.status === asked.status && missing.data.message === asked.data.message,
      'an account that does not exist gets the identical answer (no enumeration)',
    );

    const token = await waitForNewLink(before);
    ok(Boolean(token), 'a reset link was issued');
    if (!token) throw new Error(`no link found in server output:\n${log.join('')}`);
    ok(token.length >= 40, 'the token is long enough to be unguessable');
    ok(log.join('').includes('"nobody-by-that-name" — no such account'), 'the log tells the operator the unknown name went nowhere');
    ok(linksSoFar().length === before + 1, 'exactly one link was issued, not one per request');

    console.log('checking the link before using it:');
    const check = await api('/api/reset-password/check', { token });
    ok(check.data.valid === true, 'the link reports itself valid');
    ok(check.data.username === 'forgetful', 'and names the account it belongs to');

    const junk = await api('/api/reset-password/check', { token: 'not-a-real-token' });
    ok(junk.data.valid === false, 'a made-up token reports invalid');

    console.log('spending it:');
    const short = await api('/api/reset-password', { token, newPassword: 'ab' });
    ok(short.status === 400, 'a too-short password is refused');

    const done = await api('/api/reset-password', { token, newPassword: 'brandnew9' });
    ok(done.status === 200, 'the reset succeeds');
    ok(Boolean(done.data.token), 'and hands back a session, so the player lands signed in');
    ok(done.data.user?.username === 'forgetful', 'signed in as the right account');

    const me = await api('/api/me', undefined, done.data.token);
    ok(me.status === 200 && me.data.user.username === 'forgetful', 'that session actually works');

    console.log('what the reset closed off:');
    const replay = await api('/api/reset-password', { token, newPassword: 'thirdpass' });
    ok(replay.status === 400, 'the same link cannot be used twice');

    const recheck = await api('/api/reset-password/check', { token });
    ok(recheck.data.valid === false, 'and it no longer reports itself valid');

    const oldLogin = await api('/api/login', { username: 'forgetful', password: 'oldpass1' });
    ok(oldLogin.status === 401, 'the old password no longer works');

    const newLogin = await api('/api/login', { username: 'forgetful', password: 'brandnew9' });
    ok(newLogin.status === 200, 'the new password does');

    const staleSession = await api('/api/me', undefined, firstToken);
    ok(staleSession.status === 401, 'the session held before the reset was revoked');

    console.log('finding an account by its address:');
    const beforeByEmail = linksSoFar().length;
    await api('/api/forgot-password', { account: 'FORGETFUL@example.com' });
    const byEmail = await waitForNewLink(beforeByEmail);
    ok(Boolean(byEmail), 'the email address works in the box as well as the name');

    console.log('an account with no email on file:');
    const beforeAnon = linksSoFar().length;
    const anon = await api('/api/forgot-password', { account: 'anonymous' });
    ok(anon.data.message === asked.data.message, 'answers the same as everything else');
    await new Promise((r) => setTimeout(r, 600));
    ok(linksSoFar().length === beforeAnon, 'but no link is issued, because there is nowhere to send it');

    console.log('changing the password from the account panel:');
    const sessionA = (await api('/api/login', { username: 'forgetful', password: 'brandnew9' })).data.token;
    const sessionB = (await api('/api/login', { username: 'forgetful', password: 'brandnew9' })).data.token;
    const changed = await api('/api/account', { currentPassword: 'brandnew9', newPassword: 'typedit4' }, sessionB);
    ok(changed.status === 200, 'the change succeeds');
    ok((await api('/api/me', undefined, sessionB)).status === 200, 'the tab that made the change stays signed in');
    ok((await api('/api/me', undefined, sessionA)).status === 401, 'the other device is signed out');

    console.log('a reset link already in flight when the owner changes it themselves:');
    const beforeRace = linksSoFar().length;
    await api('/api/forgot-password', { account: 'forgetful' });
    const inFlight = await waitForNewLink(beforeRace);
    await api('/api/account', { currentPassword: 'typedit4', newPassword: 'mineagain5' }, sessionB);
    const stale = await api('/api/reset-password', { token: inFlight, newPassword: 'stolen666' });
    ok(stale.status === 400, 'the in-flight link is dead — a stranger cannot undo the owner’s change');
    ok((await api('/api/login', { username: 'forgetful', password: 'mineagain5' })).status === 200,
      'the password the owner chose is the one that stands');

    console.log('clearing the address:');
    const live = (await api('/api/login', { username: 'forgetful', password: 'mineagain5' })).data.token;
    const cleared = await api('/api/account', { currentPassword: 'mineagain5', newEmail: '' }, live);
    ok(cleared.status === 200 && cleared.data.user.email === null, 'an empty field removes the address');
    const beforeCleared = linksSoFar().length;
    await api('/api/forgot-password', { account: 'forgetful' });
    await new Promise((r) => setTimeout(r, 600));
    ok(linksSoFar().length === beforeCleared, 'and no reset link can be issued afterwards');
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 500));
    // Best effort: Windows can still hold the SQLite WAL open for a moment
    // after the child dies, and a locked temp directory is not a test failure.
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* it is a temp dir */ }
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nall good.');
}

main().catch((e) => { console.error(e); process.exit(1); });
