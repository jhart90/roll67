// IronDice — the provably-fair rolling stream. Each roll draws its dice from
// an HMAC-SHA256 keystream: HMAC(secretSeed, `${rollIdx}:${blockIdx}`),
// consumed 6 bytes (48 bits) per die for a uniform float in [0, 1). The
// server publishes SHA-256(secretSeed) BEFORE any dice are thrown and reveals
// the seed on rotation, so anyone can recompute every roll and confirm the
// house never fudged one. This module holds only the pure, side-shared math:
// the digest function itself is injected (node:crypto on the server,
// WebCrypto in the browser's verify tool) so both derive identical streams.

import type { RNG } from './roller.js';

/** Stamped onto every server roll: which stream index fed it, and the
 *  seed commitment (SHA-256 hex) that was published before it was thrown. */
export interface IronTag { idx: number; commit: string }

/**
 * Turn a per-block digest function into a uniform RNG. Deterministic given
 * the digests: block 0 is consumed 6 bytes at a time, then block 1, etc.
 */
export function ironRng(digest: (block: number) => Uint8Array): RNG {
  let block = 0;
  let buf: Uint8Array = new Uint8Array(0);
  let off = 0;
  return () => {
    if (off + 6 > buf.length) {
      buf = digest(block++);
      off = 0;
    }
    let v = 0;
    for (let i = 0; i < 6; i++) v = v * 256 + buf[off + i];
    off += 6;
    return v / 2 ** 48;
  };
}

/** The HMAC message for a given roll + block — shared so both sides agree. */
export function ironMessage(rollIdx: number, block: number): string {
  return `${rollIdx}:${block}`;
}
