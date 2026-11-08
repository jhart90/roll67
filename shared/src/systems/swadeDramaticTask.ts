/**
 * SWADE Dramatic Tasks: a race against the clock, run on the Action Cards.
 *
 * The party has a fixed number of rounds to earn a number of Task Tokens. A
 * success on a roll toward the task earns one token and each raise one more.
 * Anyone dealt a Club that round has a Complication: their roll is at −2, and
 * failing it is a disaster — by the book the whole task fails, though the GM
 * may rule a lesser setback. In a Combat Dramatic Task the same tokens are
 * earned while the fight goes on around the people earning them.
 *
 * The task lives on the initiative tracker (as a chase does): it IS a sequence
 * of rounds dealt from the action deck, so it keeps the round the tracker was
 * on when it began, and its own round is read off the tracker's. Nothing has
 * to remember to advance it, and rewinding the tracker rewinds the task.
 */
import type { PlayingCard } from './cards.js';

export interface DramaticTaskLogLine {
  /** The task's own round when this happened. */
  round: number;
  /** Who earned or lost the tokens, or what moved them. */
  who: string;
  delta: number;
  why: string;
}

export interface DramaticTaskState {
  name: string;
  tokensNeeded: number;
  tokens: number;
  /** How many rounds the party has. */
  maxRounds: number;
  /** The tracker's round when the task began — its round 1. */
  startRound: number;
  /** Chat roll messages already counted, so a roll counts once. */
  countedMsgIds: number[];
  /** Newest last; trimmed to the last DT_LOG_MAX lines. */
  log: DramaticTaskLogLine[];
}

export const DT_TN = 4;
export const DT_COMPLICATION_MOD = -2;
export const DT_LOG_MAX = 20;
export const DT_TOKENS_DEFAULT = 4;
export const DT_ROUNDS_DEFAULT = 4;

/** The task's own round number (1-based) at the tracker's `round`. */
export function taskRound(task: DramaticTaskState, trackerRound: number): number {
  return Math.max(1, trackerRound - task.startRound + 1);
}

export type DramaticTaskStatus = 'running' | 'complete' | 'outOfTime';

/**
 * Done when the tokens are in — whenever that happened. Out of time once the
 * tracker has moved past the last round without them.
 */
export function taskStatus(task: DramaticTaskState, trackerRound: number): DramaticTaskStatus {
  if (task.tokens >= task.tokensNeeded) return 'complete';
  if (taskRound(task, trackerRound) > task.maxRounds) return 'outOfTime';
  return 'running';
}

/** A Club is a Complication; the Joker never is. */
export function isTaskComplication(card: PlayingCard | null | undefined): boolean {
  return !!card && card.rank !== 15 && card.suit === 'clubs';
}

export interface TaskRollResult {
  /** The roll after the Complication penalty, if any. */
  adjusted: number;
  success: boolean;
  raises: number;
  tokens: number;
  /** A Complication roll that failed: the disaster case. */
  complicationFailed: boolean;
}

/** What one trait roll's total earns toward the task. */
export function tokensForRoll(total: number, complication: boolean): TaskRollResult {
  const adjusted = total + (complication ? DT_COMPLICATION_MOD : 0);
  const success = adjusted >= DT_TN;
  const raises = success ? Math.floor((adjusted - DT_TN) / 4) : 0;
  return {
    adjusted,
    success,
    raises,
    tokens: success ? 1 + raises : 0,
    complicationFailed: complication && !success,
  };
}

/** Start a task on the tracker's current round. Counts are clamped to sane ranges. */
export function newDramaticTask(name: string, tokensNeeded: number, maxRounds: number, trackerRound: number): DramaticTaskState {
  const clamp = (n: number, lo: number, hi: number, dflt: number) =>
    Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
  return {
    name: name.trim().slice(0, 60) || 'Dramatic Task',
    tokensNeeded: clamp(tokensNeeded, 1, 30, DT_TOKENS_DEFAULT),
    tokens: 0,
    maxRounds: clamp(maxRounds, 1, 20, DT_ROUNDS_DEFAULT),
    startRound: Math.max(1, trackerRound),
    countedMsgIds: [],
    log: [],
  };
}

/** Add (or take away) tokens, never below zero, and log why. Mutates `task`. */
export function adjustTaskTokens(task: DramaticTaskState, delta: number, who: string, why: string, trackerRound: number): void {
  const before = task.tokens;
  task.tokens = Math.max(0, task.tokens + Math.round(delta));
  task.log.push({ round: taskRound(task, trackerRound), who, delta: task.tokens - before, why });
  if (task.log.length > DT_LOG_MAX) task.log.splice(0, task.log.length - DT_LOG_MAX);
}
