import { describe, expect, it } from 'vitest';
import { nameplateFor, QUIP_MAX } from '../src/systems/nameplate.js';
import type { Character } from '../src/types.js';

const ch = (system: Character['system'], sheet: Record<string, unknown>): Character => ({
  id: 'c1', campaignId: 'x', ownerUserId: 'u1', name: 'Vyrga', system, sheet,
});

describe('nameplateFor', () => {
  it('uses SWADE Concept, and its rank rather than a level', () => {
    const p = nameplateFor(ch('swade', { concept: 'Grave robber', ancestry: 'Half-Folk', advances: 3 }), '#6c9bd2', null);
    expect(p.name).toBe('Vyrga');
    expect(p.lines).toContain('Grave robber');
    expect(p.lines).toContain('Half-Folk');
    expect(p.lines.some((l) => /Seasoned|Novice|Veteran/.test(l))).toBe(true);
  });

  it('falls back to the quip where a system has no Concept field', () => {
    const p5 = nameplateFor(ch('dnd5e', { level: 4, class: 'Bard', race: 'Tiefling', quip: 'Owes money everywhere' }), '#000000', null);
    expect(p5.lines).toContain('Level 4 Bard');
    expect(p5.lines).toContain('Owes money everywhere');
    expect(p5.lines).toContain('Tiefling');
    const pSwn = nameplateFor(ch('swn', { level: 2, class: 'Psychic', homeworld: 'Ketter', quip: 'Hears the ship' }), '#000000', null);
    expect(pSwn.lines).toContain('Level 2 Psychic');
    expect(pSwn.lines).toContain('Hears the ship');
  });

  it('prefers a SWADE concept over a quip when both are set', () => {
    const p = nameplateFor(ch('swade', { concept: 'Gunslinger', quip: 'ignored' }), '#000000', null);
    expect(p.lines).toContain('Gunslinger');
    expect(p.lines).not.toContain('ignored');
  });

  it('drops empty rows rather than rendering blanks', () => {
    const p = nameplateFor(ch('dnd5e', { level: 1 }), '#000000', null);
    expect(p.lines.every((l) => l.trim().length > 0)).toBe(true);
  });

  it('caps an over-long quip', () => {
    const p = nameplateFor(ch('dnd5e', { quip: 'x'.repeat(500) }), '#000000', null);
    expect(p.lines.some((l) => l.length > QUIP_MAX)).toBe(false);
  });

  it('takes colour and portrait from the sheet, else the token', () => {
    const dflt = nameplateFor(ch('swade', {}), '#112233', '/uploads/tok.png');
    expect(dflt.color).toBe('#112233');
    expect(dflt.portraitUrl).toBe('/uploads/tok.png');
    const over = nameplateFor(ch('swade', { nameplateColor: '#ff0000', detailImage: '/uploads/art.png' }), '#112233', '/uploads/tok.png');
    expect(over.color).toBe('#ff0000');
    expect(over.portraitUrl).toBe('/uploads/art.png');
  });
});
