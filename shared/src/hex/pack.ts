// Hex <-> packed 32-bit int, for compact wire payloads and DB blobs.
// Supports coordinates in [-2048, 2047].

import type { Hex } from '../types.js';

const OFFSET = 2048;
const MASK = 0xfff;

export function packHex(h: Hex): number {
  return ((h.q + OFFSET) << 12) | (h.r + OFFSET);
}

export function unpackHex(packed: number): Hex {
  return {
    q: ((packed >> 12) & MASK) - OFFSET,
    r: (packed & MASK) - OFFSET,
  };
}

export function packSet(hexes: Iterable<Hex>): number[] {
  const out: number[] = [];
  for (const h of hexes) out.push(packHex(h));
  return out;
}

export function unpackSet(packed: Iterable<number>): Hex[] {
  const out: Hex[] = [];
  for (const p of packed) out.push(unpackHex(p));
  return out;
}
