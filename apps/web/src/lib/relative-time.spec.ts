import { describe, expect, it } from 'vitest';
import { agoText, durationText } from './relative-time';

const now = new Date('2026-09-08T12:00:00Z');

function agoBy(milliseconds: number): string {
  return agoText(new Date(now.getTime() - milliseconds), now);
}

describe('agoText', () => {
  it('says just now for the last minute', () => {
    expect(agoBy(5 * 1000)).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(agoBy(60 * 1000)).toBe('1 minute ago');
    expect(agoBy(2 * 60 * 1000)).toBe('2 minutes ago');
    expect(agoBy(3 * 60 * 60 * 1000)).toBe('3 hours ago');
    expect(agoBy(2 * 24 * 60 * 60 * 1000)).toBe('2 days ago');
  });
});

describe('durationText', () => {
  it('rounds to whole seconds and never says none', () => {
    expect(durationText(120)).toBe('1 second');
    expect(durationText(14_200)).toBe('14 seconds');
  });

  it('says minutes and seconds for a long run', () => {
    expect(durationText(60_000)).toBe('1 minute');
    expect(durationText(80_000)).toBe('1 minute 20 seconds');
  });
});
