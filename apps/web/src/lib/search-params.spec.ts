import { describe, expect, it } from 'vitest';
import { parseSearch, stringifySearch } from './search-params';

describe('stringifySearch', () => {
  it('is empty for an empty search', () => {
    expect(stringifySearch({})).toBe('');
  });

  it('drops a null, undefined, or empty array value', () => {
    expect(stringifySearch({ a: null, b: undefined, c: [] })).toBe('');
  });

  it('joins an array with commas', () => {
    expect(stringifySearch({ type: ['invoice', 'receipt'] })).toBe('?type=invoice%2Creceipt');
  });

  it('writes a plain value as itself', () => {
    expect(stringifySearch({ q: 'toner', amountMin: 10 })).toBe('?q=toner&amountMin=10');
  });
});

describe('parseSearch', () => {
  it('is empty for a bare address', () => {
    expect(parseSearch('')).toEqual({});
  });

  it('reads every value back as a plain string', () => {
    expect(parseSearch('?q=toner&amountMin=10')).toEqual({ q: 'toner', amountMin: '10' });
  });

  it('round trips with stringifySearch', () => {
    const search = { q: 'toner', type: ['invoice', 'receipt'] };
    expect(parseSearch(stringifySearch(search))).toEqual({ q: 'toner', type: 'invoice,receipt' });
  });
});
