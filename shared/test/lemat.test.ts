import { describe, expect, it } from 'vitest';
import { CONTENT_SWADE } from '../src/data/contentSwade.js';

/**
 * The LeMat is one gun with two barrels that roll nothing alike, so it lands
 * in the compendium as two rows. Numbers are the book's tabletop inches at
 * this file's five-feet-per-inch scale.
 */
describe('the Confederate LeMat Cavalry Pistol', () => {
  const find = (n: string) => CONTENT_SWADE.find((e) => e.kind === 'weapon' && e.name === n);
  const revolver = find('Confederate LeMat Cavalry Pistol');
  const shotgun = find('Confederate LeMat Cavalry Pistol (Under-barrel Shotgun)');

  it('carries both barrels', () => {
    expect(revolver).toBeTruthy();
    expect(shotgun).toBeTruthy();
  });

  it('gives the revolver barrel 12/24/48, 2d6+1, nine shots', () => {
    expect(revolver!.weapon!.damage).toBe('2d6!+1');
    expect(revolver!.weapon!.props).toContain('range 60/120/240');
    expect(revolver!.weapon!.props).toContain('mag 9');
  });

  // Nine rounds is the whole point of the gun, and the reason it needs a
  // counterweight: one action per chamber, with no Speed Load to shortcut it.
  it('prices that capacity with a chamber-by-chamber reload', () => {
    expect(revolver!.weapon!.props.join(' ')).toContain('one action per chamber');
    expect(revolver!.weapon!.props.join(' ')).toContain('Speed Load does not apply');
  });

  it('gives the shotgun barrel 5/10/20 and the shotgun damage ladder', () => {
    expect(shotgun!.weapon!.damage).toBe('3d6!');
    expect(shotgun!.weapon!.props).toContain('range 25/50/100');
    expect(shotgun!.weapon!.props).toContain('mag 1');
    expect(shotgun!.weapon!.props).toContain('damage 3d6/2d6/1d6 by range band');
  });

  // Both rows are the same physical gun, so only one of them may charge for it
  // or weigh anything — otherwise a character carrying it pays twice.
  it('bills the gun once', () => {
    expect(revolver!.gear).toEqual({ cost: 300, weight: 4 });
    expect(shotgun!.gear).toEqual({ cost: 0, weight: 0 });
  });

  it('matches the Colt Peacemaker’s range, as the book has it', () => {
    const colt = find('Colt Peacemaker (.45)');
    expect(revolver!.weapon!.props).toContain(
      colt!.weapon!.props.find((p) => p.startsWith('range '))!,
    );
  });

  it('is black powder, and says so', () => {
    for (const w of [revolver, shotgun]) {
      expect(w!.weapon!.props.join(' ')).toContain('black powder');
    }
  });
});
