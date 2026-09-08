import { describe, expect, it } from 'vitest';
import type { CheckResult } from './checks.js';
import { type FieldVerdict, trustOfDocument, trustOfFields } from './trust.js';

function failed(blamed: string[], flagged: string[] = []): CheckResult {
  return { name: 'total', passed: false, message: 'It does not add up.', blamed, flagged };
}

function passed(blamed: string[], flagged: string[] = []): CheckResult {
  return { name: 'total', passed: true, message: 'It adds up.', blamed, flagged };
}

// A field the page backs up and nobody has touched.
function field(
  name: string,
  changes: Partial<{ corrected: boolean; grounded: boolean; onDocument: boolean }> = {},
) {
  return { name, corrected: false, grounded: true, onDocument: true, ...changes };
}

function verdict(
  name: string,
  trust: FieldVerdict['trust'],
  involved = false,
  onDocument = true,
): FieldVerdict {
  return { name, trust, involved, onDocument };
}

describe('the trust state of a field', () => {
  it('is verified when the page backs it up and no check failed', () => {
    expect(trustOfFields([field('total')], [passed(['total'])])).toEqual([
      verdict('total', 'verified'),
    ]);
  });

  it('is unverifiable when the quote was not found on the page', () => {
    expect(trustOfFields([field('total', { grounded: false })], [])).toEqual([
      verdict('total', 'unverifiable'),
    ]);
  });

  it('is contradicted when a check that works it out failed', () => {
    expect(trustOfFields([field('total')], [failed(['total'])])).toEqual([
      verdict('total', 'contradicted'),
    ]);
  });

  it('is corrected when a person changed it', () => {
    expect(trustOfFields([field('total', { corrected: true })], [])).toEqual([
      verdict('total', 'corrected'),
    ]);
  });

  it('is contradicted rather than unverifiable when both apply', () => {
    const verdicts = trustOfFields([field('total', { grounded: false })], [failed(['total'])]);

    expect(verdicts).toEqual([verdict('total', 'contradicted')]);
  });

  it('is corrected rather than contradicted when both apply', () => {
    const verdicts = trustOfFields([field('total', { corrected: true })], [failed(['total'])]);

    expect(verdicts).toEqual([verdict('total', 'corrected')]);
  });
});

describe('the involved flag', () => {
  it('is set on a field a failed check read', () => {
    const verdicts = trustOfFields(
      [field('total'), field('subtotal')],
      [failed(['total'], ['subtotal'])],
    );

    expect(verdicts).toEqual([
      verdict('total', 'contradicted'),
      verdict('subtotal', 'verified', true),
    ]);
  });

  it('is not set by a check that passed', () => {
    const verdicts = trustOfFields([field('subtotal')], [passed(['total'], ['subtotal'])]);

    expect(verdicts).toEqual([verdict('subtotal', 'verified')]);
  });

  it('sits alongside a corrected badge', () => {
    const verdicts = trustOfFields(
      [field('subtotal', { corrected: true })],
      [failed(['total'], ['subtotal'])],
    );

    expect(verdicts).toEqual([verdict('subtotal', 'corrected', true)]);
  });
});

describe('a field the document does not print', () => {
  it('is unverifiable on its own, but marked as not counting towards the document', () => {
    const verdicts = trustOfFields([field('discount', { grounded: false, onDocument: false })], []);

    expect(verdicts).toEqual([verdict('discount', 'unverifiable', false, false)]);
  });

  it('is contradicted, and counts, once a check blames it', () => {
    const verdicts = trustOfFields(
      [field('invoice_number', { grounded: false, onDocument: false })],
      [failed(['invoice_number'])],
    );

    expect(verdicts).toEqual([verdict('invoice_number', 'contradicted', false, false)]);
  });
});

describe('the trust state of a document', () => {
  it('needs review when any field is contradicted', () => {
    const verdicts = [
      verdict('total', 'contradicted'),
      verdict('vendor', 'unverifiable'),
      verdict('subtotal', 'verified'),
    ];

    expect(trustOfDocument(verdicts)).toBe('needs-review');
  });

  it('is mostly verified when nothing is contradicted but something cannot be confirmed', () => {
    const verdicts = [verdict('vendor', 'unverifiable'), verdict('total', 'corrected')];

    expect(trustOfDocument(verdicts)).toBe('mostly-verified');
  });

  it('is verified when every field is verified or corrected', () => {
    const verdicts = [verdict('vendor', 'verified'), verdict('total', 'corrected')];

    expect(trustOfDocument(verdicts)).toBe('verified');
  });

  it('is verified when there are no fields at all', () => {
    expect(trustOfDocument([])).toBe('verified');
  });

  it('is not dragged to mostly verified by a field the document never printed', () => {
    const verdicts = [
      verdict('vendor', 'verified'),
      verdict('discount', 'unverifiable', false, false),
    ];

    expect(trustOfDocument(verdicts)).toBe('verified');
  });

  it('still needs review when a field the document never printed is contradicted', () => {
    const verdicts = [verdict('invoice_number', 'contradicted', false, false)];

    expect(trustOfDocument(verdicts)).toBe('needs-review');
  });
});
