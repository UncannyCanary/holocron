import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DocumentType, Extraction } from '@holocron/shared';
import { describe, expect, it } from 'vitest';
import { flattenExtraction } from './flatten.js';

// The same recorded answers the extract tests use, so the names here are the
// names a real answer produces.
function recorded(type: DocumentType): Extraction {
  const file = fileURLToPath(new URL(`../extract/fixtures/${type}.json`, import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8')).output;
}

function byName(type: DocumentType) {
  return new Map(flattenExtraction(recorded(type)).map((each) => [each.name, each]));
}

describe('flattenExtraction', () => {
  it('names an invoice value, a line, and keeps the currency with the money', () => {
    const fields = byName('invoice');

    expect(fields.get('total')).toEqual({
      name: 'total',
      value: '181.5',
      currency: 'USD',
      page: 1,
      quote: '181.50',
    });
    expect(fields.get('vendor')?.value).toBe('Acme Supplies');
    expect(fields.get('vendor')?.currency).toBeNull();
    expect(fields.get('issue_date')?.value).toBe('2026-03-03');

    // The planted error, copied down as printed.
    expect(fields.get('line_items.1.line_total')?.value).toBe('12');
    expect(fields.get('line_items.1.quantity')?.value).toBe('2');
    expect(fields.get('line_items.1.unit_price')?.value).toBe('60');
  });

  it('numbers the items of a list', () => {
    const fields = byName('contract');

    expect(fields.get('parties.0')?.value).toBe('Nimbus Analytics, Inc.');
    expect(fields.get('parties.1')?.value).toBe('Cobalt Field Robotics LLC');
    expect(fields.get('signature_parties.0')?.value).toBe('Nimbus Analytics, Inc.');
    expect(fields.get('defined_terms.0.term')?.value).toBe('MNDA');
    expect(fields.get('defined_terms.0.use')?.value).toBe('MNDA');
  });

  it('keeps a value the document does not have, with nothing to point at', () => {
    const fields = byName('receipt');

    expect(fields.get('change')).toEqual({
      name: 'change',
      value: null,
      currency: null,
      page: null,
      quote: null,
    });
    // Read off the picture, so there is a value but no words to match.
    expect(fields.get('line_items.0.description')?.value).toBe('J.STB PROMO');
    expect(fields.get('line_items.0.description')?.quote).toBeNull();
  });
});
