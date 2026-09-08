import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { DocumentBadge, DocumentDot } from '../components/DocumentState';
import { Kbd } from '../components/Kbd';
import { type Hint, Screen } from '../components/Screen';
import type { DocumentSummary } from '../lib/api';
import {
  type DocumentState,
  sortWorstFirst,
  stateOf,
  TYPE_LABELS,
  totalText,
} from '../lib/document-display';
import { DEFAULT_FILTERS } from '../lib/table-query';
import { useDocuments } from '../lib/use-documents';
import { useShortcuts } from '../lib/use-shortcuts';

export const Route = createFileRoute('/queue')({
  component: QueuePage,
});

const HINTS: Hint[] = [
  { keys: ['J', 'K'], label: 'Move' },
  { keys: ['⏎'], label: 'Open' },
  { keys: ['U'], label: 'Upload' },
  { keys: ['G', 'T'], label: 'Table' },
  { keys: ['?'], label: 'All shortcuts' },
];

// One line under the heading: how many sit in each state, worst first.
function summaryLine(documents: DocumentSummary[]): string {
  if (documents.length === 0) return 'Nothing here yet.';

  const count: Partial<Record<DocumentState, number>> = {};
  for (const doc of documents) {
    const state = stateOf(doc);
    count[state] = (count[state] ?? 0) + 1;
  }
  const working = (count.working ?? 0) + (count.queued ?? 0);

  const parts = [
    count['needs-review'] && `${count['needs-review']} needs review`,
    count['mostly-verified'] && `${count['mostly-verified']} mostly verified`,
    count.verified && `${count.verified} verified`,
    count.failed && `${count.failed} failed`,
    working && `${working} still being read`,
  ].filter((part): part is string => typeof part === 'string');

  return `Worst first. ${parts.join(', ')}.`;
}

// The header and every row share these columns, so they line up. The list
// scrolls sideways on a narrow window rather than folding its columns.
const ROW =
  'grid min-w-[1080px] grid-cols-[14px_minmax(0,1fr)_92px_210px_104px_116px_140px] items-center gap-4 px-4';

function QueuePage() {
  const { data: documents = [], isPending } = useDocuments();
  const navigate = useNavigate();
  const sorted = sortWorstFirst(documents);

  // The row the keyboard is on. Kept in range here rather than in an effect,
  // so a list that shrinks under the cursor never shows an empty selection.
  const [cursor, setCursor] = useState(0);
  const selected = Math.min(cursor, Math.max(sorted.length - 1, 0));

  function open(doc: DocumentSummary) {
    navigate({ to: '/documents/$documentId', params: { documentId: doc.id } });
  }

  useShortcuts({
    j: (event) => {
      event.preventDefault();
      setCursor(Math.min(selected + 1, sorted.length - 1));
    },
    k: (event) => {
      event.preventDefault();
      setCursor(Math.max(selected - 1, 0));
    },
    enter: () => {
      const doc = sorted[selected];
      if (doc) open(doc);
    },
    u: () => navigate({ to: '/' }),
    'g t': () => navigate({ to: '/table', search: DEFAULT_FILTERS }),
  });

  return (
    <Screen
      breadcrumb="Queue"
      hints={HINTS}
      actions={
        <button type="button" className="btn" onClick={() => navigate({ to: '/' })}>
          Upload<Kbd>U</Kbd>
        </button>
      }
    >
      <div className="px-5 pt-6.5 pb-4">
        <h1 className="font-serif text-title font-normal">Queue</h1>
        <div className="mt-2 text-note text-ink-soft">
          {isPending ? 'Loading…' : summaryLine(sorted)}
        </div>
      </div>

      <div className="mx-5 overflow-x-auto rounded-lg border border-line bg-panel">
        <div className={`${ROW} caps h-[34px] border-b border-line`}>
          <span />
          <span>Document</span>
          <span>Type</span>
          <span>Vendor or party</span>
          <span>Date</span>
          <span className="text-right">Total</span>
          <span className="text-right">Trust</span>
        </div>

        {sorted.length === 0 && !isPending && (
          <div className="px-4 py-5 text-note text-ink-soft">
            Nothing here yet. Upload a document to get started.
          </div>
        )}

        {sorted.map((doc, index) => (
          <QueueRow
            key={doc.id}
            doc={doc}
            isSelected={index === selected}
            onSelect={() => setCursor(index)}
            onOpen={() => open(doc)}
          />
        ))}
      </div>

      <div className="px-5 pt-3.5 text-xs text-ink-quiet">
        This page keeps itself up to date while anything is still being read.
      </div>
    </Screen>
  );
}

function QueueRow({
  doc,
  isSelected,
  onSelect,
  onOpen,
}: {
  doc: DocumentSummary;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const state = stateOf(doc);
  const whyColor =
    state === 'failed' || state === 'needs-review' ? 'text-needs-review' : 'text-ink-soft';

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={onSelect}
      className={`${ROW} h-[68px] w-full cursor-pointer border-b border-line-row text-left ${
        isSelected ? 'bg-card-raised shadow-[inset_3px_0_0_var(--color-ink)]' : ''
      }`}
    >
      <DocumentDot doc={doc} />
      <span className="min-w-0">
        <span
          className={`block truncate text-lede ${isSelected ? 'font-medium' : ''}`}
          title={doc.name}
        >
          {doc.name}
        </span>
        <div className={`mt-[3px] truncate text-[12.5px] ${whyColor}`} title={doc.why}>
          {doc.why}
        </div>
      </span>
      <span className="text-note text-ink-soft">{TYPE_LABELS[doc.type]}</span>
      <span
        className={`block truncate text-note ${doc.counterparty ? 'text-ink' : 'text-ink-faint'}`}
        title={doc.counterparty ?? undefined}
      >
        {doc.counterparty ?? '—'}
      </span>
      <span
        className={`font-mono text-note tabular-nums ${doc.date ? 'text-ink' : 'text-ink-faint'}`}
      >
        {doc.date ?? '—'}
      </span>
      <span
        className={`text-right font-mono text-note tabular-nums ${doc.total ? 'text-ink' : 'text-ink-faint'}`}
      >
        {totalText(doc)}
      </span>
      <span className="inline-flex items-center gap-2 justify-self-end">
        <DocumentBadge doc={doc} />
        {isSelected && <Kbd>⏎</Kbd>}
      </span>
    </button>
  );
}
