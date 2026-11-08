import { describe, expect, it } from 'vitest';
import {
  adjustTaskTokens, isTaskComplication, newDramaticTask, taskRound, taskStatus, tokensForRoll, DT_LOG_MAX,
} from '../src/systems/swadeDramaticTask.js';

describe('tokensForRoll', () => {
  it('earns nothing on a failure', () => {
    expect(tokensForRoll(3, false)).toMatchObject({ success: false, tokens: 0, complicationFailed: false });
  });
  it('earns one on a success and one more per raise', () => {
    expect(tokensForRoll(4, false).tokens).toBe(1);
    expect(tokensForRoll(7, false).tokens).toBe(1);
    expect(tokensForRoll(8, false).tokens).toBe(2);
    expect(tokensForRoll(12, false).tokens).toBe(3);
  });
  it('takes −2 off a Complication roll, and flags failing it', () => {
    expect(tokensForRoll(8, true)).toMatchObject({ adjusted: 6, tokens: 1, complicationFailed: false });
    expect(tokensForRoll(5, true)).toMatchObject({ adjusted: 3, tokens: 0, complicationFailed: true });
  });
});

describe('isTaskComplication', () => {
  it('is any Club but never the Joker', () => {
    expect(isTaskComplication({ rank: 7, suit: 'clubs' } as never)).toBe(true);
    expect(isTaskComplication({ rank: 7, suit: 'hearts' } as never)).toBe(false);
    expect(isTaskComplication({ rank: 15, suit: 'clubs' } as never)).toBe(false);
    expect(isTaskComplication(null)).toBe(false);
  });
});

describe('a task on the tracker', () => {
  it('reads its round off the tracker round it began on', () => {
    const t = newDramaticTask('Inpu', 8, 5, 3);
    expect(taskRound(t, 3)).toBe(1);
    expect(taskRound(t, 7)).toBe(5);
    expect(taskRound(t, 1)).toBe(1);
  });
  it('runs, then completes on enough tokens or runs out of time', () => {
    const t = newDramaticTask('Inpu', 8, 5, 1);
    expect(taskStatus(t, 5)).toBe('running');
    expect(taskStatus(t, 6)).toBe('outOfTime');
    adjustTaskTokens(t, 8, 'Othmar', 'test', 5);
    expect(taskStatus(t, 6)).toBe('complete');
  });
  it('clamps silly setup values and keeps a short log', () => {
    const t = newDramaticTask('  ', 0, 999, 0);
    expect(t).toMatchObject({ name: 'Dramatic Task', tokensNeeded: 1, maxRounds: 20, startRound: 1 });
    for (let i = 0; i < DT_LOG_MAX + 5; i++) adjustTaskTokens(t, -1, 'x', 'y', 1);
    expect(t.tokens).toBe(0);
    expect(t.log.length).toBe(DT_LOG_MAX);
  });
});
