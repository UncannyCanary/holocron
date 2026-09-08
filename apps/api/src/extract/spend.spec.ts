import { describe, expect, it } from 'vitest';
import { costOfUsage, isOverCap, startOfMonth, worstCaseCost } from './spend.js';

describe('costOfUsage', () => {
  it('prices a call from its tokens', () => {
    // 3,000 input at $5 and 600 output at $25 per million.
    const cost = costOfUsage('claude-opus-5', { input_tokens: 3000, output_tokens: 600 });
    expect(cost).toBeCloseTo(0.03, 10);
  });

  it('prices cached tokens at their own rates', () => {
    const cost = costOfUsage('claude-opus-5', {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 2000,
    });
    expect(cost).toBeCloseTo((2000 * 6.25 + 2000 * 0.5) / 1_000_000, 10);
  });

  it('runs the cheaper model at the cheaper price', () => {
    expect(costOfUsage('claude-sonnet-5', { input_tokens: 3000, output_tokens: 600 })).toBeCloseTo(
      0.012,
      10,
    );
  });

  it('refuses a model it has no price for', () => {
    expect(() => costOfUsage('claude-haiku-4-5', { input_tokens: 1, output_tokens: 1 })).toThrow();
  });
});

describe('worstCaseCost', () => {
  it('assumes the call writes every output token it is allowed', () => {
    expect(worstCaseCost('claude-opus-5', 5000, 16_000)).toBeCloseTo(0.025 + 0.4, 10);
  });
});

describe('isOverCap', () => {
  it('lets a call through while the cap can cover the worst case', () => {
    expect(isOverCap(14, 0.42, 15)).toBe(false);
  });

  it('stops a call that could pass the cap', () => {
    expect(isOverCap(14.7, 0.42, 15)).toBe(true);
  });

  it('stops every call once the cap is spent', () => {
    expect(isOverCap(15, 0.01, 15)).toBe(true);
  });
});

describe('startOfMonth', () => {
  it('is the first moment of the month in UTC', () => {
    expect(startOfMonth(new Date('2026-09-08T13:45:00Z')).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });
});
