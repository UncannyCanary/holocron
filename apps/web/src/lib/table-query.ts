import type { DocumentType } from '@holocron/shared';
import type { DocumentSummary, DocumentTrust } from './api';
import { STATE_LABELS, stateOf, stateRank, TYPE_LABELS, totalText } from './document-display';

export type SortColumn = 'name' | 'type' | 'vendor' | 'date' | 'total' | 'trust' | 'uploaded';
export type SortDir = 'asc' | 'desc';

// Everything the table's URL can hold. The search word is sent to the API;
// everything else is applied here, in the browser, against what came back.
export type TableFilters = {
  q: string;
  type: DocumentType[];
  trust: DocumentTrust[];
  dateFrom: string | null;
  dateTo: string | null;
  amountMin: number | null;
  amountMax: number | null;
  vendor: string | null;
  sort: SortColumn;
  dir: SortDir;
};

export const DEFAULT_FILTERS: TableFilters = {
  q: '',
  type: [],
  trust: [],
  dateFrom: null,
  dateTo: null,
  amountMin: null,
  amountMax: null,
  vendor: null,
  sort: 'trust',
  dir: 'asc',
};

const SORT_COLUMNS: readonly SortColumn[] = [
  'name',
  'type',
  'vendor',
  'date',
  'total',
  'trust',
  'uploaded',
];
const DOCUMENT_TYPES: readonly DocumentType[] = ['invoice', 'receipt', 'contract'];
const DOCUMENT_TRUSTS: readonly DocumentTrust[] = ['needs-review', 'mostly-verified', 'verified'];

// parseTableSearch reads two different shapes. Loading the page hands it the
// raw string key/value pairs parseSearch pulled off the address bar. Calling
// navigate({ search }) hands it the table's own already-typed filters object,
// since the router validates a write the same way it validates a read. Every
// reader below accepts either.
function strOf(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  return null;
}

function numOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = strOf(value);
  if (text === null) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function listOf<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.length > 0
      ? value.split(',')
      : [];
  return items.filter((each): each is T => (allowed as readonly string[]).includes(each));
}

// Reads the table's filters, sort, and search word back out of the URL. A
// value that does not make sense, such as a sort column that was never a
// real column, falls back to the default rather than breaking the screen.
export function parseTableSearch(raw: Record<string, unknown>): TableFilters {
  const sort = strOf(raw.sort);
  return {
    q: strOf(raw.q) ?? '',
    type: listOf(raw.type, DOCUMENT_TYPES),
    trust: listOf(raw.trust, DOCUMENT_TRUSTS),
    dateFrom: strOf(raw.dateFrom),
    dateTo: strOf(raw.dateTo),
    amountMin: numOf(raw.amountMin),
    amountMax: numOf(raw.amountMax),
    vendor: strOf(raw.vendor),
    sort:
      sort !== null && (SORT_COLUMNS as readonly string[]).includes(sort)
        ? (sort as SortColumn)
        : DEFAULT_FILTERS.sort,
    dir: raw.dir === 'desc' ? 'desc' : 'asc',
  };
}

function amountOf(doc: DocumentSummary): number | null {
  if (!doc.total) return null;
  const amount = Number(doc.total.amount);
  return Number.isFinite(amount) ? amount : null;
}

// Every filter but the search word, which the API has already narrowed the
// list down by. A document a filter has no opinion about always stays in.
export function applyFilters(docs: DocumentSummary[], filters: TableFilters): DocumentSummary[] {
  return docs.filter((doc) => {
    if (filters.type.length > 0 && !filters.type.includes(doc.type)) return false;
    if (filters.trust.length > 0 && (doc.trust === null || !filters.trust.includes(doc.trust))) {
      return false;
    }
    if (filters.dateFrom !== null && (doc.date === null || doc.date < filters.dateFrom)) {
      return false;
    }
    if (filters.dateTo !== null && (doc.date === null || doc.date > filters.dateTo)) {
      return false;
    }
    if (filters.amountMin !== null) {
      const amount = amountOf(doc);
      if (amount === null || amount < filters.amountMin) return false;
    }
    if (filters.amountMax !== null) {
      const amount = amountOf(doc);
      if (amount === null || amount > filters.amountMax) return false;
    }
    if (filters.vendor !== null && doc.counterparty !== filters.vendor) return false;
    return true;
  });
}

const COLUMN_VALUE: Record<SortColumn, (doc: DocumentSummary) => string | number | null> = {
  name: (doc) => doc.name.toLowerCase(),
  type: (doc) => doc.type,
  vendor: (doc) => doc.counterparty?.toLowerCase() ?? null,
  date: (doc) => doc.date,
  total: (doc) => amountOf(doc),
  trust: (doc) => stateRank(doc),
  uploaded: (doc) => doc.createdAt,
};

// Sorted by the one column, worst-trust-first by default. A document with no
// value in the sorted column always sits at the end, in either direction. Ties
// break by newest first, which is also what "worst first, then newest" means
// when nothing has been sorted by hand.
export function sortTable(
  docs: DocumentSummary[],
  sort: SortColumn,
  dir: SortDir,
): DocumentSummary[] {
  const columnValue = COLUMN_VALUE[sort];
  const factor = dir === 'asc' ? 1 : -1;

  return [...docs].sort((left, right) => {
    const a = columnValue(left);
    const b = columnValue(right);
    if (a === null && b === null) return right.createdAt.localeCompare(left.createdAt);
    if (a === null) return 1;
    if (b === null) return -1;

    const cmp =
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
    return cmp !== 0 ? cmp * factor : right.createdAt.localeCompare(left.createdAt);
  });
}

// The vendor and party names actually present, for the filter's own list of
// choices, so it never offers a name nothing in the workspace has.
export function vendorOptions(docs: DocumentSummary[]): string[] {
  const names = new Set<string>();
  for (const doc of docs) {
    if (doc.counterparty !== null) names.add(doc.counterparty);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const BASE_COLUMNS: Array<{ header: string; value: (doc: DocumentSummary) => string }> = [
  { header: 'Name', value: (doc) => doc.name },
  { header: 'Type', value: (doc) => TYPE_LABELS[doc.type] },
  { header: 'Vendor or party', value: (doc) => doc.counterparty ?? '' },
  { header: 'Date', value: (doc) => doc.date ?? '' },
  { header: 'Total', value: (doc) => (doc.total ? totalText(doc) : '') },
  { header: 'Trust', value: (doc) => STATE_LABELS[stateOf(doc)] },
  { header: 'Uploaded', value: (doc) => doc.createdAt },
];

// The CSV for whatever is on screen: the same columns a person sees, then
// one pair of columns per field the model read, value beside trust, so a
// bookkeeper can see both without opening the review screen.
export function buildCsv(docs: DocumentSummary[]): string {
  const fieldNames = [
    ...new Set(docs.flatMap((doc) => doc.fields.map((each) => each.name))),
  ].sort();

  const header = [
    ...BASE_COLUMNS.map((column) => column.header),
    ...fieldNames.flatMap((name) => [name, `${name} trust`]),
  ];

  const rows = docs.map((doc) => {
    const fieldByName = new Map(doc.fields.map((each) => [each.name, each]));
    return [
      ...BASE_COLUMNS.map((column) => column.value(doc)),
      ...fieldNames.flatMap((name) => {
        const found = fieldByName.get(name);
        return [found?.value ?? '', found?.trust ?? ''];
      }),
    ];
  });

  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
