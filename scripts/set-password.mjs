// Set an account's password directly in the database.
//
// The operator's key to the building, for the case the reset mail cannot
// reach: an account with no recovery address on file, or a server whose mail
// is not configured yet. Everything else should go through the app.
//
// Usage:  node scripts/set-password.mjs <username> <new-password> [--revoke]
//
//   --revoke   also sign the account out everywhere (delete its sessions).
//              Leave it off if you are handing the password back to the
//              person who owns the account; use it if the reason you are
//              here is that somebody else had the old one.
//
// Reads DATA_DIR the same way the server does, so on Railway
//   railway ssh
//   node scripts/set-password.mjs jack 'newpassword'
// edits the live database on the volume. Run from the repo root.
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

const [username, password, ...flags] = process.argv.slice(2);
const revoke = flags.includes('--revoke');

if (!username || !password) {
  console.error('usage: node scripts/set-password.mjs <username> <new-password> [--revoke]');
  process.exit(1);
}
// The app's own floor. A password this script sets must be one the login
// endpoint will accept, or you have locked the account rather than opened it.
if (password.length < 4 || password.length > 128) {
  console.error('password must be 4-128 characters (the same rule /api/login enforces)');
  process.exit(1);
}

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'roll67.db');

if (!fs.existsSync(dbPath)) {
  console.error(`no database at ${dbPath}`);
  console.error('set DATA_DIR, or run this from the repo root where ./data lives.');
  process.exit(1);
}

const db = new Database(dbPath);

// COLLATE NOCASE, matching the users table — "Jack" finds jack, because that
// is what signing in does too.
const user = db.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE').get(username);
if (!user) {
  console.error(`no account named "${username}" in ${dbPath}`);
  const all = db.prepare('SELECT username FROM users ORDER BY username').all().map((r) => r.username);
  console.error(`accounts here: ${all.join(', ') || '(none)'}`);
  process.exit(1);
}

const sessions = db.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id = ?').get(user.id).c;
db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);

// Any reset link already in an inbox is retired: the password has just been
// set deliberately, and a link issued before that must not be able to undo it.
// Guarded, because a database that predates the recovery feature has no such
// table until the server next boots and migrates it.
let retired = 0;
try {
  retired = db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
    .run(Date.now(), user.id).changes;
} catch { /* table not migrated in yet */ }

if (revoke) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

// Read it back and actually check it, rather than trusting that the UPDATE did
// what it said.
const after = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
const works = bcrypt.compareSync(password, after.password_hash);
db.close();

console.log(`database : ${dbPath}`);
console.log(`account  : ${user.username} (id ${user.id})`);
console.log(`password : set, and verified to work -> ${works}`);
if (retired) console.log(`          ${retired} outstanding reset link(s) retired`);
console.log(revoke
  ? `sessions : ${sessions} revoked — they must sign in again everywhere`
  : `sessions : ${sessions} left alone (pass --revoke to sign them out everywhere)`);

if (!works) process.exit(1);
