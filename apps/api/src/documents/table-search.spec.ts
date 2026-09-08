import { describe, expect, it } from 'vitest';
import { tsQueryFrom } from './table-search.js';

describe('tsQueryFrom', () => {
  it('is null for nothing typed', () => {
    expect(tsQueryFrom(undefined)).toBeNull();
    expect(tsQueryFrom(null)).toBeNull();
    expect(tsQueryFrom('')).toBeNull();
    expect(tsQueryFrom('   ')).toBeNull();
  });

  it('turns one word into a prefix match', () => {
    expect(tsQueryFrom('toner')).toBe('toner:*');
  });

  it('joins several words with and', () => {
    expect(tsQueryFrom('acme supplies')).toBe('acme:* & supplies:*');
  });

  it('keeps the decimal point in an amount', () => {
    expect(tsQueryFrom('181.50')).toBe('181.50:*');
  });

  it('strips characters that would break tsquery syntax', () => {
    expect(tsQueryFrom("O'Brien & Sons:")).toBe('obrien:* & sons:*');
  });

  it('drops a word that is only punctuation', () => {
    expect(tsQueryFrom('acme !!! toner')).toBe('acme:* & toner:*');
  });

  it('is null when every word is only punctuation', () => {
    expect(tsQueryFrom('!!! ---')).toBeNull();
  });
});
