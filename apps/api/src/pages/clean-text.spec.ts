import type { Span } from '@holocron/shared';
import { describe, expect, it } from 'vitest';
import { cleanSpans, cleanText } from './clean-text.js';

const box = { x0: 0, y0: 0, x1: 0.1, y1: 0.01 };
const span = (text: string): Span => ({ text, box, confidence: null });

describe('cleanText', () => {
  it('removes a NUL and other control characters', () => {
    expect(cleanText('ZQPXEUAS\u0000')).toBe('ZQPXEUAS');
    expect(cleanText('ab\u0007c\u001B')).toBe('abc');
  });

  it('leaves ordinary text, tabs, and newlines alone', () => {
    expect(cleanText('Total\t181.50\n')).toBe('Total\t181.50\n');
    expect(cleanText('₹ 569.00')).toBe('₹ 569.00');
  });
});

describe('cleanSpans', () => {
  it('drops a span that was only control characters', () => {
    expect(cleanSpans([span('\u0000'), span('0001')])).toEqual([span('0001')]);
  });
});
