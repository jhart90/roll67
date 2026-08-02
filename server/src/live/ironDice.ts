// IronDice — the server half of the provably-fair roller. On boot it installs
// a cryptographic RNG provider into the shared dice roller: every roll draws
// from HMAC-SHA256(secretSeed, `${idx}:${block}`) and gets stamped with its
// stream index plus the seed's SHA-256 commitment. The commitment is public
// from the moment the seed is born; the seed itself is revealed when a DM
// rotates it, at which point every roll thrown under it can be recomputed
// and checked against the chat log by anyone.

import { createHash, createHmac, randomBytes } from 'crypto';
import { ironMessage, ironRng, setRollRngProvider } from 'shared';
import { db, now, stmt } from '../db/db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS iron_dice_seeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seed_hex TEXT NOT NULL,
    commit_hash TEXT NOT NULL,
    first_idx INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    revealed_at INTEGER
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS iron_dice_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    counter INTEGER NOT NULL
  )
`);
db.exec('INSERT OR IGNORE INTO iron_dice_state (id, counter) VALUES (1, 0)');

interface SeedRow { id: number; seed_hex: string; commit_hash: string; first_idx: number; created_at: number; revealed_at: number | null }

function counterNow(): number {
  return (stmt('SELECT counter FROM iron_dice_state WHERE id = 1').get() as { counter: number }).counter;
}

function mintSeed(): SeedRow {
  const seed = randomBytes(32);
  const commit = createHash('sha256').update(seed).digest('hex');
  stmt('INSERT INTO iron_dice_seeds (seed_hex, commit_hash, first_idx, created_at) VALUES (?, ?, ?, ?)')
    .run(seed.toString('hex'), commit, counterNow() + 1, now());
  return stmt('SELECT * FROM iron_dice_seeds ORDER BY id DESC LIMIT 1').get() as SeedRow;
}

function activeSeed(): SeedRow {
  const row = stmt('SELECT * FROM iron_dice_seeds WHERE revealed_at IS NULL ORDER BY id DESC LIMIT 1').get() as SeedRow | undefined;
  return row ?? mintSeed();
}

/** Public state for the IronDice window: current commitment + revealed seeds. */
export function ironDiceInfo(): {
  commit: string; firstIdx: number; createdAt: number; rolls: number;
  revealed: Array<{ commit: string; seedHex: string; firstIdx: number; lastIdx: number; revealedAt: number }>;
} {
  const active = activeSeed();
  const revealed = (stmt('SELECT * FROM iron_dice_seeds WHERE revealed_at IS NOT NULL ORDER BY id DESC LIMIT 20').all() as SeedRow[])
    .map((r, i, all) => ({
      commit: r.commit_hash,
      seedHex: r.seed_hex,
      firstIdx: r.first_idx,
      // A revealed seed's stream ends where the next seed's begins.
      lastIdx: (i === 0 ? active.first_idx : all[i - 1].first_idx) - 1,
      revealedAt: r.revealed_at!,
    }));
  return {
    commit: active.commit_hash,
    firstIdx: active.first_idx,
    createdAt: active.created_at,
    rolls: counterNow() - active.first_idx + 1,
    revealed,
  };
}

/** Reveal the current seed (making its rolls verifiable) and mint a fresh one. */
export function rotateIronDice(): void {
  const active = activeSeed();
  stmt('UPDATE iron_dice_seeds SET revealed_at = ? WHERE id = ?').run(now(), active.id);
  mintSeed();
}

/** Installed once at boot: hands the shared roller its keystream per roll. */
export function initIronDice(): void {
  setRollRngProvider(() => {
    const active = activeSeed();
    stmt('UPDATE iron_dice_state SET counter = counter + 1 WHERE id = 1').run();
    const idx = counterNow();
    const seed = Buffer.from(active.seed_hex, 'hex');
    return {
      rng: ironRng((block) => createHmac('sha256', seed).update(ironMessage(idx, block)).digest()),
      tag: { idx, commit: active.commit_hash },
    };
  });
}
