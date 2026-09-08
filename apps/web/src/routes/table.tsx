import type { DocumentType } from '@holocron/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import { createColumnHelper, flexRender, tableFeatures, useTable } from '@tanstack/react-table';
import { type ReactNode, useRef, useState } from 'react';
import { DocumentBadge, DocumentDot } from '../components/DocumentState';
import { Kbd } from '../components/Kbd';
import { type Hint, Screen } from '../components/Screen';
import type { DocumentSummary, DocumentTrust } from '../lib/api';
import { STATE_LABELS, TYPE_LABELS, totalText } from '../lib/document-display';
import { agoText } from '../lib/relative-time';
import {
  applyFilters,
  buildCsv,
  DEFAULT_FILTERS,
  parseTableSearch,
  type SortColumn,
  sortTable,
  type TableFilters,
  vendorOptions,
} from '../lib/table-query';
import { useShortcuts } from '../lib/use-shortcuts';
import { useTableDocuments } from '../lib/use-table-documents';

export const Route = createFileRoute('/table')({
  validateSearch: (search: Record<string, unknown>) => parseTableSearch(search),
  component: TablePage,
});

const HINTS: Hint[] = [
  { keys: ['J', 'K'], label: 'Move' },
  { keys: ['⏎'], label: 'Open' },
  { keys: ['/'], label: 'Search' },
  { keys: ['E'], label: 'Download CSV' },
  { keys: ['G', 'Q'], label: 'Queue' },
  { keys: ['?'], label: 'All shortcuts' },
];

const TYPE_OPTIONS: DocumentType[] = ['invoice', 'receipt', 'contract'];
const TRUST_OPTIONS: DocumentTrust[] = ['needs-review', 'mostly-verified', 'verified'];

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, DocumentSummary>();

const ROW =
  'grid min-w-[1120px] grid-cols-[14px_minmax(0,1fr)_92px_190px_104px_116px_140px_88px] items-center gap-4 px-4';

const FILTER_TRIGGER =
  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong bg-card px-2.5 text-note text-ink open:border-ink open:shadow-[0_0_0_3px_rgba(28,25,23,0.08)]';
const FILTER_PANEL =
  'absolute left-0 top-[calc(100%+6px)] z-10 flex w-56 flex-col gap-0.5 rounded-lg border border-line-strong bg-card-raised p-2 shadow-lg';
const FILTER_OPTION =
  'flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-note hover:bg-panel-muted';

function columnsOf(sort: SortColumn, dir: 'asc' | 'desc', onSort: (column: SortColumn) => void) {
  function head(label: string, column: SortColumn, align: 'left' | 'right' = 'left') {
    return () => (
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`caps inline-flex items-center gap-1 ${align === 'right' ? 'w-full justify-end' : ''}`}
      >
        {label}
        {sort === column && <SortArrow dir={dir} />}
      </button>
    );
  }

  return columnHelper.columns([
    columnHelper.display({
      id: 'dot',
      header: '',
      cell: (ctx) => <DocumentDot doc={ctx.row.original} />,
    }),
    columnHelper.accessor('name', {
      id: 'name',
      header: head('Name', 'name'),
      cell: (ctx) => <span className="text-lede">{ctx.row.original.name}</span>,
    }),
    columnHelper.accessor('type', {
      id: 'type',
      header: head('Type', 'type'),
      cell: (ctx) => (
        <span className="text-note text-ink-soft">{TYPE_LABELS[ctx.row.original.type]}</span>
      ),
    }),
    columnHelper.accessor('counterparty', {
      id: 'vendor',
      header: head('Vendor or party', 'vendor'),
      cell: (ctx) => (
        <span
          className={`truncate text-note ${ctx.row.original.counterparty ? 'text-ink' : 'text-ink-faint'}`}
        >
          {ctx.row.original.counterparty ?? '—'}
        </span>
      ),
    }),
    columnHelper.accessor('date', {
      id: 'date',
      header: head('Date', 'date'),
      cell: (ctx) => (
        <span
          className={`font-mono text-note tabular-nums ${ctx.row.original.date ? 'text-ink' : 'text-ink-faint'}`}
        >
          {ctx.row.original.date ?? '—'}
        </span>
      ),
    }),
    columnHelper.display({
      id: 'total',
      header: head('Total', 'total', 'right'),
      cell: (ctx) => (
        <span
          className={`block text-right font-mono text-note tabular-nums ${ctx.row.original.total ? 'text-ink' : 'text-ink-faint'}`}
        >
          {totalText(ctx.row.original)}
        </span>
      ),
    }),
    columnHelper.display({
      id: 'trust',
      header: head('Trust', 'trust', 'right'),
      cell: (ctx) => (
        <span className="flex justify-end">
          <DocumentBadge doc={ctx.row.original} />
        </span>
      ),
    }),
    columnHelper.display({
      id: 'uploaded',
      header: head('Added', 'uploaded', 'right'),
      cell: (ctx) => (
        <span className="block text-right text-[12.5px] text-ink-quiet">
          {ctx.row.original.isSample
            ? 'Sample'
            : agoText(new Date(ctx.row.original.createdAt), new Date())}
        </span>
      ),
    }),
  ]);
}

// How long to wait after the last keystroke before the search word becomes a
// real request. Typing a whole word would otherwise send one request per
// letter, which is wasteful on its own and, combined with everything else the
// page already asks for, can run into the per-minute request limit.
const SEARCH_DEBOUNCE_MS = 300;

function TablePage() {
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: rawDocuments = [], isPending, isError, refetch } = useTableDocuments(filters.q);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = applyFilters(rawDocuments, filters);
  const sorted = sortTable(filtered, filters.sort, filters.dir);
  const vendors = vendorOptions(rawDocuments);

  const [cursor, setCursor] = useState(0);
  const selected = Math.min(cursor, Math.max(sorted.length - 1, 0));

  // The search box's own text, typed letter by letter. It only becomes
  // filters.q, and so a real request, once typing pauses. When filters.q
  // changes from somewhere else, such as the back button or Clear filters,
  // this catches up to it instead of fighting it.
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (filters.q !== syncedQ) {
    setSyncedQ(filters.q);
    setSearchDraft(filters.q);
  }

  function setFilters(patch: Partial<TableFilters>) {
    navigate({ search: { ...filters, ...patch }, replace: true });
  }

  function onSearchInput(value: string) {
    setSearchDraft(value);
    if (searchTimer.current !== null) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setFilters({ q: value }), SEARCH_DEBOUNCE_MS);
  }

  function toggleSort(column: SortColumn) {
    if (filters.sort === column) {
      setFilters({ dir: filters.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setFilters({ sort: column, dir: 'asc' });
    }
  }

  function toggleType(type: DocumentType) {
    setFilters({
      type: filters.type.includes(type)
        ? filters.type.filter((each) => each !== type)
        : [...filters.type, type],
    });
  }

  function toggleTrust(trust: DocumentTrust) {
    setFilters({
      trust: filters.trust.includes(trust)
        ? filters.trust.filter((each) => each !== trust)
        : [...filters.trust, trust],
    });
  }

  function toggleVendor(vendor: string) {
    setFilters({ vendor: filters.vendor === vendor ? null : vendor });
  }

  function open(doc: DocumentSummary | undefined) {
    if (doc) {
      navigate({ to: '/documents/$documentId', params: { documentId: doc.id } });
    }
  }

  function downloadCsv() {
    const blob = new Blob([buildCsv(sorted)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = 'holocron-documents.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  const table = useTable({
    features,
    columns: columnsOf(filters.sort, filters.dir, toggleSort),
    data: sorted,
    getRowId: (row) => row.id,
  });

  useShortcuts({
    j: (event) => {
      event.preventDefault();
      setCursor(Math.min(selected + 1, sorted.length - 1));
    },
    k: (event) => {
      event.preventDefault();
      setCursor(Math.max(selected - 1, 0));
    },
    enter: () => open(sorted[selected]),
    '/': (event) => {
      event.preventDefault();
      searchRef.current?.focus();
    },
    e: (event) => {
      event.preventDefault();
      if (sorted.length > 0) downloadCsv();
    },
    'g q': () => navigate({ to: '/queue' }),
  });

  const hasFilters =
    filters.q !== '' ||
    filters.type.length > 0 ||
    filters.trust.length > 0 ||
    filters.dateFrom !== null ||
    filters.dateTo !== null ||
    filters.amountMin !== null ||
    filters.amountMax !== null ||
    filters.vendor !== null;

  return (
    <Screen
      breadcrumb="Table"
      hints={HINTS}
      actions={
        <div className="inline-flex overflow-hidden rounded-md border border-line-strong bg-card">
          <Link
            to="/queue"
            className="inline-flex h-8 items-center gap-1.5 px-3.5 text-note font-medium text-ink-soft no-underline"
          >
            Queue<Kbd>G</Kbd>
            <Kbd>Q</Kbd>
          </Link>
          <span className="inline-flex h-8 items-center bg-ink px-3.5 text-note font-medium text-paper">
            Table
          </span>
        </div>
      }
    >
      <div className="flex items-end justify-between px-5 pt-6.5 pb-4">
        <div>
          <h1 className="font-serif text-title font-normal">All documents</h1>
          <div className="mt-2 text-note text-ink-soft">
            Filters, sorting, and the search box all live in the address, so this view can be sent
            to someone.
          </div>
        </div>
        <button type="button" className="btn" onClick={downloadCsv} disabled={sorted.length === 0}>
          Download CSV<Kbd>E</Kbd>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 px-5 pb-4">
        <div className="flex h-8 w-[300px] items-center gap-2 rounded-md border border-line-strong bg-card px-2.5">
          <SearchIcon />
          <input
            ref={searchRef}
            type="text"
            value={searchDraft}
            onChange={(event) => onSearchInput(event.target.value)}
            placeholder="Names, numbers, values, line items"
            className="w-full bg-transparent text-note text-ink outline-none placeholder:text-ink-faint"
          />
          <Kbd>/</Kbd>
        </div>

        <FilterMenu label={<>Type{filters.type.length > 0 && ` (${filters.type.length})`}</>}>
          {TYPE_OPTIONS.map((type) => (
            <label key={type} className={FILTER_OPTION}>
              <input
                type="checkbox"
                checked={filters.type.includes(type)}
                onChange={() => toggleType(type)}
              />
              {TYPE_LABELS[type]}
            </label>
          ))}
        </FilterMenu>

        <FilterMenu label={<>Trust{filters.trust.length > 0 && ` (${filters.trust.length})`}</>}>
          {TRUST_OPTIONS.map((trust) => (
            <label key={trust} className={FILTER_OPTION}>
              <input
                type="checkbox"
                checked={filters.trust.includes(trust)}
                onChange={() => toggleTrust(trust)}
              />
              {STATE_LABELS[trust]}
            </label>
          ))}
          <div className="mt-1 border-line-row border-t px-2 pt-2 text-xs text-ink-quiet">
            Pick none to see them all.
          </div>
        </FilterMenu>

        <FilterMenu label="Date" panel="w-64 gap-2 p-3">
          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            From
            <input
              type="date"
              value={filters.dateFrom ?? ''}
              onChange={(event) => setFilters({ dateFrom: event.target.value || null })}
              className="h-8 rounded border border-line-strong bg-card-raised px-2 text-note"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            To
            <input
              type="date"
              value={filters.dateTo ?? ''}
              onChange={(event) => setFilters({ dateTo: event.target.value || null })}
              className="h-8 rounded border border-line-strong bg-card-raised px-2 text-note"
            />
          </label>
        </FilterMenu>

        <FilterMenu label="Amount" panel="w-56 gap-2 p-3">
          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            At least
            <input
              type="number"
              value={filters.amountMin ?? ''}
              onChange={(event) =>
                setFilters({
                  amountMin: event.target.value === '' ? null : Number(event.target.value),
                })
              }
              className="h-8 rounded border border-line-strong bg-card-raised px-2 text-note"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            At most
            <input
              type="number"
              value={filters.amountMax ?? ''}
              onChange={(event) =>
                setFilters({
                  amountMax: event.target.value === '' ? null : Number(event.target.value),
                })
              }
              className="h-8 rounded border border-line-strong bg-card-raised px-2 text-note"
            />
          </label>
        </FilterMenu>

        <FilterMenu label="Vendor or party" panel="max-h-64 overflow-y-auto">
          {vendors.length === 0 && (
            <div className="px-2 py-1.5 text-note text-ink-faint">Nothing here yet.</div>
          )}
          {vendors.map((vendor) => (
            <label key={vendor} className={FILTER_OPTION}>
              <input
                type="radio"
                name="vendor"
                checked={filters.vendor === vendor}
                onChange={() => toggleVendor(vendor)}
              />
              <span className="truncate">{vendor}</span>
            </label>
          ))}
        </FilterMenu>

        {hasFilters && (
          <button
            type="button"
            className="text-note text-link"
            onClick={() => {
              if (searchTimer.current !== null) clearTimeout(searchTimer.current);
              navigate({ search: DEFAULT_FILTERS, replace: true });
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {isError ? (
        <div className="mx-5 flex flex-col items-start gap-3 rounded-lg border border-line bg-panel px-5 py-6">
          <p className="text-lede text-ink-soft">Couldn't load documents.</p>
          <button type="button" className="btn" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <div className="mx-5 overflow-x-auto rounded-lg border border-line bg-panel">
          {table.getHeaderGroups().map((group) => (
            <div key={group.id} className={`${ROW} caps h-[34px] border-line border-b`}>
              {group.headers.map((header) => (
                <span key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </span>
              ))}
            </div>
          ))}

          {!isPending && sorted.length === 0 && (
            <div className="flex flex-col items-start gap-3 px-4 py-6">
              <p className="text-note text-ink-soft">No documents match.</p>
              {hasFilters && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (searchTimer.current !== null) clearTimeout(searchTimer.current);
                    navigate({ search: DEFAULT_FILTERS, replace: true });
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {isPending && <div className="px-4 py-5 text-note text-ink-soft">Loading…</div>}

          {table.getRowModel().rows.map((row, index) => (
            <button
              key={row.id}
              type="button"
              onClick={() => open(row.original)}
              onMouseEnter={() => setCursor(index)}
              className={`${ROW} h-[52px] w-full cursor-pointer border-line-row border-b text-left ${
                index === selected ? 'bg-card-raised shadow-[inset_3px_0_0_var(--color-ink)]' : ''
              }`}
            >
              {row.getAllCells().map((cell) => (
                <span key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </span>
              ))}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between px-5 pt-3.5 text-xs text-ink-quiet">
        <span>
          {sorted.length} of {rawDocuments.length} document{rawDocuments.length === 1 ? '' : 's'}.
        </span>
        <span>The CSV holds the rows you can see, with a trust column beside every value.</span>
      </div>
    </Screen>
  );
}

// One filter menu. Every menu shares a name, so opening one closes the rest,
// and a menu closes when focus leaves it, which is what a click elsewhere or
// a Tab away does. Escape closes it too. No listener on the window is needed.
function FilterMenu({
  label,
  panel = '',
  children,
}: {
  label: ReactNode;
  panel?: string;
  children: ReactNode;
}) {
  return (
    <details
      name="table-filter"
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          event.currentTarget.open = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary className={FILTER_TRIGGER}>
        {label}
        <ChevronDown />
      </summary>
      <div className={`${FILTER_PANEL} ${panel}`}>{children}</div>
    </details>
  );
}

function SortArrow({ dir }: { dir: 'asc' | 'desc' }) {
  return (
    <svg
      className="size-2.5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={dir === 'asc' ? 'm4 10 4-4 4 4' : 'm4 6 4 4 4-4'} />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg
      className="size-2.5 text-ink-quiet"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="size-3.5 flex-none text-ink-quiet"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}
