import { describe, expect, it } from 'vitest';
import {
  counterpartyOf,
  dateOf,
  documentDisplayName,
  type SummaryCheck,
  type SummaryField,
  summarizeFailed,
  summarizeProcessing,
  summarizeQueued,
  summarizeReady,
  totalOf,
} from './document-summary.js';

function field(
  name: string,
  value: string | null,
  extra: Partial<SummaryField> = {},
): SummaryField {
  return { name, value, currency: null, trust: 'verified', ...extra };
}

describe('documentDisplayName', () => {
  it('uses the vendor for an invoice', () => {
    expect(documentDisplayName('invoice', [field('vendor', 'Acme Supplies')], 'invoice.pdf')).toBe(
      'Acme Supplies',
    );
  });

  it('falls back to the file name when nothing was read', () => {
    expect(documentDisplayName('invoice', [], 'invoice.pdf')).toBe('invoice.pdf');
  });

  it('names a receipt with no readable merchant by its total', () => {
    const fields = [field('total', '91000', { currency: 'IDR' })];
    expect(documentDisplayName('receipt', fields, 'receipt.jpg')).toBe('Receipt, 91000 IDR');
  });

  it('uses the title for a contract', () => {
    expect(documentDisplayName('contract', [field('title', 'Mutual NDA')], 'nda.pdf')).toBe(
      'Mutual NDA',
    );
  });
});

describe('counterpartyOf', () => {
  it('joins contract parties with how many more there are', () => {
    const fields = [
      field('parties.0', 'Netzee, Inc.'),
      field('parties.1', 'Cedar & Finch'),
      field('parties.2', 'Northlake Hardware'),
    ];
    expect(counterpartyOf('contract', fields)).toBe('Netzee, Inc. and 2 more');
  });

  it('says "one more" for exactly two parties', () => {
    const fields = [field('parties.0', 'Netzee, Inc.'), field('parties.1', 'Cedar & Finch')];
    expect(counterpartyOf('contract', fields)).toBe('Netzee, Inc. and one more');
  });

  it('is null when a contract names no parties', () => {
    expect(counterpartyOf('contract', [])).toBeNull();
  });

  it('is the merchant for a receipt', () => {
    expect(counterpartyOf('receipt', [field('merchant', 'Warung Makan')])).toBe('Warung Makan');
  });
});

describe('totalOf', () => {
  it('formats the total in the field currency', () => {
    const fields = [field('total', '181.5', { currency: 'USD' })];
    expect(totalOf('invoice', fields)).toEqual({ amount: '181.50', currency: 'USD' });
  });

  it('is null for a contract, which has no total', () => {
    expect(totalOf('contract', [field('total', '5')])).toBeNull();
  });

  it('is null when there is no total field yet', () => {
    expect(totalOf('invoice', [])).toBeNull();
  });
});

describe('dateOf', () => {
  it('reads the issue date for an invoice', () => {
    expect(dateOf('invoice', [field('issue_date', '2026-03-03')])).toBe('2026-03-03');
  });

  it('reads the purchase date for a receipt', () => {
    expect(dateOf('receipt', [field('purchased_at', '2026-01-01')])).toBe('2026-01-01');
  });
});

describe('summarizeReady', () => {
  const passing: SummaryCheck = { name: 'total', passed: true, message: 'The total adds up.' };
  const failing: SummaryCheck = {
    name: 'total',
    passed: false,
    message: 'The total says 165.00, but the lines add up to 57.00.',
  };

  it('is verified when every field checks out', () => {
    const fields = [field('total', '165', { trust: 'verified' })];
    expect(summarizeReady(fields, [passing])).toEqual({
      trust: 'verified',
      why: 'Every value was found on the page and every check passed.',
    });
  });

  it('needs review with the one failed check named, when there is one', () => {
    const fields = [field('total', '165', { trust: 'contradicted' })];
    const result = summarizeReady(fields, [failing]);
    expect(result.trust).toBe('needs-review');
    expect(result.why).toBe(failing.message);
  });

  it('counts the checks when more than one failed', () => {
    const fields = [field('total', '165', { trust: 'contradicted' })];
    const result = summarizeReady(fields, [failing, { ...failing, name: 'subtotal' }]);
    expect(result.why).toBe(`2 of 2 checks failed. ${failing.message}`);
  });

  it('names the fields not found on the page, in plain English, when mostly verified', () => {
    // The model read a value, but our own text layer could not find its
    // quote on the page, so the field is really unverifiable rather than
    // a value the document never printed.
    const fields = [
      field('vendor', 'Acme', { trust: 'verified' }),
      field('tax_amount', '25.00', { trust: 'unverifiable' }),
    ];
    const result = summarizeReady(fields, []);
    expect(result.trust).toBe('mostly-verified');
    expect(result.why).toBe('Not found on the page: the tax.');
  });

  it('is verified, not mostly verified, when the only unverifiable field is one the document never printed', () => {
    // The value is null: the field is unverifiable because nothing was ever
    // there to ground, not because the model's quote could not be found.
    const fields = [
      field('vendor', 'Acme', { trust: 'verified' }),
      field('discount', null, { trust: 'unverifiable' }),
    ];
    const result = summarizeReady(fields, []);
    expect(result.trust).toBe('verified');
  });

  it('leaves a field the document never printed out of the "not found" line', () => {
    const fields = [
      field('tax_amount', '25.00', { trust: 'unverifiable' }),
      field('discount', null, { trust: 'unverifiable' }),
    ];
    const result = summarizeReady(fields, []);
    expect(result.why).toBe('Not found on the page: the tax.');
  });
});

describe('summarizeProcessing', () => {
  it('names the current step and its place in the run', () => {
    expect(summarizeProcessing('checked')).toBe('Checking the numbers. Step 7 of 7.');
  });

  it('has a plain default when nothing has started yet', () => {
    expect(summarizeProcessing(null)).toBe('Reading it now.');
  });
});

describe('summarizeQueued', () => {
  it('shows the parked reason when there is one', () => {
    expect(summarizeQueued('Holocron is at its monthly processing budget.')).toBe(
      'Holocron is at its monthly processing budget.',
    );
  });

  it('has a plain default otherwise', () => {
    expect(summarizeQueued(null)).toBe('Waiting in the queue.');
  });
});

describe('summarizeFailed', () => {
  it('shows the run error when there is one', () => {
    expect(summarizeFailed('The model would not read this document.')).toBe(
      'The model would not read this document.',
    );
  });

  it('has a plain default otherwise', () => {
    expect(summarizeFailed(null)).toBe('Something went wrong while reading this document.');
  });
});
