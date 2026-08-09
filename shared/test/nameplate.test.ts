import { describe, expect, it } from 'vitest';
import { nameplateFor } from '../src/systems/nameplate.js';
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

  it('describes 5e and SWN characters from their own sheet fields', () => {
    const p5 = nameplateFor(ch('dnd5e', { level: 4, class: 'Bard', race: 'Tiefling', background: 'Charlatan' }), '#000000', null);
    expect(p5.lines).toContain('Level 4 Bard');
    expect(p5.lines).toContain('Tiefling');
    expect(p5.lines).toContain('Charlatan');
    const pSwn = nameplateFor(ch('swn', { level: 2, class: 'Psychic', homeworld: 'Ketter' }), '#000000', null);
    expect(pSwn.lines).toContain('Level 2 Psychic');
    expect(pSwn.lines).toContain('Ketter');
  });

  it('drops empty rows rather than rendering blanks', () => {
    const p = nameplateFor(ch('dnd5e', { level: 1 }), '#000000', null);
    expect(p.lines.every((l) => l.trim().length > 0)).toBe(true);
  });

  it('shows the TOKEN art — the nameplate labels the piece on the map', () => {
    const p = nameplateFor(ch('swade', { detailImage: '/uploads/portrait.png' }), '#112233', '/uploads/tok.png');
    expect(p.portraitUrl).toBe('/uploads/tok.png');
  });

  it("uses the sheet's token image when the token itself carries no art", () => {
    const p = nameplateFor(
      ch('swade', { tokenImage: '/uploads/tok.png', detailImage: '/uploads/portrait.png' }), '#112233', null,
    );
    expect(p.portraitUrl).toBe('/uploads/tok.png');
  });

  it('falls back to the detail portrait only when there is no token image at all', () => {
    const p = nameplateFor(ch('swade', { detailImage: '/uploads/portrait.png' }), '#112233', null);
    expect(p.portraitUrl).toBe('/uploads/portrait.png');
    expect(nameplateFor(ch('swade', {}), '#112233', null).portraitUrl).toBeNull();
  });

  it('takes its colour from the token — there is no separate nameplate colour', () => {
    // A sheet carrying the retired override must not resurrect it.
    const p = nameplateFor(ch('swade', { nameplateColor: '#ff0000' }), '#112233', null);
    expect(p.color).toBe('#112233');
  });

  it('no longer surfaces the retired quip field', () => {
    const p = nameplateFor(ch('dnd5e', { level: 1, quip: 'Owes money everywhere' }), '#000000', null);
    expect(p.lines).not.toContain('Owes money everywhere');
  });
});
