import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useRef, useState } from 'react';
import { DocumentBadge } from '../components/DocumentState';
import { FieldPanel } from '../components/FieldPanel';
import { Kbd } from '../components/Kbd';
import { PageView } from '../components/PageView';
import { type Hint, Screen } from '../components/Screen';
import { type DocumentField, type DocumentSummary, messageOf } from '../lib/api';
import { sortWorstFirst, stateOf } from '../lib/document-display';
import { agoText, durationText } from '../lib/relative-time';
import { buildPanel, fieldText, type Panel } from '../lib/review-layout';
import { useCorrectField, useDocument, useRetryDocument } from '../lib/use-document';
import { useDocuments } from '../lib/use-documents';
import { useShortcuts } from '../lib/use-shortcuts';

export const Route = createFileRoute('/documents/$documentId')({
  component: ReviewRoute,
});

const HINTS: Hint[] = [
  { keys: ['J', 'K'], label: 'Next and previous document' },
  { keys: ['↑', '↓'], label: 'Move through the values' },
  { keys: ['E'], label: 'Change the value' },
  { keys: ['⏎'], label: 'Next to review' },
  { keys: ['?'], label: 'All shortcuts' },
];

const EDITING_HINTS: Hint[] = [
  { keys: ['⏎'], label: 'Save' },
  { keys: ['Esc'], label: 'Cancel' },
];

// What the screen shows while the document is still on its way.
const EMPTY_PANEL: Panel = { groups: [], order: [], labelOf: new Map() };

function ReviewRoute() {
  const { documentId } = Route.useParams();
  // A fresh screen for each document: which value is picked, which page is
  // shown, and any half typed correction belong to the one being read.
  return <ReviewScreen key={documentId} documentId={documentId} />;
}

function ReviewScreen({ documentId }: { documentId: string }) {
  const navigate = useNavigate();
  const { data: doc, isPending, isError, error } = useDocument(documentId);
  const { data: documents = [] } = useDocuments();
  const correct = useCorrectField();
  const retry = useRetryDocument();

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ fieldId: string; value: string } | null>(null);
  const [flashAt, setFlashAt] = useState(0);
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const rows = useRef(new Map<string, HTMLElement | null>());

  const queue = sortWorstFirst(documents);
  const place = queue.findIndex((each) => each.id === documentId);
  const summary = queue[place];

  const panel = doc === undefined ? EMPTY_PANEL : buildPanel(doc.type, doc.fields);
  // Nothing picked yet means the first value worth a look, which is the
  // first one a check contradicts. Worked out rather than kept in step, so a
  // correction that turns a field green never leaves the cursor nowhere.
  const selected =
    panel.order.find((each) => each.id === pickedId) ??
    panel.order.find((each) => each.trust === 'contradicted') ??
    panel.order[0] ??
    null;

  function open(next: DocumentSummary | undefined) {
    if (next) {
      navigate({ to: '/documents/$documentId', params: { documentId: next.id } });
    }
  }

  // The next document a check contradicts, wrapping round to the start. When
  // there is none left, the queue itself.
  function openNextToReview() {
    const after = [...queue.slice(place + 1), ...queue.slice(0, Math.max(place, 0))];
    const next = after.find((each) => stateOf(each) === 'needs-review');
    if (next) {
      open(next);
      return;
    }
    navigate({ to: '/queue' });
  }

  function pick(field: DocumentField) {
    setPickedId(field.id);
    setEditing(null);
    if (field.page !== null) {
      setPageNumber(field.page);
    }
    setFlashAt(Date.now());
    rows.current.get(field.id)?.scrollIntoView({ block: 'nearest' });
  }

  function move(step: number) {
    const at = panel.order.findIndex((each) => each.id === selected?.id);
    const next = panel.order[Math.min(Math.max(at + step, 0), panel.order.length - 1)];
    if (next) {
      pick(next);
    }
  }

  function edit(field: DocumentField | null) {
    if (field === null) return;
    correct.reset();
    setPickedId(field.id);
    // Typing starts from the value as it is shown, so an amount does not
    // change from 12.00 to 12 the moment it is opened.
    setEditing({ fieldId: field.id, value: field.value === null ? '' : fieldText(field) });
  }

  function save() {
    if (editing === null) return;
    const value = editing.value.trim();
    if (value === '') return;
    correct.mutate({ fieldId: editing.fieldId, value }, { onSuccess: () => setEditing(null) });
  }

  useShortcuts({
    j: (event) => {
      event.preventDefault();
      open(queue[place + 1]);
    },
    k: (event) => {
      event.preventDefault();
      open(queue[place - 1]);
    },
    arrowdown: (event) => {
      event.preventDefault();
      move(1);
    },
    arrowup: (event) => {
      event.preventDefault();
      move(-1);
    },
    e: (event) => {
      event.preventDefault();
      edit(selected);
    },
    enter: (event) => {
      event.preventDefault();
      openNextToReview();
    },
    n: openNextToReview,
    'g q': () => navigate({ to: '/queue' }),
  });

  const frame = {
    breadcrumb: summary?.name ?? 'Document',
    hints: editing === null ? HINTS : EDITING_HINTS,
    actions: (
      <>
        {summary && <DocumentBadge doc={summary} />}
        <Link
          to="/documents/$documentId/timeline"
          params={{ documentId }}
          className="text-note no-underline"
        >
          Timeline
        </Link>
        {place >= 0 && (
          <span className="text-xs text-ink-quiet">
            {place + 1} of {queue.length} in the queue
          </span>
        )}
        <button
          type="button"
          className="btn"
          aria-label="Previous document"
          disabled={place <= 0}
          onClick={() => open(queue[place - 1])}
        >
          <Arrow back />
          <Kbd>K</Kbd>
        </button>
        <button
          type="button"
          className="btn"
          aria-label="Next document"
          disabled={place < 0 || place >= queue.length - 1}
          onClick={() => open(queue[place + 1])}
        >
          <Arrow />
          <Kbd>J</Kbd>
        </button>
        <button type="button" className="btn btn-primary" onClick={openNextToReview}>
          Next to review
          <Kbd dark>⏎</Kbd>
        </button>
      </>
    ),
  };

  if (isPending) {
    return (
      <Screen {...frame}>
        <Note>Loading…</Note>
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen {...frame}>
        <Note>{messageOf(error, 'This document could not be opened.')}</Note>
      </Screen>
    );
  }

  // Still in the queue, still being read, or read and failed. There are no
  // values to show yet, so the screen says where the document has got to and
  // keeps asking until there are.
  if (doc.status !== 'ready' || doc.pages.length === 0) {
    return (
      <Screen {...frame}>
        <Note>
          <p>{summary?.why ?? 'This document has not been read yet.'}</p>
          {doc.status === 'failed' && (
            <div className="mt-3.5 flex flex-col items-start gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={retry.isPending}
                onClick={() => retry.mutate(documentId)}
              >
                {retry.isPending ? 'Trying again…' : 'Try again'}
              </button>
              {retry.isError && (
                <span role="alert" className="text-note text-needs-review">
                  {messageOf(retry.error, 'That did not work. Try again.')}
                </span>
              )}
            </div>
          )}
        </Note>
      </Screen>
    );
  }

  const footer =
    doc.run === null
      ? 'This document has no run to show.'
      : `Read ${agoText(new Date(doc.run.endedAt), new Date())} in ${durationText(
          new Date(doc.run.endedAt).getTime() - new Date(doc.run.startedAt).getTime(),
        )}`;

  return (
    <Screen {...frame} fill>
      {/* Side by side at any width. On a narrow window the pair scrolls
          sideways, the way the queue's columns do, rather than folding. */}
      <div className="min-h-0 flex-1 overflow-x-auto">
        <div className="grid h-full min-w-[900px] grid-cols-[minmax(0,1fr)_520px] grid-rows-[minmax(0,1fr)]">
          <PageView
            pages={doc.pages}
            fields={doc.fields}
            pageNumber={pageNumber ?? selected?.page ?? 1}
            onPageNumber={setPageNumber}
            selectedId={selected?.id ?? null}
            flashAt={flashAt}
            labelOf={panel.labelOf}
            onPick={pick}
          />
          <FieldPanel
            panel={panel}
            checks={doc.checks}
            selectedId={selected?.id ?? null}
            editing={editing}
            saving={correct.isPending}
            saveError={
              correct.isError
                ? messageOf(correct.error, 'That change did not save. Try again.')
                : null
            }
            onPick={pick}
            onEdit={edit}
            onEditValue={(value) => setEditing(editing === null ? null : { ...editing, value })}
            onSave={save}
            onCancel={() => setEditing(null)}
            rows={rows}
            footer={footer}
          />
        </div>
      </div>
    </Screen>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 justify-center px-5 py-12">
      <div className="w-full max-w-[640px] text-lede text-ink-soft">{children}</div>
    </div>
  );
}

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={back ? 'M10 3 5 8l5 5' : 'm6 3 5 5-5 5'} />
    </svg>
  );
}
