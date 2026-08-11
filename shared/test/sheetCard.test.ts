import { describe, expect, it } from 'vitest';
import {
  CARD_MAX_CHIPS, CARD_MAX_NOTES, CARD_TEXT_MAX, sanitizeCard,
} from '../src/systems/sheetCard.js';

const card = (over: Record<string, unknown> = {}) => ({
  name: 'Colt Peacemaker', chips: [{ text: 'Shooting', tone: 'skill' }], notes: ['mag 6'], ...over,
}) as never;

describe('a card posted from a sheet', () => {
  it('comes through intact when it is well formed', () => {
    expect(sanitizeCard(card())).toEqual({
      name: 'Colt Peacemaker', chips: [{ text: 'Shooting', tone: 'skill' }], notes: ['mag 6'],
    });
  });

  it('keeps a theme the stylesheet knows', () => {
    expect(sanitizeCard(card({ theme: 'card-bad' }))!.theme).toBe('card-bad');
  });

  // A card with no name is nothing — every other field decorates it.
  it.each([undefined, null, {}, { name: '   ' }, 'not an object'])(
    'refuses %s', (bad) => {
      expect(sanitizeCard(bad as never)).toBeNull();
    },
  );
});

describe('nothing on the card is trusted', () => {
  // Tone and theme become class names, so only known values may pass.
  it('falls back to a plain chip for an unknown tone', () => {
    expect(sanitizeCard(card({ chips: [{ text: 'x', tone: 'evil' }] }))!.chips[0]!.tone).toBe('plain');
    expect(sanitizeCard(card({ chips: [{ text: 'x', tone: '" onload="' }] }))!.chips[0]!.tone).toBe('plain');
  });

  it('drops an unknown theme rather than echoing it', () => {
    expect(sanitizeCard(card({ theme: 'card-evil' }))!.theme).toBeUndefined();
    expect(sanitizeCard(card({ theme: 'sheet-backdrop' }))!.theme).toBeUndefined();
  });

  it('survives chips and notes that are not arrays', () => {
    const out = sanitizeCard(card({ chips: 'nope', notes: 7 }))!;
    expect(out.chips).toEqual([]);
    expect(out.notes).toEqual([]);
  });

  it('survives a chip that is not an object', () => {
    expect(sanitizeCard(card({ chips: [null, 5, { text: 'ok', tone: 'skill' }] }))!.chips)
      .toEqual([{ text: 'ok', tone: 'skill' }]);
  });
});

describe('one card cannot flood the log', () => {
  it('caps the number of chips and notes', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ text: `c${i}`, tone: 'plain' }));
    const out = sanitizeCard(card({ chips: many, notes: many.map((c) => c.text) }))!;
    expect(out.chips).toHaveLength(CARD_MAX_CHIPS);
    expect(out.notes).toHaveLength(CARD_MAX_NOTES);
  });

  it('clips text that would stretch the panel', () => {
    const out = sanitizeCard(card({ name: 'x'.repeat(5000), notes: ['y'.repeat(5000)] }))!;
    expect(out.name).toHaveLength(CARD_TEXT_MAX);
    expect(out.notes[0]).toHaveLength(CARD_TEXT_MAX);
  });

  it('drops empty chips and notes instead of rendering blanks', () => {
    const out = sanitizeCard(card({ chips: [{ text: '  ', tone: 'skill' }], notes: ['', '  '] }))!;
    expect(out.chips).toEqual([]);
    expect(out.notes).toEqual([]);
  });
});
