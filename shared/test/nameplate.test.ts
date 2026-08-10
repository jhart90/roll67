import { describe, expect, it } from 'vitest';
import { nameplateFor } from '../src/systems/nameplate.js';
import { CONCEPT_MAX_LEN, type Character, type NameplateLine } from '../src/types.js';

const text = (lines: NameplateLine[]) => lines.map((l) => l.text);

const ch = (system: Character['system'], sheet: Record<string, unknown>): Character => ({
  id: 'c1', campaignId: 'x', ownerUserId: 'u1', name: 'Vyrga', system, sheet,
});

describe('nameplateFor', () => {
  it('uses SWADE Concept, and its rank rather than a level', () => {
    const p = nameplateFor(ch('swade', { concept: 'Grave robber', ancestry: 'Half-Folk', advances: 3 }), '#6c9bd2', null);
    expect(p.name).toBe('Vyrga');
    expect(text(p.lines)).toContain('Grave robber');
    expect(text(p.lines)).toContain('Half-Folk');
    expect(p.lines.some((l) => l.kind === 'rank' && /Seasoned|Novice|Veteran/.test(l.text))).toBe(true);
  });

  it('describes 5e and SWN characters from their own sheet fields', () => {
    const p5 = nameplateFor(ch('dnd5e', { level: 4, class: 'Bard', race: 'Tiefling', background: 'Charlatan' }), '#000000', null);
    expect(text(p5.lines)).toContain('Level 4 Bard');
    expect(text(p5.lines)).toContain('Tiefling');
    expect(text(p5.lines)).toContain('Charlatan');
    const pSwn = nameplateFor(ch('swn', { level: 2, class: 'Psychic', homeworld: 'Ketter' }), '#000000', null);
    expect(text(pSwn.lines)).toContain('Level 2 Psychic');
    expect(text(pSwn.lines)).toContain('Ketter');
  });

  it('tags each line with what it is, so the card can badge the rank', () => {
    const p = nameplateFor(ch('swade', { concept: 'Gunslinger', ancestry: 'Half-Folk', advances: 3 }), '#000000', null);
    expect(p.lines.find((l) => /Novice|Seasoned|Veteran|Heroic|Legendary/.test(l.text))?.kind).toBe('rank');
    expect(p.lines.find((l) => l.text === 'Gunslinger')?.kind).toBe('concept');
    expect(p.lines.find((l) => l.text === 'Half-Folk')?.kind).toBe('origin');
    const p5 = nameplateFor(ch('dnd5e', { level: 4, class: 'Bard', race: 'Tiefling' }), '#000000', null);
    expect(p5.lines.find((l) => l.text === 'Level 4 Bard')?.kind).toBe('rank');
    expect(p5.lines.find((l) => l.text === 'Tiefling')?.kind).toBe('origin');
  });

  it('badges a SWADE combatant as Wild Card or Extra', () => {
    // The single most load-bearing fact in a fight: three wounds and a Wild
    // Die, or one hit and gone.
    const wc = nameplateFor(ch('swade', { wildCard: true }), '#000000', null);
    expect(wc.lines.find((l) => l.kind === 'status')?.text).toBe('Wild Card');
    const extra = nameplateFor(ch('swade', { wildCard: false }), '#000000', null);
    expect(extra.lines.find((l) => l.kind === 'status')?.text).toBe('Extra');
    // An unset sheet is a Wild Card, matching the rest of the engine.
    expect(nameplateFor(ch('swade', {}), '#000000', null).lines.find((l) => l.kind === 'status')?.text).toBe('Wild Card');
  });

  it('leaves the Wild Card badge off systems that have no such idea', () => {
    for (const sys of ['dnd5e', 'swn'] as const) {
      const p = nameplateFor(ch(sys, { level: 3, wildCard: true }), '#000000', null);
      expect(p.lines.some((l) => l.kind === 'status')).toBe(false);
    }
  });

  it('drops empty rows rather than rendering blanks', () => {
    const p = nameplateFor(ch('dnd5e', { level: 1 }), '#000000', null);
    expect(p.lines.every((l) => l.text.trim().length > 0)).toBe(true);
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

  it('lists SWADE Edges and Hindrances as pills, carrying their rules text', () => {
    const p = nameplateFor(ch('swade', {
      edges: [{ name: 'Quick', notes: 'Redraw action cards of 5 or less.' }],
      hindrances: [{ name: 'Loyal', severity: 'Minor', notes: 'Risks himself for friends.' }],
    }), '#000000', null);
    const edge = p.pills.find((x) => x.kind === 'edge');
    expect(edge).toEqual({ name: 'Quick', desc: 'Redraw action cards of 5 or less.', kind: 'edge' });
    // Major/Minor is half of what a Hindrance means, so it rides on the face.
    const hind = p.pills.find((x) => x.kind === 'hindrance');
    expect(hind?.name).toBe('Loyal (Minor)');
    expect(hind?.desc).toBe('Risks himself for friends.');
  });

  it('skips nameless trait rows and tolerates ones with no description', () => {
    const p = nameplateFor(ch('swade', {
      edges: [{ name: '', notes: 'orphan note' }, { name: 'Brawny' }],
      hindrances: [{ name: '   ' }],
    }), '#000000', null);
    expect(p.pills).toEqual([{ name: 'Brawny', desc: '', kind: 'edge' }]);
  });

  it('carries no pills for systems without Edges and Hindrances', () => {
    for (const sys of ['dnd5e', 'swn'] as const) {
      const p = nameplateFor(ch(sys, { level: 3, edges: [{ name: 'Quick' }] }), '#000000', null);
      expect(p.pills).toEqual([]);
    }
  });

  it('clamps an over-long Concept so it cannot outrun the card', () => {
    const long = 'A'.repeat(CONCEPT_MAX_LEN + 60);
    const p = nameplateFor(ch('swade', { concept: long }), '#000000', null);
    const line = p.lines.find((l) => l.kind === 'concept')!;
    expect(line.text.length).toBe(CONCEPT_MAX_LEN);
    expect(line.text.endsWith('…')).toBe(true);
    // One at exactly the cap is left alone — no stray ellipsis.
    const exact = 'B'.repeat(CONCEPT_MAX_LEN);
    const p2 = nameplateFor(ch('swade', { concept: exact }), '#000000', null);
    expect(p2.lines.find((l) => l.kind === 'concept')!.text).toBe(exact);
  });

  it('no longer surfaces the retired quip field', () => {
    const p = nameplateFor(ch('dnd5e', { level: 1, quip: 'Owes money everywhere' }), '#000000', null);
    expect(text(p.lines)).not.toContain('Owes money everywhere');
  });
});
