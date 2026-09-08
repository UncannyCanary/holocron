import { describe, expect, it } from 'vitest';
import type { DocumentSummary } from './api';
import {
  applyFilters,
  buildCsv,
  DEFAULT_FILTERS,
  parseTableSearch,
  sortTable,
  vendorOptions,
} from './table-query';

function doc(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 'a',
    type: 'invoice',
    status: 'ready',
    name: 'invoice.pdf',
    counterparty: null,
    date: null,
    total: null,
    trust: 'verified',
    why: 'Every value was found on the page and every check passed.',
    isSample: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    fields: [],
    ...overrides,
  };
}

describe('parseTableSearch', () => {
  it('is every default when the URL has nothing on it', () => {
    expect(parseTableSearch({})).toEqual(DEFAULT_FILTERS);
  });

  it('reads a comma list into an array, dropping anything not a real value', () => {
    expect(parseTableSearch({ type: 'invoice,receipt,nonsense' }).type).toEqual([
      'invoice',
      'receipt',
    ]);
  });

  it('falls back to the default sort column instead of an unknown one', () => {
    expect(parseTableSearch({ sort: 'not-a-column' }).sort).toBe('trust');
  });

  it('reads a whole set of filters together', () => {
    const parsed = parseTableSearch({
      q: 'toner',
      trust: 'needs-review,verified',
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      amountMin: '10',
      amountMax: '200',
      vendor: 'Acme Supplies',
      sort: 'date',
      dir: 'desc',
    });
    expect(parsed).toEqual({
      q: 'toner',
      type: [],
      trust: ['needs-review', 'verified'],
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      amountMin: 10,
      amountMax: 200,
      vendor: 'Acme Supplies',
      sort: 'date',
      dir: 'desc',
    });
  });

  // The router validates a value passed to navigate({ search }) the same way
  // it validates what came off the address bar, so this has to read an
  // already-typed filters object, arrays and numbers and all, just as well as
  // the raw strings above. A real bug once made a checkbox click silently
  // reset itself because this path was never checked.
  it('passes through an already-typed filters object unchanged', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      type: ['invoice' as const],
      trust: ['needs-review' as const],
      amountMin: 10,
      amountMax: 200,
    };
    expect(parseTableSearch(filters)).toEqual(filters);
  });
});

describe('applyFilters', () => {
  const docs = [
    doc({
      id: 'a',
      type: 'invoice',
      trust: 'needs-review',
      date: '2026-01-15',
      total: { amount: '100.00', currency: 'USD' },
      counterparty: 'Acme',
    }),
    doc({
      id: 'b',
      type: 'receipt',
      trust: 'verified',
      date: '2026-02-15',
      total: { amount: '5.00', currency: 'USD' },
      counterparty: 'Warung',
    }),
    doc({
      id: 'c',
      type: 'contract',
      trust: null,
      status: 'processing',
      date: null,
      total: null,
      counterparty: null,
    }),
  ];

  it('keeps everything when nothing is filtered', () => {
    expect(applyFilters(docs, DEFAULT_FILTERS)).toHaveLength(3);
  });

  it('filters by type', () => {
    const result = applyFilters(docs, { ...DEFAULT_FILTERS, type: ['invoice'] });
    expect(result.map((each) => each.id)).toEqual(['a']);
  });

  it('filters by trust, excluding a document with no trust yet', () => {
    const result = applyFilters(docs, { ...DEFAULT_FILTERS, trust: ['verified'] });
    expect(result.map((each) => each.id)).toEqual(['b']);
  });

  it('filters by a date range, excluding a document with no date', () => {
    const result = applyFilters(docs, { ...DEFAULT_FILTERS, dateFrom: '2026-02-01' });
    expect(result.map((each) => each.id)).toEqual(['b']);
  });

  it('filters by an amount range, excluding a document with no total', () => {
    const result = applyFilters(docs, { ...DEFAULT_FILTERS, amountMin: 50 });
    expect(result.map((each) => each.id)).toEqual(['a']);
  });

  it('filters by an exact vendor or party', () => {
    const result = applyFilters(docs, { ...DEFAULT_FILTERS, vendor: 'Warung' });
    expect(result.map((each) => each.id)).toEqual(['b']);
  });
});

describe('sortTable', () => {
  it('is worst trust first by default, with ties broken by newest', () => {
    const docs = [
      doc({ id: 'old-verified', trust: 'verified', createdAt: '2026-01-01T00:00:00.000Z' }),
      doc({ id: 'new-verified', trust: 'verified', createdAt: '2026-03-01T00:00:00.000Z' }),
      doc({ id: 'needs-review', trust: 'needs-review', createdAt: '2026-02-01T00:00:00.000Z' }),
    ];
    const sorted = sortTable(docs, 'trust', 'asc');
    expect(sorted.map((each) => each.id)).toEqual(['needs-review', 'new-verified', 'old-verified']);
  });

  it('sorts a text column and reverses on desc', () => {
    const docs = [doc({ id: 'b', name: 'Beta' }), doc({ id: 'a', name: 'Alpha' })];
    expect(sortTable(docs, 'name', 'asc').map((each) => each.id)).toEqual(['a', 'b']);
    expect(sortTable(docs, 'name', 'desc').map((each) => each.id)).toEqual(['b', 'a']);
  });

  it('puts a document with no value in the sorted column last either way', () => {
    const docs = [
      doc({ id: 'has-total', total: { amount: '10.00', currency: 'USD' } }),
      doc({ id: 'no-total', total: null }),
    ];
    expect(sortTable(docs, 'total', 'asc').map((each) => each.id)).toEqual([
      'has-total',
      'no-total',
    ]);
    expect(sortTable(docs, 'total', 'desc').map((each) => each.id)).toEqual([
      'has-total',
      'no-total',
    ]);
  });
});

describe('vendorOptions', () => {
  it('lists the distinct vendors and parties present, alphabetically, with no null', () => {
    const docs = [
      doc({ counterparty: 'Zed' }),
      doc({ counterparty: 'Acme' }),
      doc({ counterparty: null }),
      doc({ counterparty: 'Acme' }),
    ];
    expect(vendorOptions(docs)).toEqual(['Acme', 'Zed']);
  });
});

describe('buildCsv', () => {
  it('has the base columns and one value/trust pair per field seen', () => {
    const docs = [
      doc({
        name: 'invoice.pdf',
        counterparty: 'Acme',
        date: '2026-01-15',
        total: { amount: '100.00', currency: 'USD' },
        fields: [{ name: 'vendor', value: 'Acme', currency: null, trust: 'verified' }],
      }),
    ];
    const csv = buildCsv(docs);
    const [header, row] = csv.split('\r\n');
    expect(header).toBe('Name,Type,Vendor or party,Date,Total,Trust,Uploaded,vendor,vendor trust');
    expect(row).toBe(
      'invoice.pdf,Invoice,Acme,2026-01-15,100.00 USD,Verified,2026-01-01T00:00:00.000Z,Acme,verified',
    );
  });

  it('quotes a value that holds a comma', () => {
    const docs = [doc({ counterparty: 'Acme, Inc.' })];
    expect(buildCsv(docs).split('\r\n')[1]).toContain('"Acme, Inc."');
  });

  it('leaves a blank pair for a field a document does not have', () => {
    const docs = [
      doc({ fields: [{ name: 'vendor', value: 'Acme', currency: null, trust: 'verified' }] }),
      doc({ fields: [] }),
    ];
    const rows = buildCsv(docs).split('\r\n').slice(1);
    expect(rows[1].endsWith(',,')).toBe(true);
  });
});
