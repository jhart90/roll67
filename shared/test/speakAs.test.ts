import { describe, expect, it } from 'vitest';
import { parseSpeakAs } from '../src/speakAs.js';

describe('parseSpeakAs', () => {
  it('takes the name before a colon', () => {
    expect(parseSpeakAs('Sabu: Put down your weapons.')).toEqual({ name: 'Sabu', body: 'Put down your weapons.' });
    expect(parseSpeakAs('Voice on the tracker: Walk back.')).toEqual({ name: 'Voice on the tracker', body: 'Walk back.' });
  });
  it('prefers the longest known character name without a colon', () => {
    const names = ['Sabu', 'Sabu, Royal Priest'];
    expect(parseSpeakAs('Sabu, Royal Priest Walk back now.', names)).toEqual({ name: 'Sabu, Royal Priest', body: 'Walk back now.' });
  });
  it('falls back to the first word', () => {
    expect(parseSpeakAs('S.Y.S.T.E.M. Six signatures present.')).toEqual({ name: 'S.Y.S.T.E.M.', body: 'Six signatures present.' });
  });
  it('refuses an empty message', () => {
    expect(parseSpeakAs('Sabu:')).toBeNull();
    expect(parseSpeakAs('Sabu')).toBeNull();
    expect(parseSpeakAs('  ')).toBeNull();
  });
  it('splits on the first colon only', () => {
    expect(parseSpeakAs('Sabu: Listen: walk back.')).toEqual({ name: 'Sabu', body: 'Listen: walk back.' });
  });
});
