import { describe, expect, it } from 'vitest';
import { COVER_PENALTY, coverGradeFor, effectiveCover, sheetCoverPenalty } from '../src/systems/swadeCover.js';

const sheet = (cover?: string) => (cover ? { cover } : {});

describe('the Cover Penalties table', () => {
  it('matches the book', () => {
    expect(COVER_PENALTY).toEqual({ none: 0, light: -2, medium: -4, heavy: -6, nearTotal: -8 });
  });

  it('names the grade a penalty belongs to', () => {
    expect(coverGradeFor(0)).toBe('none');
    expect(coverGradeFor(-2)).toBe('light');
    expect(coverGradeFor(-4)).toBe('medium');
    expect(coverGradeFor(-6)).toBe('heavy');
    expect(coverGradeFor(-8)).toBe('nearTotal');
  });

  it('reads nothing off a sheet that claims nothing', () => {
    expect(sheetCoverPenalty(sheet())).toBe(0);
    expect(sheetCoverPenalty(sheet('none'))).toBe(0);
    expect(sheetCoverPenalty(sheet('bogus'))).toBe(0);
  });
});

describe('map cover and sheet cover together', () => {
  // The case from the brief: light on the sheet, medium from the map -> −4.
  it('keeps the deeper of the two', () => {
    expect(effectiveCover(-4, sheet('light'))).toMatchObject({ penalty: -4, grade: 'medium', source: 'map' });
  });

  it('lets the sheet win when it claims more than the map can see', () => {
    expect(effectiveCover(-2, sheet('heavy'))).toMatchObject({ penalty: -6, grade: 'heavy', source: 'sheet' });
  });

  it('lets the sheet supply cover on an open map', () => {
    expect(effectiveCover(0, sheet('nearTotal'))).toMatchObject({ penalty: -8, source: 'sheet' });
  });

  it('keeps the map cover when the sheet claims none', () => {
    expect(effectiveCover(-6, sheet())).toMatchObject({ penalty: -6, grade: 'heavy', source: 'map' });
  });

  it('reports agreement rather than picking a winner', () => {
    expect(effectiveCover(-4, sheet('medium')).source).toBe('both');
    expect(effectiveCover(0, sheet()).source).toBe('both');
  });

  // Neither source may ever help the attacker.
  it('never turns cover into a bonus', () => {
    expect(effectiveCover(3, sheet()).penalty).toBe(0);
  });
});
